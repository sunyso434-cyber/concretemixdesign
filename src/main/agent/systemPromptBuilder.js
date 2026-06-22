/**
 * 构造 system prompt（纯函数）
 */

// v1.5.3 决策：固定 7 个 workspace 工具说明（与 workspaceTools.js 注册的伪 Skill 一一对应）
// Task 4.4：注入到 system prompt，让 LLM 知道每个工具怎么用、返回什么
const WORKSPACE_TOOLS_PROMPT = `
可用 workspace 工具（共 7 个，v1.5.1 原始设计 v1.5.3 沿用）：
- workspace_search(query, topK) → 找相关 wiki 页（含 chat-history，不调 LLM）
- workspace_readPage(wikiPath) → 读 wiki 页全文
- workspace_ingest(filename) → 原始文件入 wiki（自动调 KG 提取）
- workspace_writeFile({ type, filename, payload }) → 写 docx/xlsx/md 到 reports/
- workspace_listFiles(subdir) → 列出工作区文件（含子目录）
- workspace_lint() → 健康检查（不阻塞）
- workspace_searchGraph(query, topK) → 查询知识图谱，返回完整三元组（v1.5.1 新增，P5 阶段启用）。**前提：当前工作区必须已打开**——workspacePath 由工具自动读取，LLM 无需传。

注：原始文件不直接读——LLM 应先 ingest 再 readPage，wiki 摘要更精炼。
`

// v1.5.3 决策：5 类报告 → 必调 Skill 矩阵（软约束）
// 软约束：LLM 看到后倾向按此顺序调用，可视情况跳过。
// 硬拦截不在 UnifiedStrategy 实现（避免破坏 LLM 自主性）。
const REPORT_SKILL_MATRIX = `## 5 类报告 → 必调 Skill 矩阵（软约束）

老板的典型 5 类报告生成场景，按以下 Skill 顺序调用（LLM 可视情况跳过）：

1. **配合比设计报告** → \`calculate_mix_design\` → \`performance_prediction\` → \`compliance_check\`
2. **多方案对比** → \`calculate_mix_design\` × N → \`cost_optimization\`
3. **报价单** → \`calculate_mix_design\` → \`prepare_quote_draft\`
4. **原材料检测报告** → \`performance_prediction\` + \`compliance_check\`
5. **PDF 知识源报告** → (不调计算 Skill) → 仅用 \`workspace_search\` / \`workspace_readPage\` 检索

## workspace 工具软提示

读工作区资料时：\`workspace_search(query)\` → \`workspace_readPage(path)\`。
写报告时：\`payload = { title, sections: [{type:'h1'|'h2'|'p'|'list'|'table'|'code', ...}] }\` → \`workspace_writeFile({ type:'docx'|'xlsx'|'md', filename, payload })\`。**payload 必须包含 sections 数组**——只传 title 会只生成标题没正文。`

/**
 * 构造 system prompt
 * @param {Object} params
 * @param {string} params.memoryContext - AgentMemoryService.buildMemoryContext 的输出
 * @param {string[]} params.skillNames - 当前 session 可用技能名列表
 * @param {string} params.agentMdRules - agent.md 解析后的 Markdown（用户自定义规则）
 * @param {string} [params.preferenceSummary] - agent.md 偏好的中文摘要（用于注入 prompt）
 * @returns {string} 完整的 system prompt
 */
function buildSystemPrompt({ memoryContext = '', skillNames = [], agentMdRules = '', preferenceSummary = '' } = {}) {
  const skillList = skillNames.length > 0
    ? skillNames.map(s => `- ${s}`).join('\n')
    : '（当前无可用技能）'

  // 4KB 阈值警告
  const SIZE_LIMIT = 4 * 1024
  let rulesText = agentMdRules
  if (rulesText.length > SIZE_LIMIT) {
    rulesText = rulesText.slice(0, SIZE_LIMIT) + '\n\n（agent.md 过大，已截断。完整内容请查看文件）'
  }

  // 2000 token 警告（粗略按 2 字符/token）
  const totalLen = (memoryContext.length || 0) + (rulesText.length || 0)
  const tokenWarn = totalLen > 4000
    ? '\n\n⚠️ system prompt 接近 2000 token 上限，请精简 agent.md。'
    : ''

  return `你是混凝土配合比设计专家助手，名字叫"小砼"。

# 你的能力
1. 回答用户关于混凝土材料、配合比设计的问题
2. 调用内置工具查询材料、计算配合比
3. 学习和记忆用户偏好

# workspace 工具说明
${WORKSPACE_TOOLS_PROMPT}

# 当前可用技能
${skillList}

# 用户记忆
${memoryContext || '（无）'}
${preferenceSummary ? `# 用户偏好\n${preferenceSummary}\n` : ''}

# 用户自定义规则（agent.md）
${rulesText || '（未配置，使用系统默认）'}

${REPORT_SKILL_MATRIX}

# 回答风格
- 简洁专业，避免冗长
- 涉及数据时引用具体数值
- 不确定时主动调用工具查询
${tokenWarn}`
}

module.exports = { buildSystemPrompt, REPORT_SKILL_MATRIX }

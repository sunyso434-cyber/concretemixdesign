/**
 * 构造 system prompt（纯函数）
 */

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

# 当前可用技能
${skillList}

# 用户记忆
${memoryContext || '（无）'}
${preferenceSummary ? `# 用户偏好\n${preferenceSummary}\n` : ''}

# 用户自定义规则（agent.md）
${rulesText || '（未配置，使用系统默认）'}

# 回答风格
- 简洁专业，避免冗长
- 涉及数据时引用具体数值
- 不确定时主动调用工具查询
${tokenWarn}`
}

module.exports = { buildSystemPrompt }

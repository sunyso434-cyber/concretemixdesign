/**
 * 构造 system prompt（纯函数）
 */

// v1.5.3 决策：固定 7 个 workspace 工具说明（与 workspaceTools.js 注册的伪 Skill 一一对应）
// Task 4.4：注入到 system prompt，让 LLM 知道每个工具怎么用、返回什么
// v2026-06-22：listFiles 扩 enum + 加 ingested 状态字段（修「LLM 误判未导入」bug）
// v2026-07-17：新增 workspace_recordAnswer（Agent 自动回填问答到 wiki/answers/）
// Task 2.5：工具数不再硬编码，由 buildWorkspaceToolsPrompt(count) 动态注入（计数来自 buildSystemPrompt 统计）
const WORKSPACE_TOOLS_BODY = `
- workspace_search(query, topK) → 找相关 wiki 页（含 chat-history，不调 LLM）。**返回结果含 summary/keyPoints，大多数情况直接看结果即可回答。**
- workspace_readPage(wikiPath, {query?, depth?}) → 读 wiki 页。
  - depth='relevant'（默认）：返回相关段落原文（~2K tokens，纯本地，~200ms）
  - depth='full'：返回全文+LLM摘要（~8K tokens，5-15s）
- workspace_ingest(filename) → 原始文件入 wiki（自动调 KG 提取+LLM摘要）
- workspace_writeFile({ type, filename, payload }) → 写 md 到 reports/（仅支持 md 格式。docx/xlsx 请用 officecli 系列：create_office_file + edit_office_file）
- workspace_listFiles({ subdir, recursive?, includeDirs?, withIngestStatus? }) → 列出工作区条目
  **判断文件是否已导入时，务必用 subdir="root" + withIngestStatus=true，结果里每个文件带 ingested:true/false 字段**——别靠文件名猜。
  - subdir 可选：root / wiki / wiki/sources / wiki/reports / wiki/kg/sources / wiki/chat-history / reports / raw / raw/pdf / raw/docx / raw/xlsx / raw/md / raw/txt / raw/images / raw/json / raw/js / raw/others
  - recursive:true 递归子目录；includeDirs:true 列出目录条目
- workspace_lint() → 健康检查（不阻塞）
- workspace_searchGraph(query, topK) → 查询知识图谱，返回完整三元组。**前提：当前工作区必须已打开**。
- workspace_readRaw(filePath) → 读工作区任意**文本类**文件原文（.md/.txt/.json/.csv/.log/.js/.yaml 等），不经 wiki 摘要。
  - 用于查看用户临时放在根目录或 raw/ 下的补充资料原文
  - 二进制（.pdf/.docx/.xlsx 等）不支持，需先 workspace_ingest
  - 单文件超 300KB 自动截断
- workspace_organize({ filenames }) → 把根目录散落的指定文件按类型归位到 raw/{类型}/。**手动触发**：用户说"把 XX 归到 raw"或"整理这些文件"时调用。不自动扫描整个根目录。
- workspace_recordAnswer({ question, answer, refs? }) → 把本轮问答里"以后还用得上"的知识回填到 wiki/answers/。详见下方「何时回填问答」节。

raw/ 目录说明（v2026-07-03）：
- raw/ 是原始文件存放区，内部按类型分子目录（raw/pdf raw/docx raw/xlsx raw/md raw/txt raw/images 等）
- 文件拖进 raw/ 根下会**自动按类型归位**到对应子目录，然后自动 ingest
- 已在子目录但类型不符的文件**不会被自动移动**，会报告给用户，需用户确认
- 根目录的临时文件需手动用 workspace_organize 归位

重要：workspace_search 返回结果已含 summary/keyPoints。如果 keyPoints 已经能回答问题，不要调 workspace_readPage。
反模式：search 拿到了 keyPoints 里有答案，还去调 readPage → 浪费 token。

路由建议：
1. 先 workspace_search(query) → 看 keyPoints 是否够回答
2. 够了 → 直接回答，不要调 readPage
3. 不够 → workspace_readPage(path, {query, depth:'relevant'})
4. 涉及实体关系 → workspace_searchGraph(query)
5. 复杂问题 → 综合 search + searchGraph + readPage
6. 需看原始文件原文（非 wiki 摘要）→ workspace_readRaw(filePath)
7. workspace_grep 的 path 参数支持 raw 和 root，可搜原始文件

何时回填问答（workspace_recordAnswer）：
- **满足全部 3 条**才调一次：
  1. 回答里含**可复用的工程知识**（规范条文、参数阈值、施工要点、常见错误），不是临时数值计算（如"算下 C30 用量"）
  2. 当前 wiki 里**没有或不全**该知识（先用 workspace_search 验证一遍，搜得到就别重复）
  3. 用户**不是一次性查询**——"为什么水胶比不能超过 0.6"算知识性，"帮我算一下 C30"算一次性
- **不要调**：闲聊、报错排查、临时数值、不确定答案、用户明确说"别记下来"
- **典型该调的例子**：用户问"抗渗混凝土水胶比上限？"，你回答"≤0.45，依据 JTG 3420-2020 §5.2"，调一次把问答回填，refs=['sources/jtg-3420-2020.md']
- **典型不该调的例子**：用户问"我今天配的料够不够？"、"这个报错怎么修"、闲聊打招呼
`

/**
 * 生成 workspace 工具说明段（纯函数）
 * @param {number} registeredCount 实际注册的 workspace 工具数（来自 buildSystemPrompt 统计 skillInfos/skillNames）
 * @returns {string} 带动态工具数的 workspace 工具说明段
 */
function buildWorkspaceToolsPrompt(registeredCount) {
  // Task 2.5 兜底：没传技能数据时，用正文里实际罗列的工具数，
  // 避免出现「共 0 个」这种自相矛盾的输出（此前硬编码 8 也已陈旧）
  // WORKSPACE_TOOLS_BODY 是模块内固定常量，必然含 bullets，无需 || [] 防御
  const documentedCount = WORKSPACE_TOOLS_BODY.match(/\n- workspace_/g).length
  const count = registeredCount > 0 ? registeredCount : documentedCount
  return `可用 workspace 工具（共 ${count} 个）：${WORKSPACE_TOOLS_BODY}`
}

// 蓝图技能创建路由提示（按需加载策略）：
// 用户明确要创建"蓝图（blueprint）"类型的自定义配合比设计技能时，先调
// prepare_blueprint_authoring 拿到创作规范全文注入对话，再基于对话上下文
// 生成完整蓝图，最后调 create_skill(format='blueprint', rawBlueprint=...) 落盘。
// 不允许在没拿到创作规范的情况下直接猜蓝图字段。
const BLUEPRINT_AUTHORING_ROUTE = `## 创建蓝图技能的调用顺序
若用户明确要创建"蓝图（blueprint）"格式的配合比设计技能：
1. 先调 prepare_blueprint_authoring 获取蓝图创作规范全文；
2. 结合本对话上下文（规范、材料、参数）生成完整蓝图（=== meta.yaml === / === blueprint.yaml === / === tables/xxx.json === 分段）；
3. 调 create_skill(format='blueprint', rawBlueprint=<完整蓝图>) 完成落盘。
禁止跳过第 1 步直接猜蓝图字段。`

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
写 md 报告时：\`payload = { title, sections: [{type:'h1'|'h2'|'p'|'list'|'table'|'code', ...}] }\` → \`workspace_writeFile({ type:'md', filename, payload })\`。**payload 必须包含 sections 数组**——只传 title 会只生成标题没正文。\n写 docx/xlsx 时：**必须用 officecli 系列技能**。工作流：\`create_office_file\` 创建空白文档 → \`edit_office_file\` 批量添加内容（支持 add/set/add_table/replace，一次最多50个操作，支持 font.ea/font.latin/size/bold/firstLineIndent/lineSpacing 等完整格式属性） → \`read_office_file\` 校验。模板场景用 \`merge_office_template\`。`

/**
 * 构造 system prompt（v2）
 *
 * 改造点（Task 8）：
 * - 入参从 `{ memoryContext, agentMdRules, preferenceSummary, ... }` 改为 `{ memoryContext, userRulesMarkdown, ... }`
 * - 整段 agent.md 通过 `userRulesMarkdown` 单字段注入，外层用 HTML 注释包裹
 * - 删除 `SIZE_LIMIT` 截断 + `tokenWarn` 警告（v2 不再做 prompt 级尺寸管控）
 * - 删除 `preferenceSummary` 入参（agent.md 已是规则唯一来源，不再单独注入偏好摘要）
 *
 * @param {Object} params
 * @param {string} [params.memoryContext] - 用户历史记忆（来自 AgentMemoryService.buildHistoryMessages 之外的旁路）
 * @param {string[]} [params.skillNames] - 当前 session 可用技能名列表（降级用）
 * @param {Array<{name, category, description}>} [params.skillInfos] - 技能详细信息（按 category 分组生成第 4 段，零硬编码、零漏技能）
 * @param {string} [params.userRulesMarkdown] - agent.md 解析后的整段 Markdown（用 HTML 注释包裹注入）
 * @returns {string} 完整的 system prompt
 */
function buildSystemPrompt({
  memoryContext = '',
  userRulesMarkdown = '',
  skillNames = [],
  skillInfos = null,
  l3Summary = null,  // L3 核心记忆摘要（对标 MemGPT core memory）
  crossSessionBlock = '',  // P1-1: 跨会话摘要块
  softSkillSection = ''  // Task 4: 方法论 Skill 段（Layer 1，description 触发）
} = {}) {
  // Task 2.5：workspace 工具数动态化——从传入的技能列表统计实际注册的 workspace_ 前缀工具数，
  // 不再硬编码（此前写死 8，实际已增至 14，属陈旧数字）
  const workspaceToolCount = (() => {
    const src = skillInfos && skillInfos.length > 0
      ? skillInfos.map(s => s.name)
      : skillNames
    return src.filter(n => typeof n === 'string' && n.startsWith('workspace_')).length
  })()

  // 优先用 skillInfos（带 description + category）按类别分组生成；降级用 skillNames（只名字）
  let skillSection
  if (skillInfos && skillInfos.length > 0) {
    const groups = {}
    for (const s of skillInfos) {
      const cat = s.category || 'general'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(s)
    }
    const blocks = []
    for (const [cat, skills] of Object.entries(groups)) {
      // Task 2.5：description 截断到完整句子（以句子结束标点收尾，不硬切句中）
      const lines = skills.map(s => `- ${s.name}：${truncateToCompleteSentence(s.description)}`)
      blocks.push(`【${cat}】\n${lines.join('\n')}`)
    }
    skillSection = `（共 ${skillInfos.length} 个，按类别分组）\n\n${blocks.join('\n\n')}`
  } else {
    skillSection = skillNames.length > 0
      ? skillNames.map(s => `- ${s}`).join('\n')
      : '（当前无可用技能）'
  }

  // Task 4：方法论 Skill 段（Layer 1）— 只在 softSkillSection 非空时插入
  const softSkillBlock = softSkillSection
    ? `\n# 方法论 Skill (description 触发)\n${softSkillSection}\n`
    : ''

  // v2：用单一 userRulesMarkdown 段 + HTML 注释包裹
  const userRulesBlock = userRulesMarkdown
    ? `<!-- 老板自定义规则开始 -->\n${userRulesMarkdown}\n<!-- 老板自定义规则结束 -->`
    : '（未配置，使用系统默认）'

  // v2 P0：L3 核心记忆段（对标 MemGPT core memory + TencentDB L3）
  let l3Block = ''
  if (l3Summary && (l3Summary.currentSession || l3Summary.keyDecisions?.length || l3Summary.recalled?.length)) {
    const lines = []
    if (l3Summary.currentSession) lines.push(`- 当前会话：${l3Summary.currentSession}`)
    if (l3Summary.keyDecisions?.length) {
      lines.push(`- 老板关键决策：${l3Summary.keyDecisions.join('、')}`)
    }
    if (l3Summary.recalled?.length) {
      const recalled = l3Summary.recalled.map(r => `${r.summary}`).join('；')
      lines.push(`- 历史相关记忆：${recalled}`)
    }
    l3Block = `\n# 核心记忆摘要\n${lines.join('\n')}\n`
  }

  return `你是混凝土配合比设计专家助手，名字叫"小砼"。

# 你的能力
1. 回答用户关于混凝土材料、配合比设计的问题
2. 调用内置工具查询材料、计算配合比
3. 学习和记忆用户偏好

# workspace 工具说明
${buildWorkspaceToolsPrompt(workspaceToolCount)}

# 当前可用技能
${skillSection}
${softSkillBlock}
# 反模式（禁止）
不要硬编一个不在「当前可用技能」列表里的技能名。

# 用户记忆
${memoryContext || '（无）'}

# 用户自定义规则
${userRulesBlock}

${REPORT_SKILL_MATRIX}

${crossSessionBlock}

${BLUEPRINT_AUTHORING_ROUTE}

${SKILL_UPDATE_GUIDE}

${TODO_MANAGE_PROMPT}
${l3Block}
# 回答风格
- 简洁专业，避免冗长
- 涉及数据时引用具体数值
- 不确定时主动调用工具查询`
}

/**
 * 把 description 截断到完整句子（Task 2.5）
 *
 * 规则（maxLen 默认 30）：
 * 1. 不超过 maxLen 直接返回；
 * 2. 前 maxLen 内有句子结束标点（。！？.!?）→ 截到最后一个标点处（含标点）；
 * 3. 前 maxLen 内无标点 → 向后延伸到下一个句子结束标点（上限 maxLen*2，避免说明被无限拉长）；
 * 4. 仍无 → 退化为在最后一个空格处截断（不切英文单词），无空格则硬切到 maxLen。
 *
 * @param {string|null|undefined} text
 * @param {number} [maxLen]
 * @returns {string}
 */
function truncateToCompleteSentence(text, maxLen = 30) {
  if (!text) return ''
  if (text.length <= maxLen) return text
  const window = text.slice(0, maxLen)
  const SENTENCE_STOPS = ['.', '。', '?', '？', '!', '！']
  let cut = -1
  for (let i = 0; i < window.length; i++) {
    if (SENTENCE_STOPS.includes(window[i])) cut = i
  }
  if (cut === -1) {
    // 窗口内无句子结束标点 → 向后找下一个（上限 maxLen*2）
    const tail = text.slice(maxLen, maxLen * 2)
    const m = tail.match(/[.。?!！]/)
    if (m) cut = maxLen + m.index
  }
  if (cut !== -1) return text.slice(0, cut + 1)
  // 兜底：最后一个空格处截断（避免切断英文单词），无空格则硬切
  const sp = window.lastIndexOf(' ')
  return sp > 0 ? window.slice(0, sp) : window
}

// Task 3.2（2026-08-05）：≥5 步强制规划——任务自然拆解到 5 步及以上时，
// 先调 todo_manage(action='create_plan', steps=[...]) 提交计划，等老板审批通过后再执行（软约束）。
const TODO_MANAGE_PROMPT = `# 任务规划要求
凡是预估需要 3 步以上工具调用的任务，**必须先调 \`todo_manage(action='create', todos=[...])\`** 创建任务清单。
执行过程中每完成一步就调 \`todo_manage(action='complete', id=...)\` 标记完成。
这样老板能看到进度、你也不会跑偏。

# ≥5 步强制规划（create_plan + 审批）
任务自然拆解达到 **5 步及以上**时，**必须先调 \`todo_manage(action='create_plan', steps=[{content:'...', ...}, ...])\`** 提交计划，**等老板审批通过后再执行**。
- steps 每步至少带 content，可按需加 suggestedSkill / expectedParams / priority 等元数据
- 审批通过前不要擅自开始执行
- 审批通过后按计划逐步执行，每完成一步调 \`todo_manage(action='complete', id=...)\`
- 老板修改计划后重传 → \`todo_manage(action='replace_plan', steps=[...])\``

// v10.2.0 方案 10：技能更新场景专项指引
// 解决老板截图里 AI 反复失败的根因：不知道用 update、不知道 update 有 4 种粒度、失败后不主动停
const SKILL_UPDATE_GUIDE = `# 技能管理决策指引（v10.2.0）

## 创建 vs 更新
- 老板说"创建一个新技能" → \`create_skill\`
- 老板说"升级/修改/调整已有技能" → \`manage_skills(action='update')\`
- \`create_skill\` 报 NAME_EXISTS → **不要换名字重建**（会丢现有数据），改用 manage_skills update

## manage_skills update 的 4 种粒度（按优先级自动判断）
1. **整文件覆盖** → \`update(file='xxx.yaml', content=完整内容)\`
2. **局部文本 patch**（推荐，省 token）→ \`update(file='xxx.md', patch={find: "旧", replace: "新", replaceAll: false})\`
3. **JSON Patch**（仅 .json）→ \`update(file='tables/xxx.json', jsonPatch=[{op: "replace", path: "/0/field", value: ...}])\`
4. **蓝图全量替换** → \`update(rawBlueprint='=== meta.yaml === ... === blueprint.yaml === ...')\`

老板说"改一行/一处" → 优先用 patch；老板说"整体升级" → 用 rawBlueprint；都拿不准 → 用 content 整文件覆盖。

## 失败处理（强制）
- **同一工具失败 2 次** → 必须停下换策略（不再"再试一次"）
- **同一会话累计失败 3 次** → 停下汇报：当前进度 + 卡点 + 推荐方案
- 不要列 3 个方案甩给老板决策 → 给 1 个强推荐 + 1 句话理由 + 立即执行

## 工具调用前的认知检查
每次调工具前 3 问：
1. 这个工具真能解决老板的问题吗？（比如想改报告某段，调 workspace_writeFile payload 模式 vs patches 模式）
2. 参数全了吗？（skillName / file / find 三者别混）
3. 失败了用什么备选？（patch 失败 → 降级到 content；create_skill 失败 → 改 update）

## 蓝图技能工作流
1. \`manage_skills action='source'\` 读现有蓝图（meta + blueprint + tables）
2. 在脑里改完后用 \`rawBlueprint\` 一次写完（粒度粗但保证一致 + 自动备份）
3. 不要用 \`create_skill format='blueprint'\` 试图"重建"已有蓝图——会被 NAME_EXISTS 拒绝`

module.exports = { buildSystemPrompt, REPORT_SKILL_MATRIX, BLUEPRINT_AUTHORING_ROUTE, TODO_MANAGE_PROMPT, SKILL_UPDATE_GUIDE }

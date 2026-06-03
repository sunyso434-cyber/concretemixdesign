/**
 * 构造 system prompt（纯函数）
 *
 * 为什么独立成模块：
 * - 解决 P3-1：原 AgentOrchestrator._buildSystemPrompt (L287-371)
 *   和 UnifiedOrchestrator._buildSystemPrompt (L284-364)
 *   是完全相同的 80 行代码。抽到独立模块避免策略重构后再次重复。
 */

/**
 * 构造 system prompt
 * @param {Object} params
 * @param {string} params.memoryContext - AgentMemoryService.buildMemoryContext 的输出
 * @param {string[]} params.skillNames - 当前 session 可用技能名列表
 * @param {Object} params.preferences - 用户偏好
 * @returns {string} 完整的 system prompt
 */
function buildSystemPrompt({ memoryContext = '', skillNames = [], preferences = {} } = {}) {
  const skillList = skillNames.length > 0
    ? skillNames.map(s => `- ${s}`).join('\n')
    : '（当前无可用技能）'

  const prefText = Object.keys(preferences).length > 0
    ? JSON.stringify(preferences, null, 2)
    : '（无）'

  return `你是混凝土配合比设计专家助手，名字叫"小砼"。

# 你的能力
1. 回答用户关于混凝土材料、配合比设计的问题
2. 调用内置工具查询材料、计算配合比
3. 学习和记忆用户偏好

# 当前可用技能
${skillList}

# 用户记忆
${memoryContext || '（无）'}

# 用户偏好
${prefText}

# 回答风格
- 简洁专业，避免冗长
- 涉及数据时引用具体数值
- 不确定时主动调用工具查询
`
}

module.exports = { buildSystemPrompt }

/**
 * MD 技能占位符替换（纯函数）
 *
 * 为什么独立成模块：
 * - 修复 P0-1：旧实现用 for...Object.entries 逐个 replace，
 *   当 args 同时含 `user` 和 `user_id` 时，先替换 `user` 会破坏 `{{user_id}}`
 *   的完整性。改用一次性 map 修复。
 * - 解决 P0-3：原 SkillDebugger 通过 new AgentOrchestrator 拿这个方法，
 *   抽成纯函数后 SkillDebugger 不再硬依赖 AgentOrchestrator。
 */

/**
 * 把 args 注入 MD 技能正文，返回完整的子任务指令字符串
 * @param {Object} skill - MD 技能对象，需含 name 和 _mdBody
 * @param {Object} args - LLM 传入的参数对象
 * @returns {string} 完整的子任务指令
 */
function buildMDInstruction(skill, args = {}) {
  // 一次性 map 替换所有 {{key}} 占位符
  // 受 spec v2.0 风险表 B1 缓解措施：选一次性 map，对老用户影响最小
  const body = skill._mdBody.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (args[name] !== undefined) {
      return String(args[name])
    }
    return match
  })

  return `你现在要执行以下子任务。这个任务由用户自定义技能"${skill.name}"定义。
请严格按照下面的指令完成，完成后直接给出结果，不需要调用 create_skill 或其他管理工具。

---
${body}
---
`
}

module.exports = { buildMDInstruction }

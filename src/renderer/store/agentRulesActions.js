// AgentMd (用户自定义规则) 渲染端 actions
// 通过 preload 暴露的 window.electronAPI.agentMd 调用主进程 IPC

export async function loadAgentMd() {
  return await window.electronAPI.agentMd.load()
}

/**
 * 原始字符串保存（兼容残留入口；新代码请用 saveAgentMdRules）
 * @deprecated 渲染进程不应再手工拼 Markdown/YAML 字符串
 */
export async function saveAgentMd(content) {
  return await window.electronAPI.agentMd.save(content)
}

/**
 * 结构化保存（推荐）
 * 把整个 rules 对象交给主进程，由主进程 AgentMdParser.formatToMarkdown 统一序列化。
 * 这与设计文档 docs/superpowers/specs/2026-06-15-user-preference-redesign-design.md §5.2 一致：
 *   - 渲染进程只做 UI 状态，不做任何序列化
 *   - agent.md 文件 IO 只走主进程
 * @param {Object} rules - { version, replyStyle, professionalPrefs, ignoredSuggestionTypes,
 *                            workflow, customKnowledge, unknownSections }
 * @returns {Promise<{success: boolean, data?: {raw, parsed}, error?: string}>}
 */
export async function saveAgentMdRules(rules) {
  return await window.electronAPI.invoke('agent:rules:upsert', { rules })
}

export async function reloadAgentMd() {
  return await window.electronAPI.agentMd.reload()
}

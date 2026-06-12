// AgentMd (用户自定义规则) 渲染端 actions
// 通过 preload 暴露的 window.electronAPI.agentMd 调用主进程 IPC

export async function loadAgentMd() {
  return await window.electronAPI.agentMd.load()
}

export async function saveAgentMd(content) {
  return await window.electronAPI.agentMd.save(content)
}

export async function reloadAgentMd() {
  return await window.electronAPI.agentMd.reload()
}

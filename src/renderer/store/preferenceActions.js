// 偏好建议 IPC 包装（用 preload 通用 invoke，不在 preload 加具名方法）
export async function listSuggestions() {
  return await window.electronAPI.invoke('agent:suggestions:list')
}
export async function acceptSuggestion(id) {
  return await window.electronAPI.invoke('agent:suggestions:accept', { id })
}
export async function dismissSuggestion(id) {
  return await window.electronAPI.invoke('agent:suggestions:dismiss', { id })
}
export async function blacklistSuggestion(id, type) {
  return await window.electronAPI.invoke('agent:suggestions:blacklist', { id, type })
}
export function onSuggestionsNew(callback) {
  // 订阅主进程推送的 'agent:suggestions:new' 事件
  return window.electronAPI.on('agent:suggestions:new', (payload) => callback(payload))
}
export async function getPreferences() {
  return await window.electronAPI.invoke('agent:preferences:get')
}
export async function upsertPreferences(materials, method) {
  return await window.electronAPI.invoke('agent:preferences:upsert', { materials, method })
}
export async function deletePreference(index) {
  return await window.electronAPI.invoke('agent:preferences:delete', { index })
}
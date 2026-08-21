// agentHandler 偏好建议 IPC 域（从 agentHandler.js 拆分，优化项 2，行为不变）
// 由主文件 registerAgentHandlers 调用：registerPreferenceIpc(ipcMain, deps)
// deps: { getAgentMdService, AgentMdParser, v2ToV1Proxy }
// 拆分原则：仅移动注册闭包，channel 名、参数、返回结构原样保留。
const LearningService = require('../services/LearningService')
const { PreferenceSuggestion } = require('../db/database')

function registerPreferenceIpc(ipcMain, deps) {
  const { getAgentMdService, AgentMdParser, v2ToV1Proxy } = deps

  // ===== 偏好建议 IPC（spec §5.2）=====

  function _wrap(fn) {
    return async (event, payload) => {
      try {
        return await fn(event, payload)
      } catch (err) {
        console.error('[AgentHandler] preference IPC error:', err.message)
        return { success: false, error: err.message }
      }
    }
  }

  ipcMain.handle('agent:suggestions:list', _wrap(async () => {
    const suggestions = await LearningService.getSuggestions()
    return { success: true, suggestions }
  }))

  ipcMain.handle('agent:suggestions:accept', _wrap(async (_event, { id }) => {
    // v2 改造：直接从 DB 读 + 走 LearningService.acceptSuggestion
    const sugg = await PreferenceSuggestion.findByPk(id)
    if (!sugg || sugg.status !== 'pending') {
      return { success: false, error: '建议不存在或已被处理' }
    }
    // 合并到 agent.md.materials
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const prefs = v2ToV1Proxy(cached.parsed).professionalPrefs
    // payload JSON 中含 proposedYaml（detect 阶段写入），兼容 v1 直接放顶层的旧数据
    const newItem = sugg.payload?.proposedYaml || sugg.proposedYaml
    if (newItem.method) {
      prefs.method = newItem.method
    } else {
      // 避免重复（结构化比较）
      const exists = prefs.materials.some(m =>
        m.category === newItem.category &&
        m.dimension === newItem.dimension &&
        (m.metric || '') === (newItem.metric || '') &&
        (m.value || '') === (newItem.value || '')
      )
      if (!exists) prefs.materials.push(newItem)
    }
    v2ToV1Proxy(cached.parsed).professionalPrefs = prefs
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    // 标 accepted 并触发 Mneme +0.05 + lastRecalledAt
    await LearningService.acceptSuggestion(id)
    return { success: true, newMaterials: prefs.materials }
  }))

  ipcMain.handle('agent:suggestions:dismiss', _wrap(async (_event, { id }) => {
    const [count] = await PreferenceSuggestion.update(
      { status: 'rejected' },
      { where: { id, status: 'pending' } }
    )
    if (count === 0) {
      return { success: false, error: '建议不存在或已被处理' }
    }
    return { success: true }
  }))

  ipcMain.handle('agent:suggestions:blacklist', _wrap(async (_event, { id, type }) => {
    await PreferenceSuggestion.update(
      { status: 'rejected' },
      { where: { id, status: 'pending' } }
    )
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const list = v2ToV1Proxy(cached.parsed).ignoredSuggestionTypes
    if (!list.includes(type)) {
      list.push(type)
    }
    v2ToV1Proxy(cached.parsed).ignoredSuggestionTypes = list
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    return { success: true }
  }))

  ipcMain.handle('agent:preferences:get', _wrap(async () => {
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const prefs = v2ToV1Proxy(cached.parsed).professionalPrefs
    return { materials: prefs.materials, method: prefs.method }
  }))

  ipcMain.handle('agent:preferences:upsert', _wrap(async (_event, { materials, method }) => {
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    v2ToV1Proxy(cached.parsed).professionalPrefs = { materials, method }
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    return { success: true }
  }))

  ipcMain.handle('agent:preferences:delete', _wrap(async (_event, { index }) => {
    const agentMdSvc = getAgentMdService()
    const cached = agentMdSvc.getCached()
    const mats = v2ToV1Proxy(cached.parsed).professionalPrefs.materials
    if (index < 0 || index >= mats.length) {
      return { success: false, error: `索引越界: ${index}` }
    }
    mats.splice(index, 1)
    v2ToV1Proxy(cached.parsed).professionalPrefs.materials = mats
    await agentMdSvc.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
    return { success: true }
  }))
}

module.exports = { registerPreferenceIpc }
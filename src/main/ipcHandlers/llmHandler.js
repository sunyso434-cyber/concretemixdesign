const { ipcMain } = require('electron')
const SystemService = require('../services/SystemService')
const axios = require('axios')

function registerLlmHandlers() {
  // 获取所有 LLM 配置列表
  ipcMain.handle('llm:list', async () => {
    try {
      const configs = await SystemService.getLlmConfigs()
      const activeConfig = await SystemService.getActiveLlmConfig()
      return {
        success: true,
        data: configs.map(c => ({
          ...c,
          apiKey: c.apiKey ? maskApiKey(c.apiKey) : ''
        })),
        activeId: activeConfig?.id || null,
        presets: SystemService.getLlmProviderPresets()
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 保存 LLM 配置（新增或更新）
  ipcMain.handle('llm:save', async (_event, { config }) => {
    try {
      if (!config.id) {
        config.id = `llm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      }
      if (!config.name) config.name = config.provider || '未命名'

      // 合并厂商默认配置和特性开关
      const presets = SystemService.getLlmProviderPresets()
      const preset = presets.find(p => p.value === config.provider)
      if (preset) {
        if (!config.baseUrl) config.baseUrl = preset.baseUrl
        // features：用户可覆盖厂商默认特性（如手动开启 visionCapable）
        config.features = { ...(preset.features || {}), ...(config.features || {}) }
        const defaults = preset.defaults || {}
        if (!config.model && defaults.model) config.model = defaults.model
        if (config.maxTokens === undefined && defaults.maxTokens !== undefined) config.maxTokens = defaults.maxTokens
        if (config.timeout === undefined && defaults.timeout !== undefined) config.timeout = defaults.timeout
        if (config.contextLimit === undefined && defaults.contextLimit !== undefined) config.contextLimit = defaults.contextLimit
        if (config.thinkingEnabled === undefined && defaults.thinkingEnabled !== undefined) config.thinkingEnabled = defaults.thinkingEnabled
        if (config.reasoningEffort === undefined && defaults.reasoningEffort !== undefined) config.reasoningEffort = defaults.reasoningEffort
        // visionCapable 默认从厂商 supportsVision 继承，用户可手动覆盖
        if (config.visionCapable === undefined && preset.features?.supportsVision !== undefined) {
          config.visionCapable = preset.features.supportsVision
        }
      }

      const allConfigs = await SystemService.getLlmConfigs()
      const idx = allConfigs.findIndex(c => c.id === config.id)
      if (idx >= 0) {
        // 安全（2026-08-22 审查）：编辑已有配置时空 apiKey 表示"不修改密钥"，
        // 渲染端不再需要回传完整 key（llm:getFull 通道已删除）
        if (!config.apiKey) config.apiKey = allConfigs[idx].apiKey
        allConfigs[idx] = config
      } else {
        allConfigs.push(config)
      }
      await SystemService.saveLlmConfigs(allConfigs)
      return { success: true, data: config }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 删除 LLM 配置
  ipcMain.handle('llm:delete', async (_event, { id }) => {
    try {
      const allConfigs = await SystemService.getLlmConfigs()
      const filtered = allConfigs.filter(c => c.id !== id)
      await SystemService.saveLlmConfigs(filtered)
      const activeConfig = await SystemService.getActiveLlmConfig()
      if (activeConfig?.id === id && filtered.length > 0) {
        await SystemService.setActiveLlmConfig(filtered[0].id)
      } else if (filtered.length === 0) {
        await SystemService.setParam('activeLlmConfigId', '', 'ai', '当前生效的 LLM 配置 ID')
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 激活指定 LLM 配置
  ipcMain.handle('llm:activate', async (_event, { id }) => {
    try {
      const allConfigs = await SystemService.getLlmConfigs()
      const found = allConfigs.find(c => c.id === id)
      if (!found) {
        return { success: false, error: '配置不存在' }
      }
      await SystemService.setActiveLlmConfig(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 获取当前激活的 LLM 配置
  ipcMain.handle('llm:getActive', async () => {
    try {
      const config = await SystemService.getActiveLlmConfig()
      if (!config) {
        return { success: false, error: '未配置 LLM' }
      }
      return { success: true, data: { ...config, apiKey: maskApiKey(config.apiKey) } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 测试 LLM 连通性
  // 安全（2026-08-22 审查）：支持传 { id } 由主进程自取配置测试——渲染端全程不接触未脱敏 apiKey
  ipcMain.handle('llm:test', async (_event, { config, id } = {}) => {
    try {
      let cfg = config
      if (!cfg && id) {
        const configs = await SystemService.getLlmConfigs()
        cfg = configs.find(c => c.id === id)
        if (!cfg) return { success: false, error: '配置不存在' }
      }
      if (!cfg) return { success: false, error: '缺少测试配置' }
      const baseUrl = (cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')
      const response = await axios.post(`${baseUrl}/chat/completions`, {
        model: cfg.model || 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 10,
        stream: false,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey}`
        },
        timeout: 60000,
      })
      if (response.data?.choices?.[0]?.message) {
        return { success: true, message: '连接成功' }
      }
      return { success: false, error: '响应格式异常' }
    } catch (err) {
      const status = err.response?.status
      if (status === 401 || status === 403) {
        return { success: false, error: 'API Key 无效，请检查并重新输入' }
      }
      if (status === 404) {
        return { success: false, error: '模型不存在或接口地址错误，请检查 model / base URL' }
      }
      if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        return { success: false, error: '无法连接到服务器，请检查 base URL' }
      }
      if (err.code === 'ECONNABORTED') {
        return { success: false, error: '连接超时' }
      }
      return { success: false, error: `连接失败: ${err.message}` }
    }
  })
}

function maskApiKey(key) {
  if (!key) return ''
  if (key.length < 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

module.exports = { registerLlmHandlers }
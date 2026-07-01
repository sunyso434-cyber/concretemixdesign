// src/main/ipcHandlers/slashCommandHandler.js
const { ipcMain } = require('electron')
const SystemService = require('../services/SystemService')

let _deepseekServiceInstance = null
let _skillRegistry = null
let _skillExecutor = null

function registerSlashCommandHandler({ deepseekService, skillRegistry, skillExecutor }) {
  _deepseekServiceInstance = deepseekService
  _skillRegistry = skillRegistry
  _skillExecutor = skillExecutor

  try { ipcMain.removeHandler('slash:execute') } catch (_) {}

  ipcMain.handle('slash:execute', async (_event, { command, param }) => {
    return await executeSlashCommand({ command, param })
  })
}

async function executeSlashCommand({ command, param }) {
  try {
    switch (command) {
      case 'model':
        return await handleModel(param)
      case 'rounds':
        return await handleRounds(param)
      case 'clear':
        return { success: true, action: 'clear', message: '对话已清空' }
      case 'help':
        return { success: true, action: 'help', message: formatHelp() }
      default:
        return handleSkillCommand(command, param)
    }
  } catch (err) {
    console.error('[slashCommandHandler] error:', err)
    return { success: false, error: err.message }
  }
}

async function handleModel(param) {
  if (!param) {
    // 无参：列出所有配置 + 当前配置的可用模型
    const configs = await SystemService.getLlmConfigs()
    const activeConfig = await SystemService.getActiveLlmConfig()
    let msg = '=== LLM 配置列表 ===\n'
    for (const c of configs) {
      const marker = c.id === activeConfig?.id ? ' ✅' : ''
      const modelInfo = c.model ? ` (${c.model})` : ''
      msg += `  [${c.id}] ${c.name}${marker}${modelInfo}\n`
    }
    msg += `\n当前配置：${activeConfig?.name || '无'}`
    const availableModels = _deepseekServiceInstance?.getAvailableModels?.()
    if (availableModels && availableModels.length > 0) {
      msg += `\n当前模型：${availableModels.join(', ')}`
    }
    msg += '\n\n切换命令：\n'
    msg += '  /model <配置名或ID>    切换到指定 LLM 配置\n'
    msg += '  /model <模型名>        仅切换当前配置的模型\n'
    msg += '\n例如：/model agnes-default  /model deepseek-v4-pro'
    return { success: true, action: 'list', message: msg }
  }

  // 有参：先尝试按配置名/ID匹配
  const configs = await SystemService.getLlmConfigs()
  const matchedConfig = configs.find(c => c.id === param || c.name === param)
  if (matchedConfig) {
    await SystemService.setActiveLlmConfig(matchedConfig.id)
    if (_deepseekServiceInstance && !_deepseekServiceInstance.isLegacy) {
      _deepseekServiceInstance.clearConfigCache()
    }
    return { success: true, message: `已切换到配置：${matchedConfig.name}（${matchedConfig.model || '默认模型'}）` }
  }

  // 未匹配配置名，尝试按当前配置切换模型
  const activeConfig = await SystemService.getActiveLlmConfig()
  if (!activeConfig) {
    return { success: false, error: '无有效 LLM 配置' }
  }
  activeConfig.model = param
  const idx = configs.findIndex(c => c.id === activeConfig.id)
  if (idx >= 0) {
    configs[idx].model = param
    await SystemService.saveLlmConfigs(configs)
  }
  if (_deepseekServiceInstance) {
    _deepseekServiceInstance.clearConfigCache()
  }
  return { success: true, message: `模型已设为 ${param}` }
}

async function handleRounds(param) {
  if (!param) {
    const current = await SystemService.getParamByName('agentMaxSteps')
    return {
      success: true,
      action: 'list',
      message: `当前循环次数：${current?.value || 10}\n可用范围：1-30\n\n设置命令：/rounds <次数>\n例如：/rounds 20`
    }
  }
  const n = parseInt(param, 10)
  if (isNaN(n) || n < 1 || n > 30) {
    return { success: false, error: '循环次数必须是 1 到 30 之间的整数' }
  }
  await SystemService.setParam('agentMaxSteps', String(n), 'ai', 'Agent 最大循环步数')
  _deepseekServiceInstance.clearConfigCache()
  return { success: true, message: `循环次数已设为 ${n}` }
}

function formatHelp() {
  return '可用命令：\n' +
    '  /model [配置名/模型名]  切换 LLM 配置或模型\n' +
    '  /rounds [次数]         设置循环次数（1-30）\n' +
    '  /clear                 清空对话\n' +
    '  /help                  显示帮助\n' +
    '  /<技能名> [参数]       调用技能\n\n' +
    '命令可嵌入消息任意位置，例如：\n' +
    '  帮我看看 /model agnes-default 然后帮我设计C30'
}

async function handleSkillCommand(command, param) {
  if (_skillRegistry && _skillRegistry.has(command)) {
    // 调技能的语义：告诉 LLM 我要用这个技能来做这个事情（不是给技能传结构化参数）。
    // 真正的参数（结构化字段如 cementId/sandIds）由 LLM 工具调用机制自然处理。
    // 因此这里不直接执行技能，而是返回 skill_prompt 标记，前端把消息转发给 LLM。
    return {
      success: true,
      action: 'skill_prompt',
      skillName: command,
      prompt: param || ''
    }
  }
  return { success: false, error: `未知命令: /${command}` }
}

module.exports = { registerSlashCommandHandler }

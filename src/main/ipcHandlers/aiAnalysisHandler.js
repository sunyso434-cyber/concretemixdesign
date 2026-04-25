/**
 * AI配合比分析 IPC Handler
 * 处理前端发送的AI分析请求
 */

const DeepSeekService = require('../services/DeepSeekService')
const SystemService = require('../services/SystemService')

// 从系统参数获取API密钥
const getDeepSeekApiKey = async () => {
  try {
    const result = await SystemService.getParamByName('deepseekApiKey')
    if (result && result.paramValue) {
      return result.paramValue
    }
    return null
  } catch (error) {
    console.error('获取DeepSeek API密钥失败:', error)
    return null
  }
}

let deepSeekService = null
let cachedApiKey = null

// 获取或创建DeepSeek服务实例
const getDeepSeekService = async () => {
  const apiKey = await getDeepSeekApiKey()
  if (!apiKey) {
    return null
  }
  if (!deepSeekService || cachedApiKey !== apiKey) {
    deepSeekService = new DeepSeekService(apiKey)
    cachedApiKey = apiKey
  }
  return deepSeekService
}

/**
 * 分析配合比数据
 */
const analyzeMixDesign = async (event, data) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API未配置，请在系统设置中配置API密钥')
  }

  try {
    const result = await service.analyzeMixDesign(data)
    return result
  } catch (error) {
    console.error('AI分析失败:', error)
    throw error
  }
}

/**
 * 检查API配置状态
 */
const checkApiStatus = async () => {
  const apiKey = await getDeepSeekApiKey()
  return {
    configured: !!apiKey,
    message: apiKey ? 'API已配置' : 'API未配置，请在系统设置中配置DeepSeek API密钥'
  }
}

/**
 * 与AI对话
 */
const chatWithAI = async (event, { message, context }) => {
  const service = await getDeepSeekService()
  if (!service) {
    throw new Error('DeepSeek API未配置，请在系统设置中配置API密钥')
  }

  try {
    const result = await service.chat(message, context)
    return result
  } catch (error) {
    console.error('AI对话失败:', error)
    throw error
  }
}

/**
 * 清空对话历史
 */
const clearChatHistory = async () => {
  const service = await getDeepSeekService()
  if (service) {
    service.clearHistory()
  }
  return { success: true }
}

/**
 * 注册IPC处理器
 */
const registerHandlers = (ipcMain) => {
  ipcMain.handle('aiAnalysis:analyze', analyzeMixDesign)
  ipcMain.handle('aiAnalysis:checkStatus', checkApiStatus)
  ipcMain.handle('aiAnalysis:chat', chatWithAI)
  ipcMain.handle('aiAnalysis:clearHistory', clearChatHistory)
  console.log('AI Analysis IPC handlers registered')
}

// 自动注册处理器
const { ipcMain } = require('electron')
registerHandlers(ipcMain)

module.exports = {
  register: registerHandlers,
  analyzeMixDesign,
  checkApiStatus,
  chatWithAI,
  clearChatHistory
}

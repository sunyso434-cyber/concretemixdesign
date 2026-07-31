const TrialTestService = require('../services/TrialTestService')

/**
 * 创建试配记录
 */
const createRecord = async (event, data) => {
  try {
    const result = await TrialTestService.createRecord(data)
    return { success: true, ...result }
  } catch (error) {
    console.error('[TrialTest] 创建试配记录失败:', error)
    return {
      success: false,
      error: `创建试配记录失败: ${error.message}`
    }
  }
}

/**
 * 查询试配记录列表
 */
const listRecords = async (event, { status } = {}) => {
  try {
    const records = await TrialTestService.listRecords(status)
    return { success: true, records }
  } catch (error) {
    console.error('[TrialTest] 查询试配记录失败:', error)
    return {
      success: false,
      error: `查询试配记录失败: ${error.message}`
    }
  }
}

/**
 * 获取单条试配记录
 */
const getRecord = async (event, { id }) => {
  try {
    const record = await TrialTestService.getRecord(id)
    return { success: true, record }
  } catch (error) {
    console.error('[TrialTest] 获取试配记录失败:', error)
    return {
      success: false,
      error: `获取试配记录失败: ${error.message}`
    }
  }
}

/**
 * 重新预测偏差分析
 */
const repredictRecord = async (event, { id }) => {
  try {
    const record = await TrialTestService.repredict(id)
    if (!record) return { success: false, error: '记录不存在' }
    return { success: true, record }
  } catch (error) {
    console.error('[TrialTest] 重新预测失败:', error)
    return {
      success: false,
      error: `重新预测失败: ${error.message}`
    }
  }
}

const registerHandlers = (ipcMain) => {
  ipcMain.handle('trialtest:create', createRecord)
  ipcMain.handle('trialtest:list', listRecords)
  ipcMain.handle('trialtest:get', getRecord)
  ipcMain.handle('trialtest:repredict', repredictRecord)
  console.log('TrialTest IPC handlers registered')
}

module.exports = { registerHandlers, createRecord, listRecords, getRecord, repredictRecord }

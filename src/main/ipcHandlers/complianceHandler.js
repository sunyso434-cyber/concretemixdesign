/**
 * 规范审查 IPC Handler
 * 处理规范知识包管理和合规审查请求
 */

const standardKnowledgeService = require('../services/StandardKnowledgeService')
const StandardComplianceService = require('../services/StandardComplianceService')
const SystemService = require('../services/SystemService')
const DeepSeekService = require('../services/DeepSeekService')

// 从系统参数获取API密钥
const getDeepSeekApiKey = async () => {
  try {
    const result = await SystemService.getParamByName('deepseekApiKey')
    if (result && result.value) {
      return result.value
    }
    return null
  } catch (error) {
    console.error('[ComplianceHandler] 获取DeepSeek API密钥失败:', error)
    return null
  }
}

/**
 * 上传PDF构建规范知识包
 */
const uploadStandard = async (event, { filePath, standardId, standardName, version }) => {
  try {
    if (!filePath || !standardId || !standardName) {
      return {
        success: false,
        error: '缺少必填参数：filePath, standardId, standardName'
      }
    }
    const result = await standardKnowledgeService.buildKnowledgePackage({
      filePath,
      standardId,
      standardName,
      version: version || ''
    })
    return result
  } catch (error) {
    console.error('[ComplianceHandler] 上传规范失败:', error)
    return {
      success: false,
      error: `上传规范失败: ${error.message}`
    }
  }
}

/**
 * 列出所有规范知识包
 */
const listStandards = async () => {
  try {
    const result = await standardKnowledgeService.listKnowledgePackages()
    return result
  } catch (error) {
    console.error('[ComplianceHandler] 列出规范失败:', error)
    return {
      success: false,
      error: `获取规范列表失败: ${error.message}`
    }
  }
}

/**
 * 删除规范知识包
 */
const deleteStandard = async (event, { standardId }) => {
  try {
    if (!standardId) {
      return {
        success: false,
        error: '缺少必填参数：standardId'
      }
    }
    const result = await standardKnowledgeService.deleteKnowledgePackage(standardId)
    return result
  } catch (error) {
    console.error('[ComplianceHandler] 删除规范失败:', error)
    return {
      success: false,
      error: `删除规范失败: ${error.message}`
    }
  }
}

/**
 * 获取规范详情
 */
const getStandardDetail = async (event, { standardId }) => {
  try {
    if (!standardId) {
      return {
        success: false,
        error: '缺少必填参数：standardId'
      }
    }
    const result = await standardKnowledgeService.getKnowledgePackageDetail(standardId)
    return result
  } catch (error) {
    console.error('[ComplianceHandler] 获取规范详情失败:', error)
    return {
      success: false,
      error: `获取规范详情失败: ${error.message}`
    }
  }
}

/**
 * 执行规范审查
 */
const checkCompliance = async (event, { mixDesign, standards }) => {
  try {
    // 检查 API Key 是否已配置
    const apiKey = await getDeepSeekApiKey()
    if (!apiKey) {
      return {
        success: false,
        error: 'DeepSeek API未配置，请在系统设置中配置API密钥'
      }
    }

    const dsService = new DeepSeekService(apiKey)
    const complianceService = new StandardComplianceService(dsService)
    const report = await complianceService.check(mixDesign, standards || null)
    return report
  } catch (error) {
    console.error('[ComplianceHandler] 规范审查失败:', error)
    return {
      success: false,
      error: `规范审查失败: ${error.message}`
    }
  }
}

const registerHandlers = (ipcMain) => {
  ipcMain.handle('standards:upload', uploadStandard)
  ipcMain.handle('standards:list', listStandards)
  ipcMain.handle('standards:delete', deleteStandard)
  ipcMain.handle('standards:getDetail', getStandardDetail)
  ipcMain.handle('compliance:check', checkCompliance)
  console.log('Compliance IPC handlers registered')
}

module.exports = { registerHandlers, uploadStandard, listStandards, deleteStandard, getStandardDetail, checkCompliance }
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

// 步骤中文映射
const STAGE_LABELS = {
  chunk: '文本分块',
  extract: 'AI提取条款',
  embed: '计算向量',
  save: '保存知识包',
  done: '完成'
}

/**
 * 上传 Markdown 构建规范知识包（后台任务+进度推送）
 */
const uploadStandard = async (event, { filePath, standardName, version, category, aliases }) => {
  if (!filePath || !standardName) {
    return { success: false, error: '缺少必填参数：filePath, standardName' }
  }

  try {
    // 后台执行，通过 onProgress 推送进度到前端
    const result = await standardKnowledgeService.buildFromPdf(filePath, {
      name: standardName,
      version: version || '',
      category,
      aliases,
      onProgress: (stage, message, percent) => {
        event.sender.send('standards:upload-progress', {
          stage,
          stageLabel: STAGE_LABELS[stage] || stage,
          message,
          percent
        })
      }
    })

    // 完成通知
    event.sender.send('standards:upload-progress', {
      stage: 'done',
      stageLabel: STAGE_LABELS.done,
      message: '知识包构建完成',
      percent: 100
    })

    return result
  } catch (error) {
    console.error('[ComplianceHandler] 上传规范失败:', error)
    return { success: false, error: `上传规范失败: ${error.message}` }
  }
}

/**
 * 列出所有规范知识包
 */
const listStandards = async () => {
  try {
    const result = await standardKnowledgeService.listStandards()
    return result
  } catch (error) {
    console.error('[ComplianceHandler] 列出规范失败:', error)
    return []
  }
}

/**
 * 删除规范知识包
 */
const deleteStandard = async (event, { standardId }) => {
  try {
    if (!standardId) {
      return { success: false, error: '缺少必填参数：standardId' }
    }
    const result = await standardKnowledgeService.deleteStandard(standardId)
    return result
  } catch (error) {
    console.error('[ComplianceHandler] 删除规范失败:', error)
    return { success: false, error: `删除规范失败: ${error.message}` }
  }
}

/**
 * 获取规范详情
 */
const getStandardDetail = async (event, { standardId }) => {
  try {
    if (!standardId) {
      return { success: false, error: '缺少必填参数：standardId' }
    }
    const result = await standardKnowledgeService.getStandardDetail(standardId)
    return result
  } catch (error) {
    console.error('[ComplianceHandler] 获取规范详情失败:', error)
    return { success: false, error: `获取规范详情失败: ${error.message}` }
  }
}

/**
 * 执行规范审查
 */
const checkCompliance = async (event, { mixDesign, standards, standardNames, standardCategories }) => {
  try {
    const apiKey = await getDeepSeekApiKey()
    if (!apiKey) {
      return { success: false, error: 'DeepSeek API未配置，请在系统设置中配置API密钥' }
    }

    const dsService = new DeepSeekService(apiKey)
    const complianceService = new StandardComplianceService(dsService)
    const report = await complianceService.check(mixDesign, {
      standards: standards || [],
      standardNames: standardNames || [],
      standardCategories: standardCategories || []
    })
    return report
  } catch (error) {
    console.error('[ComplianceHandler] 规范审查失败:', error)
    return { success: false, error: `规范审查失败: ${error.message}` }
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

/**
 * 保存配合比 Skill
 * 保存配合比方案到方案库
 */

module.exports = {
  name: 'save_mix_design',
  description: '保存配合比方案到方案库。当用户要求保存当前设计方案时调用。',
  version: '1.0.0',
  category: 'save',
  requiresConfirmation: true,

  parameters: {
    name: {
      type: 'string',
      description: '方案名称',
      required: false
    },
    projectName: {
      type: 'string',
      description: '项目名称',
      required: false
    }
  },

  errors: {
    SAVE_FAILED: {
      code: 'SAVE_FAILED',
      message: '保存配合比失败',
      hint: '请检查配合比数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { logger } = context

    logger.info('保存配合比方案')

    try {
      // 调用现有的保存逻辑
      const { executeToolCall } = require('../ipcHandlers/aiAnalysisHandler')
      const result = await executeToolCall('save_mix_design', args)
      return result
    } catch (error) {
      logger.error('保存配合比失败:', error)
      return {
        success: false,
        error: this.errors.SAVE_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}

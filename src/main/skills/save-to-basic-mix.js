/**
 * 保存到基准配合比库 Skill
 * 保存配合比到基准配合比库供后续使用
 */

module.exports = {
  name: 'save_to_basic_mix_library',
  description: '保存配合比到基准配合比库。当用户要求保存到基准库或后续需要用于报价时调用。',
  version: '1.0.0',
  category: 'save',
  requiresConfirmation: true,

  parameters: {
    name: {
      type: 'string',
      description: '配合比名称',
      required: false
    },
    strengthGrade: {
      type: 'string',
      description: '强度等级，如 C30',
      required: false
    }
  },

  errors: {
    SAVE_FAILED: {
      code: 'SAVE_FAILED',
      message: '保存到基准配合比库失败',
      hint: '请检查配合比数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { logger } = context

    logger.info('保存到基准配合比库')

    try {
      const { executeToolCall } = require('../ipcHandlers/aiAnalysisHandler')
      const result = await executeToolCall('save_to_basic_mix_library', args)
      return result
    } catch (error) {
      logger.error('保存到基准配合比库失败:', error)
      return {
        success: false,
        error: this.errors.SAVE_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}

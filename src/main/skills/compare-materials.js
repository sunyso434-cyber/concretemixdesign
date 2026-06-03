/**
 * 材料对比 Skill
 * 对比不同材料对配合比结果的影响
 */

module.exports = {
  name: 'compare_materials',
  description: '对比不同材料对配合比结果的影响。当用户想比较多种材料时调用。',
  version: '1.0.0',
  category: 'analysis',

  parameters: {
    strength: {
      type: 'string',
      description: '强度等级，如 C30',
      required: true
    },
    slump: {
      type: 'number',
      description: '坍落度(mm)',
      required: true
    },
    compareType: {
      type: 'string',
      description: '对比类型：cement/sand/stone/flyAsh/slag',
      required: true
    },
    baseParams: {
      type: 'object',
      description: '基准配合比参数',
      required: true
    },
    candidateIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '候选材料ID列表',
      required: true
    }
  },

  errors: {
    COMPARE_FAILED: {
      code: 'CALCULATION_FAILED',
      message: '材料对比失败',
      hint: '请检查材料ID是否正确',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { logger } = context

    logger.info(`开始材料对比: ${args.compareType}`)

    try {
      const { executeToolCall } = require('../ipcHandlers/aiAnalysisHandler')
      const result = await executeToolCall('compare_materials', args)
      return result
    } catch (error) {
      logger.error('材料对比失败:', error)
      return {
        success: false,
        error: this.errors.COMPARE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['materialService']
}

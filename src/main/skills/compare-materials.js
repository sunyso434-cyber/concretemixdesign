/**
 * 材料对比 Skill
 * 对比不同材料对配合比结果的影响
 */

module.exports = {
  name: 'compare_materials',
  description: '按**单个材料类别**做替换式对比：传入 1 个基准配合比 baseParams + compareType 指定类别（cement/sand/stone/flyAsh/slag）+ N 个候选材料 ID，逐个替换该类别后试算，返回 [{candidateId, mixResult, diffFromBase}, ...]。**必传 strength/slump/compareType/baseParams/candidateIds**。**与 calculate_mix_design 的区别**：mix_design 算 1 个方案；本工具算 N 个方案并列对比。当用户说"用这 3 个水泥分别算下，看哪个最合适"时调用。',
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

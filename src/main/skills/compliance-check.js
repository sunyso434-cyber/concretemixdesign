/**
 * 规范审查 Skill
 * 审查混凝土配合比是否符合规范要求
 */

module.exports = {
  name: 'check_compliance',
  description: '审查混凝土配合比是否符合规范要求。当用户想检查方案是否符合规范时调用。',
  version: '1.0.0',
  category: 'core',

  parameters: {
    mixDesign: {
      type: 'object',
      description: '配合比方案对象，包含 waterBinderRatio（水胶比）、cementContent（水泥用量）、sandRatio（砂率）等字段',
      required: true
    }
  },

  errors: {
    INVALID_MIX_DESIGN: {
      code: 'PARAM_INVALID_FORMAT',
      message: '配合比方案格式无效',
      hint: '请提供有效的配合比方案对象',
      recovery: 'fix_params'
    },
    COMPLIANCE_CHECK_FAILED: {
      code: 'COMPLIANCE_CHECK_FAILED',
      message: '规范审查失败',
      hint: '请检查配合比数据是否完整，或稍后重试',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { complianceService, logger } = context
    const { mixDesign } = args

    if (!mixDesign || typeof mixDesign !== 'object') {
      return { success: false, error: this.errors.INVALID_MIX_DESIGN }
    }

    logger.info('开始规范审查')

    try {
      const result = await complianceService.checkCompliance(mixDesign)
      logger.info(`规范审查完成: ${result.violations?.length || 0} 个违规项`)
      return { success: true, type: 'compliance', data: result }
    } catch (error) {
      logger.error('规范审查失败:', error)
      return {
        success: false,
        error: this.errors.COMPLIANCE_CHECK_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}

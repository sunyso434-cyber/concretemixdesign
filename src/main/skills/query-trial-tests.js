/**
 * 试配记录查询 Skill
 * 查看已录入的试配记录列表，支持按状态筛选
 */

module.exports = {
  name: 'query_trial_tests',
  description: '查询已录入的试配记录列表。可按状态筛选（已试配/已复核/驳回），查看配合比参数、实测值及偏差分析结果。触发词：查看试配、试配列表、试配记录、最近试配。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    status: {
      type: 'string',
      description: '按状态筛选：已试配 / 已复核 / 驳回。不填返回全部。',
      required: false,
      enum: ['已试配', '已复核', '驳回']
    }
  },

  errors: {
    QUERY_FAILED: {
      code: 'QUERY_FAILED',
      message: '查询试配记录失败',
      hint: '请稍后重试',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { trialTestService, logger } = context
    const { status } = args

    logger.info(`[query_trial_tests] 查询试配记录: status=${status || '全部'}`)

    try {
      const records = await trialTestService.listRecords(status)

      if (!records || records.length === 0) {
        return {
          success: true,
          count: 0,
          message: '暂无试配记录',
          records: []
        }
      }

      // 精简返回的关键字段，避免 token 浪费
      const summary = records.map(r => ({
        id: r.id,
        water_binder_ratio: r.water_binder_ratio,
        cement_amount: r.cement_amount,
        trialTestedStrength: r.trialTestedStrength,
        trialTestedSlump: r.trialTestedSlump,
        trialTestedDensity: r.trialTestedDensity,
        trialStatus: r.trialStatus,
        trialTestDate: r.trialTestDate,
        trialOperator: r.trialOperator,
        strengthDeviationPct: r.deviationAnalysis?.strengthDeviationPct,
        hasDeviation: r.deviationAnalysis?.strengthDeviationPct != null
          && Math.abs(r.deviationAnalysis.strengthDeviationPct) > 10
      }))

      logger.info(`[query_trial_tests] 查到 ${records.length} 条记录`)

      return {
        success: true,
        count: records.length,
        message: `共 ${records.length} 条试配记录`,
        records: summary
      }
    } catch (error) {
      logger.error('[query_trial_tests] 查询失败:', error)
      return {
        success: false,
        error: this.errors.QUERY_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['trialTestService']
}

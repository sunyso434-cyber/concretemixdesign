/**
 * 试配记录录入 Skill
 * 将用户口述的配合比信息和实测值录入 TrialTestRecord 表
 * 自动计算与 XGBoost 预测值的偏差分析
 */
// 2026-08-23 ESLint 首跑发现的真 bug：原代码直接使用未定义的 mixDesignService
// （ReferenceError 被 try/catch 吞掉，表现为"关联方案取用量"功能静默失效）
const MixDesignService = require('../services/MixDesignService')

module.exports = {
  name: 'record_trial_test',
  description: '记录混凝土试配实测数据。当用户口述配合比参数和实测强度/坍落度/容重时，调用此工具录入试配记录。触发词：记录试配、试配记录、录入试配、保存试配、新增试配。',
  version: '1.0.0',
  category: 'recording',
  isWrite: true,

  parameters: {
    water_binder_ratio: {
      type: 'number',
      description: '水胶比，例如 0.45',
      required: true
    },
    cement_amount: {
      type: 'number',
      description: '水泥用量 (kg/m³)，例如 360',
      required: true
    },
    trialTestedStrength: {
      type: 'number',
      description: '实测 28d 强度 (MPa)，例如 42.5',
      required: true
    },
    trialTestedSlump: {
      type: 'number',
      description: '实测坍落度 (mm)，例如 185',
      required: true
    },
    fly_ash_dosage: {
      type: 'number',
      description: '粉煤灰掺量 (%)',
      required: false
    },
    slag_dosage: {
      type: 'number',
      description: '矿渣粉掺量 (%)',
      required: false
    },
    lithium_slag_dosage: {
      type: 'number',
      description: '锂渣掺量 (%)',
      required: false
    },
    composite_powder_dosage: {
      type: 'number',
      description: '复合粉掺量 (%)',
      required: false
    },
    sand_ratio: {
      type: 'number',
      description: '砂率 (%)',
      required: false
    },
    water_amount: {
      type: 'number',
      description: '用水量 (kg/m³)',
      required: false
    },
    superplasticizer_dosage: {
      type: 'number',
      description: '减水剂设计掺量 (%)',
      required: false
    },
    fly_ash_amount: {
      type: 'number',
      description: '粉煤灰用量 (kg/m³)。若有关联方案(mixDesignId)且不传，自动从方案取',
      required: false
    },
    slag_amount: {
      type: 'number',
      description: '矿渣粉用量 (kg/m³)。若有关联方案且不传，自动从方案取',
      required: false
    },
    lithium_slag_amount: {
      type: 'number',
      description: '锂渣用量 (kg/m³)。若有关联方案且不传，自动从方案取',
      required: false
    },
    composite_powder_amount: {
      type: 'number',
      description: '复合粉用量 (kg/m³)。若有关联方案且不传，自动从方案取',
      required: false
    },
    sand_amount: {
      type: 'number',
      description: '砂总用量 (kg/m³)。若有关联方案且不传，自动从方案取；也可由 sand1_amount + sand2_amount 自动计算',
      required: false
    },
    sand1_amount: {
      type: 'number',
      description: '砂1用量 (kg/m³)，第一种细骨料的用量',
      required: false
    },
    sand2_amount: {
      type: 'number',
      description: '砂2用量 (kg/m³)，第二种细骨料的用量，允许为空',
      required: false
    },
    stone_amount: {
      type: 'number',
      description: '石总用量 (kg/m³)。若有关联方案且不传，自动从方案取；也可由 stone1_amount + stone2_amount 自动计算',
      required: false
    },
    stone1_amount: {
      type: 'number',
      description: '石1用量 (kg/m³)，第一种粗骨料的用量',
      required: false
    },
    stone2_amount: {
      type: 'number',
      description: '石2用量 (kg/m³)，第二种粗骨料的用量，允许为空',
      required: false
    },
    superplasticizer_amount: {
      type: 'number',
      description: '减水剂用量 (kg/m³)。若有关联方案且不传，自动从方案取',
      required: false
    },
    slump: {
      type: 'number',
      description: '设计坍落度 (mm)',
      required: false
    },
    trialTestedDensity: {
      type: 'number',
      description: '实测容重 (kg/m³)',
      required: false
    },
    trialTestedDosage: {
      type: 'number',
      description: '实测减水剂掺量 (%)',
      required: false
    },
    trialOperator: {
      type: 'string',
      description: '试配操作人员',
      required: false
    },
    trialNotes: {
      type: 'string',
      description: '备注',
      required: false
    },
    cementBatchId: {
      type: 'integer',
      description: '水泥批次 ID',
      required: false
    },
    flyAshBatchId: {
      type: 'integer',
      description: '粉煤灰批次 ID',
      required: false
    },
    slagBatchId: {
      type: 'integer',
      description: '矿渣粉批次 ID',
      required: false
    },
    lithiumSlagBatchId: {
      type: 'integer',
      description: '锂渣批次 ID',
      required: false
    },
    compositePowderBatchId: {
      type: 'integer',
      description: '复合粉批次 ID',
      required: false
    },
    sandBatchId: {
      type: 'array',
      description: '砂批次 ID 数组',
      required: false
    },
    stoneBatchId: {
      type: 'array',
      description: '石批次 ID 数组',
      required: false
    },
    superplasticizerBatchId: {
      type: 'integer',
      description: '减水剂批次 ID',
      required: false
    },
    mixDesignId: {
      type: 'integer',
      description: '关联配合比方案 ID',
      required: false
    }
  },

  errors: {
    CREATE_FAILED: {
      code: 'CREATE_FAILED',
      message: '试配记录保存失败',
      hint: '请检查数据是否完整，或稍后重试',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { trialTestService, logger } = context
    logger.info(`[record_trial_test] 录入试配: 水胶比=${args.water_binder_ratio}, 水泥=${args.cement_amount}, 实测强度=${args.trialTestedStrength}`)

    // 砂/石拆分字段自动汇总为总用量（AI 传了 sand1/sand2 但未传 sand_amount 时自动计算）
    if (args.sand_amount === undefined && (args.sand1_amount !== undefined || args.sand2_amount !== undefined)) {
      args.sand_amount = (args.sand1_amount || 0) + (args.sand2_amount || 0)
      logger.info(`[record_trial_test] 由 sand1_amount=${args.sand1_amount}, sand2_amount=${args.sand2_amount} 自动计算 sand_amount=${args.sand_amount}`)
    }
    if (args.stone_amount === undefined && (args.stone1_amount !== undefined || args.stone2_amount !== undefined)) {
      args.stone_amount = (args.stone1_amount || 0) + (args.stone2_amount || 0)
      logger.info(`[record_trial_test] 由 stone1_amount=${args.stone1_amount}, stone2_amount=${args.stone2_amount} 自动计算 stone_amount=${args.stone_amount}`)
    }

    // 若有关联方案，自动从方案取各材料用量（AI 传的优先，用于完整用量表展示）
    if (args.mixDesignId) {
      try {
        const design = await MixDesignService.getMixDesignById(args.mixDesignId)
        if (design) {
          const designData = typeof design.toJSON === 'function' ? design.toJSON() : design
          const amounts = designData.materials || {}
          const mapping = {
            cement_amount: 'cement',
            water_amount: 'water',
            fly_ash_amount: 'flyAsh',
            slag_amount: 'slag',
            lithium_slag_amount: 'lithiumSlag',
            composite_powder_amount: 'compositePowder',
            sand_amount: 'sand',
            stone_amount: 'stone',
            superplasticizer_amount: 'superplasticizer'
          }
          for (const [field, key] of Object.entries(mapping)) {
            if (args[field] === undefined && amounts[key] !== undefined) {
              args[field] = amounts[key]
              logger.info(`从方案 ${args.mixDesignId} 取用量: ${field}=${amounts[key]}`)
            }
          }
        }
      } catch (e) {
        logger.warn('从关联方案取用量失败（不影响录入）:', e.message)
      }
    }

    try {
      const response = await trialTestService.createRecord(args)
      const result = response?.record

      if (result && result.id) {
        const deviationInfo = result.deviationAnalysis
          ? `\n偏差分析：强度预测 ${result.deviationAnalysis.strengthPredicted} MPa，偏差 ${result.deviationAnalysis.strengthDeviationPct}%；坍落度偏差 ${result.deviationAnalysis.slumpDeviation} mm`
          : ''
        logger.info(`[record_trial_test] 保存成功: id=${result.id}`)
        return {
          success: true,
          id: result.id,
          message: `试配记录 #${result.id} 已保存${deviationInfo}`,
          deviationAnalysis: result.deviationAnalysis
        }
      }

      return { success: false, error: '保存失败：服务返回异常' }
    } catch (error) {
      logger.error('[record_trial_test] 保存失败:', error)
      return {
        success: false,
        error: this.errors.CREATE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['trialTestService', 'mixDesignService']
}

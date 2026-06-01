/**
 * 成本优化 Skill
 * 对给定材料和约束条件执行网格搜索，找出成本最低的配合比方案
 */

module.exports = {
  name: 'optimize_mix_cost',
  description: '对给定材料和约束条件执行网格搜索，找出成本最低的混凝土配合比方案。当用户要寻找最低成本方案时调用此工具。',
  version: '1.0.0',
  category: 'core',

  parameters: {
    strength: {
      type: 'string',
      description: '强度等级，如 C30',
      required: true
    },
    slump: {
      type: 'number',
      description: '坍落度(mm)',
      required: true,
      min: 10,
      max: 300
    },
    cementId: {
      type: 'integer',
      description: '水泥材料ID',
      required: true
    },
    sandIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '细骨料候选ID列表',
      required: true,
      minItems: 1
    },
    stoneIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '粗骨料候选ID列表',
      required: true,
      minItems: 1
    },
    flyAshIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '粉煤灰候选ID列表（可选）',
      required: false
    },
    slagIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '矿渣粉候选ID列表（可选）',
      required: false
    },
    lithiumSlagIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '锂渣候选ID列表（可选）',
      required: false
    },
    compositePowderIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '复合粉候选ID列表（可选）',
      required: false
    },
    superplasticizerIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '减水剂候选ID列表（可选）',
      required: false
    },
    flyAshRange: {
      type: 'array',
      items: { type: 'number' },
      description: '粉煤灰掺量范围 [min, max]，默认 [0, 30]',
      required: false
    },
    slagRange: {
      type: 'array',
      items: { type: 'number' },
      description: '矿渣粉掺量范围，默认 [0, 20]',
      required: false
    },
    lithiumSlagRange: {
      type: 'array',
      items: { type: 'number' },
      description: '锂渣掺量范围，默认 [0, 20]',
      required: false
    },
    compositePowderRange: {
      type: 'array',
      items: { type: 'number' },
      description: '复合粉掺量范围，默认 [0, 20]',
      required: false
    },
    gridStep: {
      type: 'number',
      description: '网格搜索步长，默认 5',
      required: false,
      min: 1,
      max: 20
    }
  },

  errors: {
    OPTIMIZATION_FAILED: {
      code: 'OPTIMIZATION_FAILED',
      message: '成本优化计算失败',
      hint: '请检查材料ID是否正确，或调整约束条件',
      recovery: 'adjust_params'
    }
  },

  async execute(args, context) {
    const { mixDesignOptimizer, mixDesignService, logger } = context

    logger.info(`开始成本优化: ${args.strength}`)

    try {
      const result = await mixDesignOptimizer.optimize(args)
      logger.info(`成本优化完成: 最低成本=${result.bestCost}`)

      // 自动保存草稿
      let draftId = null
      try {
        const best = result.bestSolution || result
        const now = new Date()
        const timestamp = now.toLocaleString('zh-CN', { hour12: false })
        const draft = await mixDesignService.createMixDesign({
          name: `${args.strength}成本优化方案 - ${timestamp}`,
          projectName: 'AI智能设计',
          strength: args.strength,
          slump: args.slump,
          waterRatio: best.waterRatio,
          sandRatio: best.sandRatio,
          density: best.density,
          materials: best.materials,
          materialCosts: best.materialCosts,
          totalCost: best.totalCost,
          materialDetails: best.selectedMaterials,
          fineAggregateBreakdown: best.fineAggregateBreakdown,
          coarseAggregateBreakdown: best.coarseAggregateBreakdown,
          status: '草稿'
        })
        draftId = draft.id
        logger.info(`草稿已保存, ID=${draftId}`)
      } catch (saveErr) {
        logger.warn('自动保存草稿失败（不影响优化结果）:', saveErr.message)
      }

      return { success: true, type: 'optimization', data: result, draftId }
    } catch (error) {
      logger.error('成本优化失败:', error)
      return {
        success: false,
        error: `成本优化计算失败: ${error.message}`
      }
    }
  }
}

/**
 * 成本优化 Skill（5 阶段重构）
 * 对给定材料和约束条件执行 5 阶段分层搜索，找出成本最低的配合比方案
 */

module.exports = {
  name: 'optimize_mix_cost',
  description: '对给定材料和掺量范围做 5 阶段分层搜索，**找出成本最低的方案**并自动保存为草稿（返回 draftId）。必传 strength/slump + 各种材料候选 ID 列表。支持 maxAdmixtureRatio（总掺量上限，默认 50）、calculationMethod（默认 mass）、concurrency（阶段 2 并行度，默认 100）、autoSaveDraft（默认 true）、projectName（草稿项目名）。**与 calculate_mix_design 的区别**：mix_design 算 1 个方案；cost_optimization 5 阶段搜索找最低成本。',
  version: '2.0.0',
  category: 'core',

  parameters: {
    strength: {
      type: 'string', description: '强度等级，如 C30', required: true
    },
    slump: {
      type: 'number', description: '坍落度(mm)', required: true, min: 10, max: 300
    },
    cementIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '水泥候选ID列表（支持多种水泥，阶段 2 全部遍历 — 老板决策：所有掺合料+水泥都进入网格）',
      required: true,
      minItems: 1
    },
    cementId: {
      type: 'integer', description: '水泥材料ID（单数兼容，已废弃，请用 cementIds）', required: false
    },
    sandIds: {
      type: 'array', items: { type: 'integer' }, description: '细骨料候选ID列表', required: true, minItems: 1
    },
    stoneIds: {
      type: 'array', items: { type: 'integer' }, description: '粗骨料候选ID列表', required: true, minItems: 1
    },
    flyAshIds: {
      type: 'array', items: { type: 'integer' }, description: '粉煤灰候选ID列表（可选）', required: false
    },
    slagIds: {
      type: 'array', items: { type: 'integer' }, description: '矿渣粉候选ID列表（可选）', required: false
    },
    lithiumSlagIds: {
      type: 'array', items: { type: 'integer' }, description: '锂渣候选ID列表（可选）', required: false
    },
    compositePowderIds: {
      type: 'array', items: { type: 'integer' }, description: '复合粉候选ID列表（可选）', required: false
    },
    superplasticizerIds: {
      type: 'array', items: { type: 'integer' }, description: '减水剂候选ID列表（可选）', required: false
    },
    flyAshRange: {
      type: 'array', items: { type: 'number' }, description: '粉煤灰掺量范围 [min, max]，默认 [0, 30]', required: false
    },
    slagRange: {
      type: 'array', items: { type: 'number' }, description: '矿渣粉掺量范围，默认 [0, 20]', required: false
    },
    lithiumSlagRange: {
      type: 'array', items: { type: 'number' }, description: '锂渣掺量范围，默认 [0, 20]', required: false
    },
    compositePowderRange: {
      type: 'array', items: { type: 'number' }, description: '复合粉掺量范围，默认 [0, 20]', required: false
    },
    gridStep: {
      type: 'number', description: '网格搜索步长，默认 5', required: false, min: 1, max: 20
    },
    maxAdmixtureRatio: {
      type: 'number', description: '所有掺合料总量上限（%），默认 50', required: false, min: 0, max: 80
    },
    calculationMethod: {
      type: 'string', description: '计算方法：mass（质量法，默认）或 absolute（绝对体积法）', required: false
    },
    concurrency: {
      type: 'number', description: '阶段 2 并行度（BATCH_SIZE），默认 100', required: false, min: 10, max: 500
    },
    autoSaveDraft: {
      type: 'boolean', description: '是否自动保存草稿，默认 true', required: false
    },
    projectName: {
      type: 'string', description: '草稿项目名（autoSaveDraft=true 时使用），默认 "成本优化"', required: false
    }
  },

  errors: {
    OPTIMIZATION_FAILED: {
      code: 'OPTIMIZATION_FAILED',
      message: '成本优化计算失败',
      hint: '请检查材料ID是否正确，或调整约束条件',
      recovery: 'adjust_params'
    },
    MISSING_STRENGTH: {
      code: 'MISSING_STRENGTH',
      message: '强度等级必传',
      hint: '请传入 strength 参数，例如 "C30"',
      recovery: 'add_param'
    },
    INVALID_SLUMP: {
      code: 'INVALID_SLUMP',
      message: '坍落度必须是数字',
      hint: '请传入 slump 参数，例如 120',
      recovery: 'add_param'
    },
    MISSING_CEMENT_IDS: {
      code: 'MISSING_CEMENT_IDS',
      message: '必须传入水泥 ID',
      hint: '请传入 cementIds 数组（多种水泥）或 cementId 单数（兼容旧版）',
      recovery: 'add_param'
    },
    MATERIAL_NOT_FOUND: {
      code: 'MATERIAL_NOT_FOUND',
      message: '材料 ID 查不到对应材料',
      hint: '请检查材料 ID 是否正确（可能已删除）',
      recovery: 'check_param'
    },
    CANCELLED: {
      code: 'CANCELLED',
      message: '优化已取消',
      hint: '用户主动取消了优化任务',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { mixDesignOptimizer, mixDesignService, materialService, logger } = context

    // 1. 入参校验
    if (!args.strength) {
      return { success: false, error: this.errors.MISSING_STRENGTH }
    }
    if (typeof args.slump !== 'number') {
      return { success: false, error: this.errors.INVALID_SLUMP }
    }

    logger.info(`开始成本优化: ${args.strength}`)

    // 2. 校验 + 解析水泥 ID
    const cementIds = args.cementIds || (args.cementId ? [args.cementId] : null)
    if (!cementIds || cementIds.length === 0) {
      return { success: false, error: { code: 'MISSING_CEMENT_IDS', message: '必须传入 cementIds 数组（或 cementId 单数）' } }
    }

    // 3. ID → 材料对象（修复：用户传 ID，optimizer 需要材料对象）
    // ponytail: ID lookup 失败抛错（不静默跳过，避免后续"空候选"错误）
    const resolveIds = async (ids, fieldName) => {
      if (!Array.isArray(ids) || ids.length === 0) return []
      const results = []
      for (const id of ids) {
        const mat = await materialService.getMaterialById(id)
        if (!mat) throw new Error(`${fieldName} ID=${id} 查不到材料`)
        results.push(mat)
      }
      return results
    }

    let materials
    try {
      materials = {
        ...(args.materials || {}),
        cement: await resolveIds(cementIds, '水泥'),
        flyAsh: await resolveIds(args.flyAshIds, '粉煤灰'),
        slag: await resolveIds(args.slagIds, '矿渣粉'),
        lithiumSlag: await resolveIds(args.lithiumSlagIds, '锂渣'),
        compositePowder: await resolveIds(args.compositePowderIds, '复合粉'),
        sand: await resolveIds(args.sandIds, '细骨料'),
        stone: await resolveIds(args.stoneIds, '粗骨料'),
        superplasticizer: await resolveIds(args.superplasticizerIds, '减水剂')
      }
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'MATERIAL_NOT_FOUND',
          message: err.message,
          hint: '请检查材料 ID 是否正确',
          recovery: 'check_param'
        }
      }
    }

    const optimizerParams = {
      constraints: {
        strength: args.strength,
        slump: args.slump,
        materials,
        tempSettings: args.tempSettings
      },
      userLimits: {
        flyAshRange: args.flyAshRange,
        slagRange: args.slagRange,
        lithiumSlagRange: args.lithiumSlagRange,
        compositePowderRange: args.compositePowderRange,
        gridStep: args.gridStep
      },
      maxAdmixtureRatio: args.maxAdmixtureRatio || 50,
      calculationMethod: args.calculationMethod || 'mass',
      concurrency: args.concurrency || 100
    }

    // 3. 取消机制
    const cancellationToken = context.cancellationToken || { cancelled: false }

    // 4. 进度回调
    const progressCallback = context.progressCallback || null

    try {
      const result = await mixDesignOptimizer.optimizeMixDesign(
        optimizerParams,
        cancellationToken,
        progressCallback
      )

      // 5. 自动保存草稿（可关闭）
      let draftId = null
      if (args.autoSaveDraft !== false) {
        try {
          const best = result.bestSolution
          const timestamp = new Date().toLocaleString('zh-CN', { hour12: false })
          const draft = await mixDesignService.createMixDesign({
            name: `${args.strength}成本优化方案 - ${timestamp}`,
            projectName: args.projectName || '成本优化',
            strength: args.strength,
            slump: args.slump,
            waterRatio: best.waterRatio,
            sandRatio: best.sandRatio,
            density: best.density,
            materials: best.materials,
            materialCosts: best.materialCosts,
            totalCost: best.totalCost,
            materialDetails: best.selectedMaterials || best.materialSelection,
            fineAggregateBreakdown: best.fineAggregateBreakdown,
            coarseAggregateBreakdown: best.coarseAggregateBreakdown,
            calculationMethod: optimizerParams.calculationMethod,
            status: '草稿'
          })
          draftId = draft.id
          logger.info(`草稿已保存, ID=${draftId}`)
        } catch (saveErr) {
          logger.warn('自动保存草稿失败（不影响优化结果）:', saveErr.message)
        }
      }

      return {
        success: true,
        type: 'optimization',
        data: result,
        draftId,
        meta: {
          calculationMethod: optimizerParams.calculationMethod,
          maxAdmixtureRatio: optimizerParams.maxAdmixtureRatio,
          totalEvaluated: result.totalEvaluated,
          stagesCompleted: 5
        }
      }
    } catch (error) {
      if (error.message === 'cancelled') {
        logger.info('成本优化已取消')
        return { success: false, error: this.errors.CANCELLED }
      }
      logger.error('成本优化失败:', error)
      return {
        success: false,
        error: {
          code: 'OPTIMIZATION_FAILED',
          message: `成本优化计算失败: ${error.message}`,
          hint: '请检查材料ID是否正确，或调整约束条件',
          recovery: 'adjust_params'
        }
      }
    }
  },

  services: ['materialService', 'mixDesignService', 'mixDesignOptimizer']
}

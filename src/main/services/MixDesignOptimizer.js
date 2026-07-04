const MixDesignService = require('./MixDesignService/index')
const OptimizationHistory = require('../db/models/OptimizationHistory')

class MixDesignOptimizer {
  constructor(progressCallback = null) {
    // MixDesignService 已经导出为实例，直接使用
    this.mixDesignService = MixDesignService
    this.progressCallback = progressCallback
  }

  /**
   * 报告进度
   * @param {string} phase - 阶段名称
   * @param {number} current - 当前进度
   * @param {number} total - 总数
   * @param {string} message - 消息
   */
  _reportProgress(phase, current, total, message = '') {
    if (this.progressCallback) {
      this.progressCallback({ phase, current, total, message })
    }
  }

  /**
   * 处理单个任务（用于并行计算）
   * @param {Object} task - 任务参数
   * @param {Object} screeningMaterials - 筛选用材料对象
   * @param {Object} screeningSp - 筛选用减水剂
   * @param {number} waterRatio - 水胶比
   * @param {Object} constraints - 约束条件
   * @param {Object} userLimits - 用户限制
   * @returns {Object|null} 计算结果或null
   */
  async _processSingleTask(task, screeningMaterials, screeningSp, waterRatio, constraints, userLimits) {
    const { flyAshMat, slagMat, lithiumSlagMat, compositePowderMat, flyAsh, slag, lithiumSlag, compositePowder, fineAggregateRatio } = task

    try {
      // 构建混合砂材料
      const iterationMaterials = this._buildIterationMaterials(
        { ...screeningMaterials, flyAsh: flyAshMat, slag: slagMat, lithiumSlag: lithiumSlagMat, compositePowder: compositePowderMat },
        { sand: fineAggregateRatio }
      )

      // 公式计算砂率（水胶比、坍落度、砂细度模数）
      const blendedSand = iterationMaterials.sand
      const finenessModulus = blendedSand?.finenessModulus || 2.8
      const calculatedSandRatio = this.mixDesignService.calculateSandRatio(
        waterRatio,
        constraints.slump,
        finenessModulus,
        'gravel'
      )

      const calcParams = {
        strength: constraints.strength,
        slump: constraints.slump,
        waterRatio: waterRatio,
        flyAshDosage: flyAsh,
        slagDosage: slag,
        lithiumSlagDosage: lithiumSlag,
        compositePowderDosage: compositePowder,
        sandRatio: calculatedSandRatio * 100, // 转换为百分比
        materials: iterationMaterials,
        tempSettings: constraints.tempSettings
      }

      const result = await this.mixDesignService.calculateMixDesign(calcParams)
      const isValid = this._validateConstraints(result, constraints, userLimits)

      console.log('[第一层] 计算结果:', {
        flyAsh: flyAshMat?.name,
        slag: slagMat?.name,
        lithiumSlag: lithiumSlagMat?.name,
        compositePowder: compositePowderMat?.name,
        totalCost: result.totalCost,
        cementitious: (result.materials?.cement || 0) + (result.materials?.flyAsh || 0) + (result.materials?.slag || 0) + (result.materials?.lithiumSlag || 0) + (result.materials?.compositePowder || 0),
        water: result.materials?.water,
        waterRatio: result.waterRatio,
        isValid
      })

      if (isValid) {
        return {
          ...result,
          params: { flyAsh, slag, lithiumSlag, compositePowder, sandRatio: calculatedSandRatio * 100, fineAggregateRatio },
          materialSelection: {
            flyAsh: flyAshMat,
            slag: slagMat,
            lithiumSlag: lithiumSlagMat,
            compositePowder: compositePowderMat,
            superplasticizer: screeningSp
          }
        }
      }
      // 约束不通过，记录首次失败
      if (!this._firstConstraintFail) {
        this._firstConstraintFail = { targetStrength: result.targetStrength, waterRatio: result.waterRatio, totalCementitious: (result.materials?.cement||0)+(result.materials?.flyAsh||0)+(result.materials?.slag||0)+(result.materials?.lithiumSlag||0)+(result.materials?.compositePowder||0), waterAmount: result.materials?.water, strength: constraints.strength }
        console.error('[第一层粗筛] 首次约束不通过: 强度=', result.targetStrength, '水胶比=', result.waterRatio, '胶材=', (result.materials?.cement||0)+(result.materials?.flyAsh||0)+(result.materials?.slag||0), '用水量=', result.materials?.water)
      }
      return { _failReason: 'constraintFail' }
    } catch (error) {
      if (!this._firstCalcError) {
        this._firstCalcError = { message: error.message, waterRatio, task: { flyAsh, slag, lithiumSlag, compositePowder } }
        console.error('[第一层粗筛] 首次配比计算异常:', error.message, '水胶比:', waterRatio)
      }
    }
    return { _failReason: 'calcError' }
  }

  /**
   * 优化配合比设计 - 成本最优（分层过滤搜索）
   * @param {Object} params - 优化参数
   * @param {Object} params.constraints - 性能目标约束
   * @param {string} params.constraints.strength - 强度等级 (e.g., 'C30')
   * @param {number} params.constraints.slump - 坍落度 (mm)
   * @param {Object} params.constraints.materials - 候选原材料列表
   * @param {Object} params.userLimits - 用户自定义限值
   * @param {number[]} params.userLimits.flyAshRange - 粉煤灰掺量范围 [%]，如 [0, 30]
   * @param {number[]} params.userLimits.slagRange - 矿渣粉掺量范围 [%]，如 [0, 20]
   * @param {number} params.userLimits.gridStep - 网格搜索步长，默认 5
   * @param {Object} cancellationToken - 取消令牌 { cancelled: boolean }
   * @returns {Promise<Object>} 最优配合比方案
   */
  async optimizeMixDesign(params, cancellationToken = null) {
    const { constraints, userLimits = {} } = params

    // 检查是否已取消
    if (cancellationToken?.cancelled) {
      throw new Error('cancelled')
    }

    console.log('[优化器] 开始优化（分层过滤策略）...', { constraints, userLimits })

    // 1. 计算水胶比（固定值，不进入网格搜索）
    const waterRatioResult = await this._calculateWaterRatio(constraints, constraints.materials)
    console.log('[优化器] 水胶比:', waterRatioResult.waterRatio)

    // 2. 确定网格搜索范围（砂率由公式计算，不搜索）
    const flyAshRange = this._createRange(userLimits.flyAshRange || [0, 30], userLimits.gridStep || 5)
    const slagRange = this._createRange(userLimits.slagRange || [0, 20], userLimits.gridStep || 5)
    const lithiumSlagRange = this._createRange(userLimits.lithiumSlagRange || [0, 20], userLimits.gridStep || 5)
    const compositePowderRange = this._createRange(userLimits.compositePowderRange || [0, 20], userLimits.gridStep || 5)

    // 3. 预处理材料（不过滤，只是浅拷贝）
    const materials = this._prepareMaterials(constraints.materials)

    // 4. 处理细骨料组合（仅支持两种，步长5%）
    let fineAggregateRatios = [null]
    if (materials?.sand && Array.isArray(materials.sand) && materials.sand.length > 1) {
      fineAggregateRatios = this._generateFineAggregateRatios(materials.sand)
      console.log('[优化器] 细骨料比例组合数:', fineAggregateRatios.length)
    }

    // 5. 第一层粗筛
    const top5Combinations = await this._firstLayerFilter({
      materials,
      waterRatio: waterRatioResult.waterRatio,
      flyAshRange,
      slagRange,
      lithiumSlagRange,
      compositePowderRange,
      fineAggregateRatios,
      constraints,
      userLimits,
      cancellationToken
    })

    if (top5Combinations.length === 0) {
      let detail = ''
      if (this._firstCalcError) {
        detail = ` | 配比计算异常: ${this._firstCalcError.message} (水胶比=${this._firstCalcError.waterRatio})`
      } else if (this._firstConstraintFail) {
        const f = this._firstConstraintFail
        detail = ` | 示例: 配制强度=${f.targetStrength}MPa 水胶比=${f.waterRatio} 胶材=${f.totalCementitious}kg 用水=${f.waterAmount}kg`
      }
      throw new Error(`第一层筛选未找到满足约束条件的配合比方案${detail}`)
    }

    // 6. 第二层细筛
    const { bestSolution, alternatives, allResults } = await this._secondLayerRefine(
      { materials, waterRatio: waterRatioResult.waterRatio, constraints, userLimits, cancellationToken },
      top5Combinations
    )

    if (!bestSolution) {
      console.log('[优化器] 警告：未找到有效方案，使用第一层结果')
      // 第二层细筛已有回退逻辑，理论上不会走到这里
      throw new Error('未找到满足约束条件的配合比方案，请放宽约束或更换原材料')
    }

    console.log('[优化器] 优化完成，总评估组合数:', allResults.length)

    // 7. 添加胶凝材料成本
    const cementitiousCost = (bestSolution.materialCosts?.cement || 0) +
      (bestSolution.materialCosts?.flyAsh || 0) +
      (bestSolution.materialCosts?.slag || 0) +
      (bestSolution.materialCosts?.lithiumSlag || 0) +
      (bestSolution.materialCosts?.compositePowder || 0)

    const bestSolutionWithCost = {
      ...bestSolution,
      cementitiousCost
    }

    const alternativesWithCost = alternatives.map(alt => ({
      ...alt,
      cementitiousCost: (alt.materialCosts?.cement || 0) +
        (alt.materialCosts?.flyAsh || 0) +
        (alt.materialCosts?.slag || 0) +
        (alt.materialCosts?.lithiumSlag || 0) +
        (alt.materialCosts?.compositePowder || 0)
    }))

    // 8. 确保 bestSolution 包含 selectedMaterials
    bestSolutionWithCost.selectedMaterials = {
      flyAsh: bestSolution.materialSelection?.flyAsh,
      slag: bestSolution.materialSelection?.slag,
      lithiumSlag: bestSolution.materialSelection?.lithiumSlag,
      compositePowder: bestSolution.materialSelection?.compositePowder,
      superplasticizer: bestSolution.materialSelection?.superplasticizer
    }

    // 9. 保存优化历史
    const historyRecord = await this._saveOptimizationHistory(constraints, bestSolutionWithCost, alternativesWithCost)

    return {
      bestSolution: bestSolutionWithCost,
      alternatives: alternativesWithCost,
      totalEvaluated: allResults.length,
      historyId: historyRecord?.id
    }
  }

  /**
   * 构建迭代时的材料对象
   * @param {Object} baseMaterials - 基础材料对象
   * @param {Object} blendRatios - 各种材料的混合比例（仅支持细骨料混合）
   * @returns {Object} 更新后的材料对象
   */
  _buildIterationMaterials(baseMaterials, blendRatios = {}) {
    const materials = { ...baseMaterials }

    // 仅混合细骨料（粉煤灰、矿渣粉、减水剂保持原始数组，搜索时遍历选择）
    if (blendRatios.sand && baseMaterials.sand && Array.isArray(baseMaterials.sand) && baseMaterials.sand.length > 1) {
      materials.sand = this._blendFineAggregates(baseMaterials.sand, blendRatios.sand)
    }

    return materials
  }

  /**
   * 生成细骨料掺配比例组合
   * 仅考虑两种细骨料，步长5%
   * @param {Array} fineAggregates - 细骨料列表
   * @returns {Array<Array<number>>} 比例组合，如 [[0,1], [0.05,0.95], ..., [1,0]]
   */
  _generateFineAggregateRatios(fineAggregates) {
    const count = fineAggregates.length
    if (count < 2) return [null]

    // 步长5%，即 0%, 5%, 10%, ..., 95%, 100%（21种比例）
    const step = 5
    const ratios = []

    if (count === 2) {
      for (let i = 0; i <= 100; i += step) {
        ratios.push([i / 100, (100 - i) / 100])
      }
    } else {
      // 超过两种时，只取前两种进行组合（忽略第三种及以上的细骨料）
      for (let i = 0; i <= 100; i += step) {
        ratios.push([i / 100, (100 - i) / 100, 0]) // 第三种及以后占比为0
      }
    }

    return ratios
  }

  /**
   * 混合细骨料，计算综合性能
   * @param {Array} aggregates - 细骨料列表
   * @param {Array<number>} ratios - 掺配比例
   * @returns {Object} 混合后的细骨料对象
   */
  _blendFineAggregates(aggregates, ratios) {
    const totalWeight = ratios.reduce((sum, r) => sum + r, 0)
    if (Math.abs(totalWeight - 1) > 0.01) {
      // 归一化
      const sum = totalWeight
      ratios = ratios.map(r => r / sum)
    }

    let blended = {
      id: 'blended_' + aggregates.map(a => a.id).join('_'),
      name: '混合砂',
      type: '细骨料',
      price: 0,
      finenessModulus: 0,
      mudContent: 0,
      mbValue: 0,
      // 保存原始比例，用于前端展开混合砂
      originalRatios: [...ratios],
      originalAggregateIds: aggregates.map(a => a.id),
      originalAggregateNames: aggregates.map(a => a.name)
    }

    aggregates.forEach((agg, i) => {
      const ratio = ratios[i]
      blended.price += (agg.price || 0) * ratio
      blended.finenessModulus += (agg.finenessModulus || 2.7) * ratio
      blended.mudContent += (agg.mudContent || 0) * ratio
      blended.mbValue += (agg.mbValue || 0) * ratio
    })

    return blended
  }

  /**
   * 将材料对象转换为数组（如果不是数组）
   * 空数组/null/undefined → [null]（作为"无该选项"的占位，让下游 for 循环仍迭代一次）
   * @param {Object|Array} material - 材料对象或数组
   * @returns {Array} 材料数组
   */
  _getMaterialList(material) {
    if (!material || (Array.isArray(material) && material.length === 0)) return [null]
    if (Array.isArray(material)) return material
    return [material]
  }

  /**
   * 阶段 3：Top5 胶凝 + 细骨料比例 → Top5
   * @param {Object} params
   * @param {Array} params.top5Cementitious - 阶段 2 产出的 Top5 胶凝组合
   * @param {Object} params.materials - 原材料（包含 sand 数组）
   * @param {Array<Array<number>>} params.fineAggregateRatios - 21 种细骨料比例组合
   * @param {number} params.T_FM - 目标细度模数
   * @param {number} params.defaultSpDosage - 默认减水剂掺量
   * @param {Object} params.defaultSp - 默认减水剂
   * @param {Object} params.stoneInitial - 阶段 1 选出的粗骨料
   * @param {Object} params.constraints - 性能约束（strength/slump）
   * @param {Object} params.cancellationToken - 取消令牌 { cancelled: boolean }
   * @returns {Promise<Array<Object>>} Top5 胶凝+细骨料组合（按总成本升序）
   */
  async _stage3Refine({
    top5Cementitious, materials, fineAggregateRatios, T_FM,
    defaultSpDosage, defaultSp, stoneInitial,
    constraints, cancellationToken
  }) {
    const results = []
    const sandCandidates = this._getMaterialList(materials.sand).filter(s => s)

    for (const combo of top5Cementitious) {
      if (cancellationToken?.cancelled) throw new Error('cancelled')

      for (const fineRatio of fineAggregateRatios) {
        const blendedSand = this._blendFineAggregatesForCost(sandCandidates, fineRatio)

        if (!this._validateFinenessModulus(blendedSand.finenessModulus, T_FM, 0.5)) continue

        const sandRatio = this.mixDesignService.calculateSandRatio(
          combo.waterRatio, constraints.slump, blendedSand.finenessModulus, 'gravel'
        )

        // 阶段 3 不遍历减水剂品种，用参考减水剂 + 阶段 1 粗骨料
        try {
          const result = await this.mixDesignService.calculateMixDesign({
            strength: constraints.strength,
            slump: constraints.slump,
            waterRatio: combo.waterRatio,
            flyAshDosage: combo.flyAsh,
            slagDosage: combo.slag,
            lithiumSlagDosage: combo.lithiumSlag,
            compositePowderDosage: combo.compositePowder,
            sandRatio: sandRatio * 100,
            calculationMethod: 'mass',
            targetDensity: 2400,
            materials: {
              ...materials,
              cement: combo.cementMat,
              sand: blendedSand,
              stone: stoneInitial,
              flyAsh: combo.flyAshMat,
              slag: combo.slagMat,
              lithiumSlag: combo.lithiumSlagMat,
              compositePowder: combo.compositePowderMat,
              superplasticizer: defaultSp
            }
          })
          if (this._validateConstraints(result, constraints)) {
            results.push({
              ...result,
              cementitious: combo,
              blendedSand, fineRatio, sandRatio: sandRatio * 100
            })
          }
        } catch (e) {
          // 忽略计算失败
        }
      }
    }

    results.sort((a, b) => a.totalCost - b.totalCost)
    return results.slice(0, 5)
  }

  /**
   * 验证混合砂的细度模数是否在目标范围内（老板决策：±0.5 容忍度）
   * @param {number} actualFM - 混合后的细度模数
   * @param {number} targetFM - 目标细度模数
   * @param {number} tolerance - 容忍度（默认 0.5）
   * @returns {boolean}
   */
  _validateFinenessModulus(actualFM, targetFM, tolerance = 0.5) {
    return Math.abs(actualFM - targetFM) <= tolerance
  }

  /**
   * 按成本最优比例混合细骨料（用于阶段 3）
   * @param {Array} sandCandidates - 细骨料候选
   * @param {Array<number>} ratio - [r1, r2] 比例
   * @returns {Object} 混合后的细骨料
   */
  _blendFineAggregatesForCost(sandCandidates, ratio) {
    if (!Array.isArray(sandCandidates) || sandCandidates.length < 2) {
      return sandCandidates[0] || null
    }
    const [r1, r2] = ratio
    return {
      id: 'blended_' + sandCandidates.map(s => s.id).join('_'),
      name: '混合砂',
      type: '细骨料',
      price: (sandCandidates[0].price || 0) * r1 + (sandCandidates[1].price || 0) * r2,
      finenessModulus: (sandCandidates[0].finenessModulus || 2.7) * r1 + (sandCandidates[1].finenessModulus || 2.7) * r2,
      mbValue: (sandCandidates[0].mbValue || 0.5) * r1 + (sandCandidates[1].mbValue || 0.5) * r2,
      originalRatios: [r1, r2],
      originalAggregateIds: sandCandidates.map(s => s.id)
    }
  }

  /**
   * 阶段 1：预选粗骨料（委托给 MixDesignService_Aggregate.preselectCoarseAggregate）
   * @param {Array} stoneCandidates - 粗骨料候选
   * @returns {Object} 选中的粗骨料
   */
  _preselectStone(stoneCandidates) {
    return this.mixDesignService.preselectCoarseAggregate(stoneCandidates)
  }

  /**
   * 阶段 4：Top5 + 重新遍历粗骨料 → Top5
   * 在阶段 3 Top5 基础上遍历所有粗骨料品种，按总成本排序得 Top5。
   * mass 法（默认），用 _overrideBaseWaterAmount 覆盖基准用水量。
   * 不遍历减水剂（用 defaultSp，减水剂遍历留到阶段 5）。
   * @param {Object} params
   * @param {Array} params.top5WithSand - 阶段 3 产出的 Top5
   * @param {Object} params.materials - 原材料（包含 stone 数组）
   * @param {Object} params.defaultSp - 默认减水剂
   * @param {Object} params.constraints - 性能约束（strength/slump）
   * @param {Object} params.cancellationToken - 取消令牌 { cancelled: boolean }
   * @returns {Promise<Array<Object>>} Top5 组合（按总成本升序）
   */
  async _stage4ReassessCoarseAggregate({
    top5WithSand, materials, defaultSp,
    constraints, cancellationToken
  }) {
    const results = []
    const stoneList = this._getMaterialList(materials.stone).filter(s => s)

    for (const combo of top5WithSand) {
      if (cancellationToken?.cancelled) throw new Error('cancelled')

      for (const stoneMat of stoneList) {
        const aggregateType = stoneMat.name?.includes('卵石') ? '卵石' : '碎石'
        const baseWater = this.mixDesignService.getBaseWaterAmount(
          this.mixDesignService.extractMaxAggregateSize(stoneMat.specification),
          constraints.slump, aggregateType
        )

        try {
          const result = await this.mixDesignService.calculateMixDesign({
            strength: constraints.strength,
            slump: constraints.slump,
            waterRatio: combo.waterRatio,
            flyAshDosage: combo.cementitious.flyAsh,
            slagDosage: combo.cementitious.slag,
            lithiumSlagDosage: combo.cementitious.lithiumSlag,
            compositePowderDosage: combo.cementitious.compositePowder,
            sandRatio: combo.sandRatio,
            calculationMethod: 'mass',
            targetDensity: 2400,
            materials: {
              ...materials,
              sand: combo.blendedSand,
              stone: stoneMat,
              flyAsh: combo.cementitious.flyAshMat,
              slag: combo.cementitious.slagMat,
              lithiumSlag: combo.cementitious.lithiumSlagMat,
              compositePowder: combo.cementitious.compositePowderMat,
              superplasticizer: defaultSp
            },
            _overrideBaseWaterAmount: baseWater
          })
          if (this._validateConstraints(result, constraints)) {
            results.push({ ...result, stoneMat })
          }
        } catch (e) {
          // 忽略计算失败
        }
      }
    }

    results.sort((a, b) => a.totalCost - b.totalCost)
    return results.slice(0, 5)
  }

  /**
   * 阶段 2：胶凝材料快速估算 → Top5
   * BATCH_SIZE=100 并行（老板决策）
   * ⭐ 每种水泥品种内部都重算 waterRatio（保罗米公式）
   * @param {Object} params
   * @param {Object} params.materials - 候选原材料（cement/flyAsh/slag/lithiumSlag/compositePowder）
   * @param {number} params.baseWaterAmount - 单位用水量 (kg/m³)
   * @param {number} params.defaultSpDosage - 减水剂掺量 (%)
   * @param {Object} params.defaultSp - 筛选用减水剂
   * @param {Array<number>} params.flyAshRange - 粉煤灰掺量范围 (%)
   * @param {Array<number>} params.slagRange - 矿渣粉掺量范围 (%)
   * @param {Array<number>} params.lithiumSlagRange - 锂渣粉掺量范围 (%)
   * @param {Array<number>} params.compositePowderRange - 复合粉掺量范围 (%)
   * @param {number} params.maxAdmixtureRatio - 总掺合料上限 (%)
   * @param {Object} params.constraints - 性能约束 (strength/slump)
   * @param {Object} params.cancellationToken - 取消令牌 { cancelled: boolean }
   * @returns {Promise<Array<Object>>} Top5 胶凝组合（按胶凝成本升序）
   */
  async _stage2Filter({
    materials, baseWaterAmount, defaultSpDosage, defaultSp,
    flyAshRange, slagRange, lithiumSlagRange, compositePowderRange,
    maxAdmixtureRatio,
    constraints,
    cancellationToken
  }) {
    const results = []
    const tasks = []

    const cementList = this._getMaterialList(materials.cement)
    const flyAshList = this._getMaterialList(materials.flyAsh)
    const slagList = this._getMaterialList(materials.slag)
    const lithiumSlagList = this._getMaterialList(materials.lithiumSlag)
    const compositePowderList = this._getMaterialList(materials.compositePowder)

    // ⭐ 老板决策：每种水泥重算 waterRatio（保罗米公式，spec § 6 line 313-314）
    const stdDev = await this.mixDesignService.getStrengthStdDev(constraints.strength, constraints.tempSettings)
    const targetStrength = this.mixDesignService.calculateTargetStrength(constraints.strength, stdDev)
    const { alphaA, alphaB } = await this.mixDesignService.getRegressionCoefficients(constraints.tempSettings)

    // 生成所有胶凝组合任务
    for (const cementMat of cementList) {
      if (!cementMat) continue
      // ⭐ 每种水泥重算 waterRatio
      const waterRatio = this.mixDesignService.calculateWaterRatio(
        targetStrength,
        cementMat.compressiveStrength28d || 48.0,
        alphaA,
        alphaB
      )

      for (const flyAshMat of flyAshList) {
        for (const slagMat of slagList) {
          for (const lithiumSlagMat of lithiumSlagList) {
            for (const compositePowderMat of compositePowderList) {
              for (const flyAsh of flyAshRange) {
                for (const slag of slagRange) {
                  for (const lithiumSlag of lithiumSlagRange) {
                    for (const compositePowder of compositePowderRange) {
                      if (flyAsh + slag + lithiumSlag + compositePowder > maxAdmixtureRatio) continue
                      tasks.push({
                        cementMat, waterRatio,
                        flyAshMat: flyAshMat, slagMat, lithiumSlagMat, compositePowderMat,
                        flyAsh, slag, lithiumSlag, compositePowder
                      })
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // BATCH_SIZE=100 并行处理
    const BATCH_SIZE = 100
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      if (cancellationToken?.cancelled) throw new Error('cancelled')

      const batch = tasks.slice(i, i + BATCH_SIZE)
      const batchResults = batch.map(task => {
        try {
          const cost = this.mixDesignService.computeCementitiousCost({
            baseWaterAmount, waterRatio: task.waterRatio,
            flyAsh: task.flyAsh, slag: task.slag,
            lithiumSlag: task.lithiumSlag, compositePowder: task.compositePowder,
            cementMat: task.cementMat,
            flyAshMat: task.flyAshMat, slagMat: task.slagMat,
            lithiumSlagMat: task.lithiumSlagMat, compositePowderMat: task.compositePowderMat,
            spDosage: defaultSpDosage,
            spMat: defaultSp
          })
          return { ...task, cementitiousCost: cost }
        } catch (e) {
          return null
        }
      })
      // batchResults 是同步计算（无 await），但保留 Promise.all 形式以便将来扩展
      for (const r of batchResults) {
        if (r) results.push(r)
      }
      this._reportProgress('阶段 2 胶凝估算', Math.min(i + BATCH_SIZE, tasks.length), tasks.length)
    }

    // Top5
    results.sort((a, b) => a.cementitiousCost - b.cementitiousCost)
    return results.slice(0, 5)
  }

  /**
   * 第一层粗筛
   * 使用筛选减水剂（最便宜的一种）遍历所有粉煤灰/矿渣粉/掺量组合
   * @param {Object} params - 搜索参数
   * @param {Object} params.materials - 原材料
   * @param {number} params.waterRatio - 水胶比
   * @param {Array} params.flyAshRange - 粉煤灰掺量范围
   * @param {Array} params.slagRange - 矿渣粉掺量范围
   * @param {Array} params.fineAggregateRatios - 细骨料比例组合
   * @param {Object} params.constraints - 性能约束
   * @param {Object} params.userLimits - 用户限制
   * @returns {Array} Top5 组合（按总成本排序）
   */
  async _firstLayerFilter(params) {
    const { materials, waterRatio, flyAshRange, slagRange, lithiumSlagRange, compositePowderRange, fineAggregateRatios, constraints, userLimits } = params

    // 1. 选择筛选用减水剂（最便宜的一种，如果没有则使用默认）
    let screeningSp = null
    if (materials.superplasticizer && Array.isArray(materials.superplasticizer) && materials.superplasticizer.length > 0) {
      screeningSp = materials.superplasticizer.reduce((min, sp) =>
        (sp.price || 0) < (min.price || 0) ? sp : min
      )
    } else if (materials.superplasticizer && typeof materials.superplasticizer === 'object') {
      screeningSp = materials.superplasticizer
    } else {
      // 如果没有减水剂数据，创建一个默认的
      console.log('[第一层粗筛] 警告：没有减水剂数据，使用默认减水剂')
      screeningSp = {
        name: '默认减水剂',
        price: 5000,
        waterReducingRate: 25,
        recommendedDosage: 1.5,
        waterReducingRatePer01Dosage: 2.0
      }
    }

    console.log('[第一层粗筛] 筛选减水剂:', screeningSp?.name, '价格:', screeningSp?.price)

    // 2. 准备筛选用的材料对象（减水剂固定为筛选减水剂）
    const screeningMaterials = {
      ...materials,
      superplasticizer: screeningSp
    }

    // 3. 遍历所有组合（并行批次处理）
    const results = []
    const flyAshList = this._getMaterialList(materials.flyAsh)
    const slagList = this._getMaterialList(materials.slag)
    const lithiumSlagList = this._getMaterialList(materials.lithiumSlag)
    const compositePowderList = this._getMaterialList(materials.compositePowder)

    console.log('[第一层粗筛] flyAshList数量:', flyAshList.length, ', slagList数量:', slagList.length, ', lithiumSlagList数量:', lithiumSlagList.length, ', compositePowderList数量:', compositePowderList.length)
    console.log('[第一层粗筛] flyAshRange:', flyAshRange, ', slagRange:', slagRange, ', lithiumSlagRange:', lithiumSlagRange, ', compositePowderRange:', compositePowderRange)
    console.log('[第一层粗筛] fineAggregateRatios数量:', fineAggregateRatios.length)

    // 如果所有掺合料列表都只有 null（未选材料），补一个"零掺量"任务保证至少能跑
    const allEmpty = flyAshList.every(m => !m) && slagList.every(m => !m) && lithiumSlagList.every(m => !m) && compositePowderList.every(m => !m)
    if (allEmpty) {
      console.log('[第一层粗筛] 未选择掺合料，使用零掺量组合（纯水泥方案）')
    }

    // 构建所有任务（砂率由公式计算，不搜索）
    // 总掺量上限50%，超过则跳过
    const tasks = []
    const _fr = allEmpty ? [0] : flyAshRange
    const _sr = allEmpty ? [0] : slagRange
    const _lr = allEmpty ? [0] : lithiumSlagRange
    const _cr = allEmpty ? [0] : compositePowderRange
    for (const flyAshMat of (allEmpty ? [null] : flyAshList)) {
      for (const slagMat of (allEmpty ? [null] : slagList)) {
        for (const lithiumSlagMat of (allEmpty ? [null] : lithiumSlagList)) {
          for (const compositePowderMat of (allEmpty ? [null] : compositePowderList)) {
            for (const flyAsh of _fr) {
              for (const slag of _sr) {
                for (const lithiumSlag of _lr) {
                  for (const compositePowder of _cr) {
                    if (flyAsh + slag + lithiumSlag + compositePowder > 50) continue
                    for (const fineAggregateRatio of fineAggregateRatios) {
                      tasks.push({ flyAshMat, slagMat, lithiumSlagMat, compositePowderMat, flyAsh, slag, lithiumSlag, compositePowder, fineAggregateRatio })
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    console.log('[第一层粗筛] 生成任务数:', tasks.length)

    console.log('[第一层粗筛] 总任务数:', tasks.length)

    // 并行批次处理
    const BATCH_SIZE = 50
    let completed = 0
    let validCount = 0
    const failReasons = { calcError: 0, constraintFail: 0 }

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      if (params.cancellationToken?.cancelled) {
        throw new Error('cancelled')
      }

      const batch = tasks.slice(i, i + BATCH_SIZE)
      const batchPromises = batch.map(task => this._processSingleTask(task, screeningMaterials, screeningSp, waterRatio, constraints, userLimits))
      const batchResults = await Promise.all(batchPromises)

      for (const result of batchResults) {
        if (result) {
          if (result._failReason === 'calcError') failReasons.calcError++
          else if (result._failReason === 'constraintFail') failReasons.constraintFail++
          else { results.push(result); validCount++ }
        }
      }

      completed += batch.length
      this._reportProgress('第一层粗筛', completed, tasks.length, `已处理 ${completed}/${tasks.length}`)
    }

    console.log('[第一层粗筛] 完成，总迭代:', tasks.length, ', 有效:', validCount, ', 计算异常:', failReasons.calcError, ', 约束不通过:', failReasons.constraintFail)
    if (validCount === 0 && tasks.length > 0) {
      console.error('[第一层粗筛] 全部被拒！计算异常=', failReasons.calcError, ' 约束不通过=', failReasons.constraintFail)
      if (failReasons.calcError > 0) console.error('[第一层粗筛] 配比计算异常——请检查水泥28d强度、砂细度模数、石粒径等材料参数是否完整')
      if (failReasons.constraintFail > 0) console.error('[第一层粗筛] 约束不通过——水胶比/胶凝材料/用水量超出范围，请放宽掺量范围或更换材料')
    }

    // 4. 按总成本排序，保留Top5
    results.sort((a, b) => a.totalCost - b.totalCost)
    const top5 = results.slice(0, 5)

    console.log('[第一层粗筛] 完成，有效组合:', results.length, '，保留Top5')
    return top5
  }

  /**
   * 第二层细筛
   * 对Top5组合用全量减水剂品种重新计算
   * @param {Object} params - 搜索参数
   * @param {Array} top5Combinations - 第一层筛选出的Top5组合
   * @param {Object} params.materials - 原材料
   * @param {number} params.waterRatio - 水胶比
   * @param {Object} params.constraints - 性能约束
   * @param {Object} params.userLimits - 用户限制
   * @returns {Object} 最优方案
   */
  async _secondLayerRefine(params, top5Combinations) {
    const { materials, waterRatio, constraints, userLimits } = params

    const spList = this._getMaterialList(materials.superplasticizer)
    let bestSolution = null
    let bestCost = Infinity
    const allResults = []

    console.log('[第二层细筛] 开始，候选减水剂数量:', spList.length, ', Top5组合数:', top5Combinations.length)

    for (const combo of top5Combinations) {
      // 检查是否已取消
      if (params.cancellationToken?.cancelled) {
        throw new Error('cancelled')
      }

      const { params: comboParams, materialSelection } = combo
      const { flyAsh, slag, lithiumSlag, compositePowder, sandRatio, fineAggregateRatio } = comboParams

      // 尝试每种减水剂
      for (const spMat of spList) {
        if (!spMat) {
          console.log('[第二层细筛] 跳过无效减水剂')
          continue
        }

        try {
          // 构建当前迭代的材料对象
          const iterationMaterials = this._buildIterationMaterials(
            { ...materials, flyAsh: materialSelection.flyAsh, slag: materialSelection.slag, lithiumSlag: materialSelection.lithiumSlag, compositePowder: materialSelection.compositePowder, superplasticizer: spMat },
            { sand: fineAggregateRatio }
          )

          const calcParams = {
            strength: constraints.strength,
            slump: constraints.slump,
            waterRatio: waterRatio,
            flyAshDosage: flyAsh,
            slagDosage: slag,
            lithiumSlagDosage: lithiumSlag,
            compositePowderDosage: compositePowder,
            sandRatio: sandRatio,
            materials: iterationMaterials,
            tempSettings: constraints.tempSettings
          }

          const result = await this.mixDesignService.calculateMixDesign(calcParams)
          const isValid = this._validateConstraints(result, constraints, userLimits)

          console.log('[第二层细筛] 计算结果:', {
            flyAsh: materialSelection.flyAsh?.name,
            slag: materialSelection.slag?.name,
            lithiumSlag: materialSelection.lithiumSlag?.name,
            compositePowder: materialSelection.compositePowder?.name,
            sp: spMat?.name,
            totalCost: result.totalCost,
            cementitious: (result.materials?.cement || 0) + (result.materials?.flyAsh || 0) + (result.materials?.slag || 0) + (result.materials?.lithiumSlag || 0) + (result.materials?.compositePowder || 0),
            water: result.materials?.water,
            waterRatio: result.waterRatio,
            isValid
          })

          if (isValid) {
            allResults.push({
              ...result,
              params: comboParams,
              materialSelection: {
                flyAsh: materialSelection.flyAsh,
                slag: materialSelection.slag,
                lithiumSlag: materialSelection.lithiumSlag,
                compositePowder: materialSelection.compositePowder,
                superplasticizer: spMat
              }
            })

            if (result.totalCost < bestCost) {
              bestCost = result.totalCost
              bestSolution = allResults[allResults.length - 1]
              console.log('[第二层细筛] 更新最佳方案:', { cost: result.totalCost, flyAsh: materialSelection.flyAsh?.name, slag: materialSelection.slag?.name, lithiumSlag: materialSelection.lithiumSlag?.name, compositePowder: materialSelection.compositePowder?.name, sp: spMat?.name })
            }
          } else {
            console.log('[第二层细筛] 组合验证失败:', {
              flyAsh: materialSelection.flyAsh?.name,
              slag: materialSelection.slag?.name,
              lithiumSlag: materialSelection.lithiumSlag?.name,
              compositePowder: materialSelection.compositePowder?.name,
              sp: spMat?.name,
              totalCementitious: (result.materials?.cement || 0) + (result.materials?.flyAsh || 0) + (result.materials?.slag || 0) + (result.materials?.lithiumSlag || 0) + (result.materials?.compositePowder || 0),
              waterAmount: result.materials?.water
            })
          }
        } catch (error) {
          console.log('[第二层细筛] 计算异常:', error.message)
          // 忽略计算失败的组合
        }
      }
    }

    console.log('[第二层细筛] 完成，allResults:', allResults.length, ', bestSolution:', bestSolution ? '有值' : 'null')

    // 如果第二层没有找到有效方案，回退到第一层的Top5（使用筛选减水剂）
    if (allResults.length === 0 && top5Combinations.length > 0) {
      console.log('[第二层细筛] 未找到有效方案，回退到第一层结果')

      // 使用第一层的Top1作为最佳方案
      const fallback = top5Combinations[0]
      allResults.push(fallback)
      bestSolution = fallback

      // 对其他Top4方案使用第一层的减水剂重新计算
      for (let i = 1; i < Math.min(top5Combinations.length, 5); i++) {
        const combo = top5Combinations[i]
        allResults.push(combo)
      }
    }

    // 按总成本排序，返回Top5备选方案
    allResults.sort((a, b) => a.totalCost - b.totalCost)

    return {
      bestSolution,
      alternatives: allResults.slice(0, 5).filter(r => r !== bestSolution),
      allResults
    }
  }

  /**
   * 计算水胶比
   * @param {Object} constraints - 约束条件
   * @param {Object} materials - 材料列表
   * @returns {Object} { waterRatio, cementStrength }
   */
  async _calculateWaterRatio(constraints, materials) {
    const stdDev = await this.mixDesignService.getStrengthStdDev(constraints.strength, constraints.tempSettings)
    const targetStrength = this.mixDesignService.calculateTargetStrength(constraints.strength, stdDev)

    // 获取回归系数
    const { alphaA, alphaB } = await this.mixDesignService.getRegressionCoefficients(constraints.tempSettings)

    // 获取水泥强度
    const cementStrength = (materials?.cement?.compressiveStrength28d || 48.0)

    // 计算水胶比
    const waterRatio = this.mixDesignService.calculateWaterRatio(targetStrength, cementStrength, alphaA, alphaB)

    return {
      waterRatio,
      targetStrength,
      stdDev,
      cementStrength
    }
  }

  /**
 * 保留原始材料对象，不过滤
 * 粉煤灰、矿渣粉、减水剂的选择将在网格搜索循环内进行
 * @param {Object} materials - 原材料对象
 * @returns {Object} 原始材料对象
 */
_prepareMaterials(materials) {
  return { ...materials }
}

  /**
   * 创建等差数列
   * @param {Array} range - [min, max]
   * @param {number} step - 步长
   * @returns {Array<number>}
   */
  _createRange(range, step) {
    const [min, max] = range
    const result = []
    for (let i = min; i <= max; i += step) {
      result.push(i)
    }
    if (result[result.length - 1] !== max) {
      result.push(max)
    }
    return result
  }

  /**
   * 验证约束条件
   * @param {Object} result - 配合比计算结果
   * @param {Object} constraints - 性能目标约束
   * @param {Object} userLimits - 用户自定义限值（可选，默认 {}）
   * @returns {boolean}
   */
  _validateConstraints(result, constraints, userLimits = {}) {
    const strengthNum = parseInt(String(constraints.strength).replace('C', ''))
    if (result.targetStrength && result.targetStrength < strengthNum) return false
    // 用户自定义水胶比限值（如指定）
    if (userLimits.waterRatioRange) {
      const [minWbr, maxWbr] = userLimits.waterRatioRange
      if (result.waterRatio < minWbr || result.waterRatio > maxWbr) return false
    }
    const totalCementitious = (result.materials?.cement || 0) + (result.materials?.flyAsh || 0)
      + (result.materials?.slag || 0) + (result.materials?.lithiumSlag || 0)
      + (result.materials?.compositePowder || 0)
    if (totalCementitious <= 0 || totalCementitious < 200 || totalCementitious > 600) return false
    const waterAmount = result.materials?.water
    if (!waterAmount || waterAmount <= 0 || waterAmount > 250) return false
    return true
  }

  /**
   * 保存优化历史
   * @param {Object} constraints - 约束条件
   * @param {Object} bestSolution - 最优方案
   * @param {Array} alternatives - 备选方案
   * @returns {Promise<Object>}
   */
  async _saveOptimizationHistory(constraints, bestSolution, alternatives) {
    try {
      const record = await OptimizationHistory.create({
        projectName: constraints.projectName || '未命名项目',
        constraints: {
          strength: constraints.strength,
          slump: constraints.slump,
          materials: constraints.materials,
          userLimits: constraints.userLimits
        },
        bestSolution: {
          totalCost: bestSolution.totalCost,
          cementitiousCost: bestSolution.cementitiousCost,
          waterRatio: bestSolution.waterRatio,
          sandRatio: bestSolution.sandRatio,
          materials: bestSolution.materials,
          materialCosts: bestSolution.materialCosts,
          density: bestSolution.density,
          selectedMaterials: bestSolution.selectedMaterials
        },
        alternatives: alternatives.map(alt => ({
          totalCost: alt.totalCost,
          cementitiousCost: alt.cementitiousCost,
          waterRatio: alt.waterRatio,
          sandRatio: alt.sandRatio,
          params: alt.params
        }))
      })
      return record
    } catch (error) {
      console.error('[优化器] 保存历史记录失败:', error)
      return null
    }
  }
}

module.exports = MixDesignOptimizer

const MixDesignService = require('./MixDesignService')
const OptimizationHistory = require('../db/models/OptimizationHistory')

class MixDesignOptimizer {
  constructor() {
    // MixDesignService 已经导出为实例，直接使用
    this.mixDesignService = MixDesignService
  }

  /**
   * 优化配合比设计 - 成本最优
   * @param {Object} params - 优化参数
   * @param {Object} params.constraints - 一类约束：性能目标
   * @param {string} params.constraints.strength - 强度等级 (e.g., 'C30')
   * @param {number} params.constraints.slump - 坍落度 (mm)
   * @param {string} params.constraints.environment - 环境类别
   * @param {Object} params.constraints.materials - 候选原材料列表
   * @param {Object} params.userLimits - 二类约束：用户自定义限值
   * @param {number[]} params.userLimits.flyAshRange - 粉煤灰掺量范围 [%]，如 [0, 30]
   * @param {number[]} params.userLimits.slagRange - 矿渣粉掺量范围 [%]，如 [0, 20]
   * @param {number[]} params.userLimits.sandRatioRange - 砂率范围 [%]，如 [35, 42]
   * @param {number} params.userLimits.gridStep - 网格搜索步长，默认 5
   * @returns {Promise<Object>} 最优配合比方案
   */
  async optimizeMixDesign(params) {
    const { constraints, userLimits = {} } = params

    console.log('[优化器] 开始优化...', { constraints, userLimits })

    // 1. 计算水胶比（固定值，不进入网格搜索）
    const waterRatioResult = await this._calculateWaterRatio(constraints, constraints.materials)
    console.log('[优化器] 计算水胶比:', waterRatioResult)

    // 2. 确定网格搜索范围
    const flyAshRange = this._createRange(userLimits.flyAshRange || [0, 30], userLimits.gridStep || 5)
    const slagRange = this._createRange(userLimits.slagRange || [0, 20], userLimits.gridStep || 5)
    const sandRatioRange = this._createRange(userLimits.sandRatioRange || [35, 42], 1) // 砂率步长 1%

    console.log('[优化器] 搜索范围:', {
      waterRatio: waterRatioResult.waterRatio,
      flyAshRange,
      slagRange,
      sandRatioRange
    })

    // 3. 预处理材料：保留原始材料对象，不过滤
    const materials = this._prepareMaterials(constraints.materials)

    // 4. 处理细骨料优化（独立于主循环）
    let fineAggregateRatios = [null] // 默认不优化
    if (materials?.sand && Array.isArray(materials.sand) && materials.sand.length > 1) {
      console.log('[优化器] 检测到多种细骨料，开始成本优化...')
      fineAggregateRatios = this._generateFineAggregateRatios(materials.sand)
      console.log('[优化器] 细骨料比例组合数:', fineAggregateRatios.length)
    }

    // 5. 网格搜索（仅细骨料比例需要循环优化）
    const results = []
    let bestCost = Infinity
    let bestSolution = null

    const totalIterations = flyAshRange.length * slagRange.length * sandRatioRange.length * fineAggregateRatios.length
    let currentIteration = 0

    for (const flyAsh of flyAshRange) {
      for (const slag of slagRange) {
        // 检查掺合料总掺量是否合理（不超过 50%）
        if (flyAsh + slag > 50) continue

        for (const sandRatio of sandRatioRange) {
          for (const fineAggregateRatio of fineAggregateRatios) {
            currentIteration++

            try {
              // 构建当前迭代的材料对象
              const iterationMaterials = this._buildIterationMaterials(
                materials,
                { sand: fineAggregateRatio }
              )

              const calcParams = {
                strength: constraints.strength,
                slump: constraints.slump,
                environment: constraints.environment,
                waterRatio: waterRatioResult.waterRatio,
                flyAshDosage: flyAsh,
                slagDosage: slag,
                sandRatio: sandRatio,
                materials: iterationMaterials,
                tempSettings: constraints.tempSettings
              }

              const result = await this.mixDesignService.calculateMixDesign(calcParams)

              // 验证约束
              const isValid = this._validateConstraints(result, constraints, userLimits)

              if (isValid) {
                const resultWithParams = {
                  ...result,
                  params: {
                    flyAsh,
                    slag,
                    sandRatio,
                    fineAggregateRatio
                  }
                }
                results.push(resultWithParams)

                if (result.totalCost < bestCost) {
                  bestCost = result.totalCost
                  bestSolution = {
                    ...resultWithParams,
                    // 包含最终选择的粉煤灰和矿渣粉材料信息（名称、单价等）
                    selectedMaterials: {
                      flyAsh: materials.flyAsh,
                      slag: materials.slag
                    }
                  }
                }
              }
            } catch (error) {
              console.warn(`[优化器] 迭代 ${currentIteration}/${totalIterations} 失败:`, error.message)
            }
          }
        }
      }
    }

    console.log(`[优化器] 优化完成，共评估 ${results.length} 个有效方案`)

    if (!bestSolution) {
      throw new Error('未找到满足约束条件的配合比方案，请放宽约束或更换原材料')
    }

    // 5. 保存优化历史
    const historyRecord = await this._saveOptimizationHistory(constraints, bestSolution, results.slice(0, 5))

    return {
      bestSolution,
      alternatives: results.slice(0, 5).filter(r => r !== bestSolution),
      totalEvaluated: results.length,
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
   * @param {Object} userLimits - 用户自定义限值
   * @returns {boolean}
   */
  _validateConstraints(result, constraints, userLimits) {
    // 检查配制强度是否满足（配置强度 = 强度等级 + 1.645σ，应该大于强度等级）
    const strengthNum = parseInt(constraints.strength.replace('C', ''))
    if (result.targetStrength && result.targetStrength < strengthNum) {
      console.log('[验证] 强度不满足:', result.targetStrength, '<', strengthNum)
      return false
    }

    // 检查水胶比是否在用户限制范围内（如果指定）
    if (userLimits.waterRatioRange) {
      const [minWbr, maxWbr] = userLimits.waterRatioRange
      if (result.waterRatio < minWbr || result.waterRatio > maxWbr) {
        console.log('[验证] 水胶比超出范围:', result.waterRatio)
        return false
      }
    }

    // 检查胶凝材料用量是否合理（放宽限制）
    const totalCementitious = (result.materials?.cement || 0) + (result.materials?.flyAsh || 0) + (result.materials?.slag || 0)
    if (totalCementitious <= 0) {
      console.log('[验证] 胶凝材料用量为 0 或无效:', totalCementitious)
      return false
    }
    if (totalCementitious < 200 || totalCementitious > 600) {
      console.log('[验证] 胶凝材料用量不合理:', totalCementitious)
      return false
    }

    // 检查用水量是否合理
    const waterAmount = result.materials?.water
    if (!waterAmount || waterAmount <= 0 || waterAmount > 250) {
      console.log('[验证] 用水量不合理:', waterAmount)
      return false
    }

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
          environment: constraints.environment,
          materials: constraints.materials,
          userLimits: constraints.userLimits
        },
        bestSolution: {
          totalCost: bestSolution.totalCost,
          waterRatio: bestSolution.waterRatio,
          sandRatio: bestSolution.sandRatio,
          materials: bestSolution.materials,
          materialCosts: bestSolution.materialCosts,
          density: bestSolution.density
        },
        alternatives: alternatives.map(alt => ({
          totalCost: alt.totalCost,
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

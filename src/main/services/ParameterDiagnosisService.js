/**
 * 参数诊断服务
 * 智能解析的第一步：上传数据后自动反算材料参数，对比新旧参数差异
 *
 * 诊断策略：
 * - 同材料组合仅 1 组 → 单组偏差溯源
 * - 同材料组合 ≥ 2 组 → 多组联立反算（坐标下降法 + 线性最小二乘）
 */

class ParameterDiagnosisService {
  /**
   * 执行参数诊断
   * @param {Array} mixDesigns - 配合比数据列表，每条需含 testResults 和 materialMapping
   * @returns {Object} 诊断结果（符合设计文档 5.2 输出 JSON 结构）
   */
  async diagnose(mixDesigns) {
    if (!mixDesigns || !Array.isArray(mixDesigns) || mixDesigns.length === 0) {
      throw new Error('配合比数据不能为空')
    }

    // Step A: 材料组合分组
    const groups = this._groupByMaterialCombination(mixDesigns)

    // Step B: 跨组合共享参数分析
    const sharedParams = this._analyzeSharedParams(groups)

    // Step C: 逐组诊断
    const allResults = []
    for (const group of groups) {
      if (group.mixDesigns.length === 1) {
        allResults.push(this._singleGroupDiagnosis(group))
      } else {
        allResults.push(this._multiGroupDiagnosis(group, sharedParams))
      }
    }

    // Step D: 合并结果并评估置信度
    const merged = this._mergeResults(allResults, sharedParams)

    // Step E: 计算残差
    const residuals = this._calculateResiduals(mixDesigns, merged)

    // Step F: 格式化输出
    return this._formatOutput(merged, residuals, mixDesigns)
  }

  /**
   * 按材料组合分组
   * "同材料组合"定义：水泥、掺合料、骨料、减水剂的种类一致，但用量可以不同
   */
  _groupByMaterialCombination(mixDesigns) {
    const groups = []

    for (const mix of mixDesigns) {
      const mapping = mix.materialMapping || {}
      const key = this._getCombinationKey(mapping)

      let group = groups.find(g => g.key === key)
      if (!group) {
        group = {
          key,
          mixDesigns: [],
          // 提取该组合使用的材料信息
          cement: mapping.cement,
          flyAsh: mapping.flyAsh,
          slag: mapping.slag,
          lithiumSlag: mapping.lithiumSlag,
          compositePowder: mapping.compositePowder,
          sand: mapping.sand?.[0] || mapping.sand,
          stone: mapping.stone?.[0] || mapping.stone,
          superplasticizer: mapping.superplasticizer
        }
        groups.push(group)
      }
      group.mixDesigns.push(mix)
    }

    return groups
  }

  /**
   * 生成材料组合唯一标识
   */
  _getCombinationKey(mapping) {
    const parts = [
      mapping.cement?.id || 'no-cement',
      mapping.flyAsh?.id || 'no-fa',
      mapping.slag?.id || 'no-slag',
      mapping.lithiumSlag?.id || 'no-ls',
      mapping.compositePowder?.id || 'no-cp',
      mapping.sand?.[0]?.id || mapping.sand?.id || 'no-sand',
      mapping.stone?.[0]?.id || mapping.stone?.id || 'no-stone',
      mapping.superplasticizer?.id || 'no-sp'
    ]
    return parts.join('|')
  }

  /**
   * 按材料字段分组（通用辅助方法）
   */
  _groupByMaterialField(groups, fieldName, groupKeyType = 'materialId') {
    const map = {}
    for (const group of groups) {
      const material = group[fieldName]
      if (material) {
        const id = material.id
        if (!map[id]) {
          map[id] = {
            [groupKeyType]: id,
            name: material.name,
            groups: []
          }
        }
        map[id].groups.push(group)
      }
    }
    return Object.values(map)
  }

  /**
   * 分析跨组合参数共享关系
   * 返回每个参数的共享范围
   */
  _analyzeSharedParams(groups) {
    return {
      f_ce: this._groupByMaterialField(groups, 'cement', 'cementId'),
      gamma_f: this._groupByMaterialField(groups, 'flyAsh'),
      gamma_s: this._groupByMaterialField(groups, 'slag'),
      gamma_l: this._groupByMaterialField(groups, 'lithiumSlag'),
      gamma_c: this._groupByMaterialField(groups, 'compositePowder'),
      alpha_ab: this._getAlphaAbGroups(groups),
      admixture: this._groupByMaterialField(groups, 'superplasticizer'),
    }
  }

  /**
   * 粗骨料类型分组（卵石/碎石 → α_a, α_b）
   */
  _getAlphaAbGroups(groups) {
    const map = {}
    for (const group of groups) {
      if (group.stone) {
        const aggType = group.stone.specification?.includes('卵石') ? '卵石' : '碎石'
        if (!map[aggType]) map[aggType] = { aggType, groups: [] }
        map[aggType].groups.push(group)
      }
    }
    return Object.values(map)
  }

  /**
   * 单组偏差溯源：逐参数反推"应该是多少"
   */
  _singleGroupDiagnosis(group) {
    const mix = group.mixDesigns[0]
    const mapping = mix.materialMapping || {}
    const testResults = mix.testResults || {}

    const actualStrength28d = testResults.strengthR28 || testResults.strength28d || 0
    const actualDosage = testResults.actualSuperplasticizerDosage || 0
    const actualWater = testResults.actualWater || 0

    if (!actualStrength28d && !actualDosage && !actualWater) {
      return { group, results: [], method: 'single', error: '无实测数据，无法诊断' }
    }

    const results = []

    const cement = mapping.cement || {}
    const cementStrength = cement.compressiveStrength28d
    const cementStrengthUsed = cementStrength || 48
    const flyAsh = mapping.flyAsh || {}
    const slag = mapping.slag || {}
    const lithiumSlag = mapping.lithiumSlag || {}
    const compositePowder = mapping.compositePowder || {}

    const waterRatio = mix.waterBinderRatio || 0.4

    // --- 强度参数反推 ---
    if (actualStrength28d > 0 && waterRatio > 0) {
      const alphaA = this._getAlphaA(group.stone)
      const alphaB = this._getAlphaB(group.stone)
      const combinedGamma = this._getCombinedGamma(flyAsh, slag, lithiumSlag, compositePowder, mix)

      const wbReciprocal = 1 / waterRatio
      const strengthPerUnit = actualStrength28d / (alphaA * combinedGamma * (wbReciprocal - alphaB))

      // 1.1 假设只有 f_ce 不准
      results.push({
        name: '水泥28天胶砂强度',
        symbol: 'f_ce',
        designValue: cement.compressiveStrength28d || 0,
        diagnosedValue: Math.round(strengthPerUnit * 100) / 100,
        method: '单组偏差溯源'
      })

      if (!cementStrength) {
        results[0].confidence = '低'
        results[0].note = '水泥28d强度缺失，使用默认值48MPa'
      }

      // 1.2 假设只有 γ_f 不准
      if (flyAsh.id) {
        const gammaWithout = this._getGammaWithout(flyAsh, slag, lithiumSlag, compositePowder, 'flyAsh', mix)
        const gammaF = actualStrength28d / (alphaA * cementStrengthUsed * gammaWithout * (wbReciprocal - alphaB))
        const designGamma = this._getDesignGamma(flyAsh, mix.flyAshDosage || mix.flyAsh || 0)
        results.push({
          name: '粉煤灰影响系数',
          symbol: 'γ_f',
          designValue: designGamma,
          diagnosedValue: Math.round(Math.max(0.1, gammaF) * 1000) / 1000,
          method: '单组偏差溯源'
        })
      }

      // 1.3 假设只有 γ_s 不准
      if (slag.id) {
        const gammaWithout = this._getGammaWithout(flyAsh, slag, lithiumSlag, compositePowder, 'slag', mix)
        const gammaS = actualStrength28d / (alphaA * cementStrengthUsed * gammaWithout * (wbReciprocal - alphaB))
        const designGamma = this._getDesignGamma(slag, mix.slagDosage || mix.slag || 0)
        results.push({
          name: '矿渣粉影响系数',
          symbol: 'γ_s',
          designValue: designGamma,
          diagnosedValue: Math.round(Math.max(0.1, gammaS) * 1000) / 1000,
          method: '单组偏差溯源'
        })
      }

      // 1.4 假设只有 γ_l 不准
      if (lithiumSlag.id) {
        const gammaWithout = this._getGammaWithout(flyAsh, slag, lithiumSlag, compositePowder, 'lithiumSlag', mix)
        const gammaL = actualStrength28d / (alphaA * cementStrengthUsed * gammaWithout * (wbReciprocal - alphaB))
        const designGamma = this._getDesignGamma(lithiumSlag, mix.lithiumSlagDosage || mix.lithiumSlag || 0)
        results.push({
          name: '锂渣影响系数',
          symbol: 'γ_l',
          designValue: designGamma,
          diagnosedValue: Math.round(Math.max(0.1, gammaL) * 1000) / 1000,
          method: '单组偏差溯源'
        })
      }

      // 1.5 假设只有 γ_c 不准
      if (compositePowder.id) {
        const gammaWithout = this._getGammaWithout(flyAsh, slag, lithiumSlag, compositePowder, 'compositePowder', mix)
        const gammaC = actualStrength28d / (alphaA * cementStrengthUsed * gammaWithout * (wbReciprocal - alphaB))
        const designGamma = this._getDesignGamma(compositePowder, mix.compositePowderDosage || mix.compositePowder || 0)
        results.push({
          name: '复合粉影响系数',
          symbol: 'γ_c',
          designValue: designGamma,
          diagnosedValue: Math.round(Math.max(0.1, gammaC) * 1000) / 1000,
          method: '单组偏差溯源'
        })
      }

      // 1.6 α_a / α_b
      results.push({
        name: '回归系数α_a',
        symbol: 'α_a',
        designValue: alphaA,
        diagnosedValue: alphaA,
        method: '单组偏差溯源'
      })
      results.push({
        name: '回归系数α_b',
        symbol: 'α_b',
        designValue: alphaB,
        diagnosedValue: alphaB,
        method: '单组偏差溯源'
      })
    }

    return { group, results, method: 'single' }
  }

  /**
   * 获取 α_a（碎石 0.53，卵石 0.49）
   */
  _getAlphaA(stone) {
    if (!stone) return 0.53
    const spec = stone.specification || ''
    return spec.includes('卵石') ? 0.49 : 0.53
  }

  /**
   * 获取 α_b（碎石 0.20，卵石 0.13）
   */
  _getAlphaB(stone) {
    if (!stone) return 0.20
    const spec = stone.specification || ''
    return spec.includes('卵石') ? 0.13 : 0.20
  }

  /**
   * 获取设计影响系数（根据掺量线性插值）
   */
  _getDesignGamma(material, dosage) {
    if (!material || !dosage || typeof dosage !== 'number' || isNaN(dosage)) return 1.0
    const pct = Math.round(dosage)
    const key = `influenceFactor_${pct}`
    if (material[key] !== undefined && material[key] !== null) return material[key]
    // 尝试插值
    const keys = [10, 20, 30, 40, 50]
    for (let i = 0; i < keys.length - 1; i++) {
      if (pct > keys[i] && pct < keys[i + 1]) {
        const v1 = material[`influenceFactor_${keys[i]}`] || 1
        const v2 = material[`influenceFactor_${keys[i + 1]}`] || 1
        return v1 + (v2 - v1) * (pct - keys[i]) / (keys[i + 1] - keys[i])
      }
    }
    return 1.0
  }

  /**
   * 获取除指定掺合料外的影响系数乘积
   */
  _getGammaWithout(flyAsh, slag, lithiumSlag, compositePowder, exclude, mix) {
    let gamma = 1.0
    if (flyAsh?.id && exclude !== 'flyAsh') {
      gamma *= this._getDesignGamma(flyAsh, mix.flyAshDosage || mix.flyAsh || 0)
    }
    if (slag?.id && exclude !== 'slag') {
      gamma *= this._getDesignGamma(slag, mix.slagDosage || mix.slag || 0)
    }
    if (lithiumSlag?.id && exclude !== 'lithiumSlag') {
      gamma *= this._getDesignGamma(lithiumSlag, mix.lithiumSlagDosage || mix.lithiumSlag || 0)
    }
    if (compositePowder?.id && exclude !== 'compositePowder') {
      gamma *= this._getDesignGamma(compositePowder, mix.compositePowderDosage || mix.compositePowder || 0)
    }
    return gamma
  }

  /**
   * 获取组合影响系数 γ = γ_f × γ_s × γ_l × γ_c
   */
  _getCombinedGamma(flyAsh, slag, lithiumSlag, compositePowder, mix) {
    let gamma = 1.0
    if (flyAsh?.id) gamma *= this._getDesignGamma(flyAsh, mix.flyAshDosage || mix.flyAsh || 0)
    if (slag?.id) gamma *= this._getDesignGamma(slag, mix.slagDosage || mix.slag || 0)
    if (lithiumSlag?.id) gamma *= this._getDesignGamma(lithiumSlag, mix.lithiumSlagDosage || mix.lithiumSlag || 0)
    if (compositePowder?.id) gamma *= this._getDesignGamma(compositePowder, mix.compositePowderDosage || mix.compositePowder || 0)
    return gamma
  }

  /**
   * 多组联立反算
   */
  _multiGroupDiagnosis(group, sharedParams) {
    const results = []
    const mixDesigns = group.mixDesigns

    // 阶段 1：强度参数 — 坐标下降法
    const strengthResults = this._coordinateDescentStrength(group, sharedParams)
    results.push(...strengthResults)

    // 阶段 2：外加剂掺量参数 — 线性最小二乘（如果有减水剂数据）
    if (group.superplasticizer) {
      const admixtureResults = this._linearLeastSquaresAdmixture(group)
      results.push(...admixtureResults)

      // 阶段 3：减水率参数 — 线性最小二乘
      const wrResults = this._linearLeastSquaresWaterReduction(group)
      results.push(...wrResults)
    }

    return { group, results, method: 'multi' }
  }

  /**
   * 阶段 1：坐标下降法求解强度参数
   *
   * 待求参数：f_ce, γ_f, γ_s, γ_l, γ_c, α_a, α_b
   *
   * 算法：
   * 1. 所有参数初始化为数据库设计值
   * 2. 固定其他参数，每次用黄金分割法优化一个，最小化 RSS
   * 3. 多轮迭代直到收敛
   */
  _coordinateDescentStrength(group, sharedParams) {
    const mixDesigns = group.mixDesigns

    // Check if any mixDesign has valid strength data
    const hasValidData = mixDesigns.some(m => {
      const tr = m.testResults || {}
      return (tr.strengthR28 || tr.strength28d || 0) > 0
    })
    if (!hasValidData) {
      return [{
        name: '水泥28天胶砂强度',
        symbol: 'f_ce',
        designValue: group.cement?.compressiveStrength28d || 0,
        diagnosedValue: group.cement?.compressiveStrength28d || 0,
        method: '无有效实测数据，无法反算',
        deviationPercent: 0,
        direction: '一致',
        confidence: '低'
      }]
    }

    // 初始化参数
    const params = this._initStrengthParams(group)

    // 坐标下降迭代
    const MAX_ITER = 30
    const TOLERANCE = 1e-3
    let prevRSS = Infinity

    for (let iter = 0; iter < MAX_ITER; iter++) {
      // 按顺序优化每个参数
      for (const paramName of Object.keys(params)) {
        const bound = this._getParamBounds(paramName)
        const optimal = this._goldenSectionSearch(
          params, paramName, bound.min, bound.max, mixDesigns
        )
        params[paramName] = optimal
      }

      // 检查收敛
      const currentRSS = this._calcStrengthRSS(params, mixDesigns)
      if (prevRSS < Infinity && Math.abs(prevRSS - currentRSS) / (Math.abs(prevRSS) + 1) < TOLERANCE) break
      prevRSS = currentRSS
    }

    // 转换为结果格式
    return this._strengthParamsToResults(params, group)
  }

  /**
   * 初始化强度参数（从材料设计值读取）
   */
  _initStrengthParams(group) {
    const params = {}
    const cement = group.cement || {}
    const flyAsh = group.flyAsh || {}
    const slag = group.slag || {}
    const lithiumSlag = group.lithiumSlag || {}
    const compositePowder = group.compositePowder || {}

    params.f_ce = cement.compressiveStrength28d || 48.0

    if (flyAsh.id) {
      const mix = group.mixDesigns[0]
      params.gamma_f = this._getDesignGamma(flyAsh, mix.flyAshDosage || mix.flyAsh || 0)
    }
    if (slag.id) {
      const mix = group.mixDesigns[0]
      params.gamma_s = this._getDesignGamma(slag, mix.slagDosage || mix.slag || 0)
    }
    if (lithiumSlag.id) {
      const mix = group.mixDesigns[0]
      params.gamma_l = this._getDesignGamma(lithiumSlag, mix.lithiumSlagDosage || mix.lithiumSlag || 0)
    }
    if (compositePowder.id) {
      const mix = group.mixDesigns[0]
      params.gamma_c = this._getDesignGamma(compositePowder, mix.compositePowderDosage || mix.compositePowder || 0)
    }

    const stone = group.stone || {}
    params.alpha_a = this._getAlphaA(stone)
    params.alpha_b = this._getAlphaB(stone)

    return params
  }

  /**
   * 获取参数物理边界
   */
  _getParamBounds(paramName) {
    const bounds = {
      f_ce: { min: 30, max: 80 },
      gamma_f: { min: 0.3, max: 1.5 },
      gamma_s: { min: 0.3, max: 1.5 },
      gamma_l: { min: 0.3, max: 1.5 },
      gamma_c: { min: 0.3, max: 1.5 },
      alpha_a: { min: 0.30, max: 0.70 },
      alpha_b: { min: 0.05, max: 0.35 }
    }
    return bounds[paramName] || { min: 0, max: 100 }
  }

  /**
   * 黄金分割法一维搜索
   * 固定 params 中除 targetParam 外的所有参数，搜索 targetParam 的最优值
   */
  _goldenSectionSearch(params, targetParam, min, max, mixDesigns) {
    const GOLDEN_RATIO = 0.618
    let a = min
    let b = max
    let x1 = b - GOLDEN_RATIO * (b - a)
    let x2 = a + GOLDEN_RATIO * (b - a)

    const testParams = { ...params }

    for (let i = 0; i < 40; i++) {
      testParams[targetParam] = x1
      const rss1 = this._calcStrengthRSS(testParams, mixDesigns)

      testParams[targetParam] = x2
      const rss2 = this._calcStrengthRSS(testParams, mixDesigns)

      if (!isFinite(rss1) || !isFinite(rss2)) break

      if (rss1 < rss2) {
        b = x2
        x2 = x1
        x1 = b - GOLDEN_RATIO * (b - a)
      } else {
        a = x1
        x1 = x2
        x2 = a + GOLDEN_RATIO * (b - a)
      }

      if (Math.abs(b - a) < 1e-4) break
    }

    return (a + b) / 2
  }

  /**
   * 计算强度 RSS = Σ(实测强度 - 预测强度)²
   *
   * 预测公式：f_cu,0 = α_a × f_ce × γ × (1/(W/B) - α_b)
   * 其中 γ = γ_f × γ_s × γ_l × γ_c（存在的掺合料才乘）
   */
  _calcStrengthRSS(params, mixDesigns) {
    let rss = 0
    for (const mix of mixDesigns) {
      const testResults = mix.testResults || {}
      const actual = testResults.strengthR28 || testResults.strength28d || 0
      if (actual <= 0) continue

      const predicted = this._predictStrength(params, mix)
      rss += (actual - predicted) ** 2
    }
    return rss
  }

  /**
   * 用给定参数预测强度
   */
  _predictStrength(params, mix) {
    const waterRatio = mix.waterBinderRatio || 0.4
    if (waterRatio <= 0) return 0

    const wbTerm = (1 / waterRatio) - (params.alpha_b || 0.20)
    if (wbTerm <= 0) return 0

    let gamma = 1.0
    if (params.gamma_f !== undefined) gamma *= params.gamma_f
    if (params.gamma_s !== undefined) gamma *= params.gamma_s
    if (params.gamma_l !== undefined) gamma *= params.gamma_l
    if (params.gamma_c !== undefined) gamma *= params.gamma_c

    return (params.alpha_a || 0.53) * (params.f_ce || 48) * gamma * wbTerm
  }

  /**
   * 强度参数转结果格式
   */
  _strengthParamsToResults(params, group) {
    const results = []
    const cement = group.cement || {}

    results.push({
      name: '水泥28天胶砂强度',
      symbol: 'f_ce',
      designValue: cement.compressiveStrength28d || 0,
      diagnosedValue: Math.round(params.f_ce * 100) / 100,
      method: '多组联立反算'
    })

    if (params.gamma_f !== undefined) {
      const mix = group.mixDesigns[0]
      const fa = group.flyAsh || {}
      results.push({
        name: '粉煤灰影响系数',
        symbol: 'γ_f',
        designValue: this._getDesignGamma(fa, mix.flyAshDosage || mix.flyAsh || 0),
        diagnosedValue: Math.round(params.gamma_f * 1000) / 1000,
        method: '多组联立反算'
      })
    }

    if (params.gamma_s !== undefined) {
      const mix = group.mixDesigns[0]
      const sg = group.slag || {}
      results.push({
        name: '矿渣粉影响系数',
        symbol: 'γ_s',
        designValue: this._getDesignGamma(sg, mix.slagDosage || mix.slag || 0),
        diagnosedValue: Math.round(params.gamma_s * 1000) / 1000,
        method: '多组联立反算'
      })
    }

    if (params.gamma_l !== undefined) {
      const mix = group.mixDesigns[0]
      const ls = group.lithiumSlag || {}
      results.push({
        name: '锂渣影响系数',
        symbol: 'γ_l',
        designValue: this._getDesignGamma(ls, mix.lithiumSlagDosage || mix.lithiumSlag || 0),
        diagnosedValue: Math.round(params.gamma_l * 1000) / 1000,
        method: '多组联立反算'
      })
    }

    if (params.gamma_c !== undefined) {
      const mix = group.mixDesigns[0]
      const cp = group.compositePowder || {}
      results.push({
        name: '复合粉影响系数',
        symbol: 'γ_c',
        designValue: this._getDesignGamma(cp, mix.compositePowderDosage || mix.compositePowder || 0),
        diagnosedValue: Math.round(params.gamma_c * 1000) / 1000,
        method: '多组联立反算'
      })
    }

    results.push({
      name: '回归系数α_a',
      symbol: 'α_a',
      designValue: this._getAlphaA(group.stone),
      diagnosedValue: Math.round(params.alpha_a * 1000) / 1000,
      method: '多组联立反算'
    })

    results.push({
      name: '回归系数α_b',
      symbol: 'α_b',
      designValue: this._getAlphaB(group.stone),
      diagnosedValue: Math.round(params.alpha_b * 1000) / 1000,
      method: '多组联立反算'
    })

    return results
  }

  /**
   * 阶段 2：外加剂掺量参数 — 线性最小二乘
   *
   * 掺量公式（线性）：
   * dosage = baseDosage + (strength-30)/5 × strengthInfluence
   *        + (mbValue-0.5)/0.1 × mbInfluence
   *        + (targetFM-actualFM)/0.1 × finenessInfluence
   *
   * 每组数据提供一行方程，直接最小二乘求解。
   */
  _linearLeastSquaresAdmixture(group) {
    const mixDesigns = group.mixDesigns
    const sp = group.superplasticizer || {}

    // 收集有实测掺量的数据
    const rows = []
    for (const mix of mixDesigns) {
      const tr = mix.testResults || {}
      const actualDosage = tr.actualSuperplasticizerDosage || 0
      if (actualDosage <= 0) continue

      const strength = parseFloat((mix.strengthGrade || 'C30').replace('C', '')) || 30
      const sand = group.sand || {}
      const mbValue = sand.mbValue || 0.5
      const targetFM = 2.6
      const actualFM = sand.finenessModulus || 2.6

      rows.push({
        actualDosage,
        strength,
        mbValue,
        targetFM,
        actualFM
      })
    }

    if (rows.length < 2) {
      return [{
        name: '基准掺量',
        symbol: 'baseDosage',
        designValue: sp.recommendedDosage || 0,
        diagnosedValue: sp.recommendedDosage || 0,
        method: '数据不足，使用设计值'
      }]
    }

    // 构造正规方程 A^T A x = A^T b
    // x = [baseDosage, strengthInfluence, mbInfluence, finenessInfluence]
    const A = rows.map(r => [
      1,
      (r.strength - 30) / 5,
      (r.mbValue - 0.5) / 0.1,
      (r.targetFM - r.actualFM) / 0.1
    ])
    const b = rows.map(r => r.actualDosage)

    const x = this._solveNormalEquation(A, b, 4)

    return [
      {
        name: '基准掺量',
        symbol: 'baseDosage',
        designValue: sp.recommendedDosage || 0,
        diagnosedValue: Math.round(x[0] * 100) / 100,
        method: '多组联立反算'
      },
      {
        name: '强度等级影响系数',
        symbol: 'strengthInfluence',
        designValue: 0,
        diagnosedValue: Math.round(x[1] * 1000) / 1000,
        method: '多组联立反算'
      },
      {
        name: 'MB值影响系数',
        symbol: 'mbInfluence',
        designValue: 0,
        diagnosedValue: Math.round(x[2] * 1000) / 1000,
        method: '多组联立反算'
      },
      {
        name: '细度模数影响系数',
        symbol: 'finenessInfluence',
        designValue: 0,
        diagnosedValue: Math.round(x[3] * 1000) / 1000,
        method: '多组联立反算'
      }
    ]
  }

  /**
   * 阶段 3：减水率参数 — 线性最小二乘
   *
   * 减水率公式（线性）：
   * waterReducingRate = baseReducingRate + (dosage - baseDosage)/0.1 × ratePer01
   */
  _linearLeastSquaresWaterReduction(group) {
    const mixDesigns = group.mixDesigns
    const sp = group.superplasticizer || {}

    // 收集有实测用水量的数据
    const rows = []
    for (const mix of mixDesigns) {
      const tr = mix.testResults || {}
      const actualWater = tr.actualWater || 0
      if (actualWater <= 0) continue

      const theoreticalWater = mix.water || 175
      if (theoreticalWater <= 0) continue

      // 实际减水率 = (理论用水量 - 实际用水量) / 理论用水量 × 100%
      const actualWRR = ((theoreticalWater - actualWater) / theoreticalWater) * 100
      const dosage = tr.actualSuperplasticizerDosage || mix.superplasticizerDosage || 1.0
      const baseDosage = sp.recommendedDosage || 1.0

      rows.push({
        actualWRR: Math.max(0, actualWRR),
        dosage,
        baseDosage
      })
    }

    if (rows.length < 2) {
      return [{
        name: '基准减水率',
        symbol: 'baseReducingRate',
        designValue: sp.waterReducingRate || 0,
        diagnosedValue: sp.waterReducingRate || 0,
        method: '数据不足，使用设计值'
      }]
    }

    // 构造正规方程
    const A = rows.map(r => [1, (r.dosage - r.baseDosage) / 0.1])
    const b = rows.map(r => r.actualWRR)
    const x = this._solveNormalEquation(A, b, 2)

    return [
      {
        name: '基准减水率',
        symbol: 'baseReducingRate',
        designValue: sp.waterReducingRate || 0,
        diagnosedValue: Math.round(x[0] * 100) / 100,
        method: '多组联立反算'
      },
      {
        name: '每0.1%掺量减水率',
        symbol: 'ratePer01',
        designValue: sp.waterReducingRatePer01Dosage || 0,
        diagnosedValue: Math.round(x[1] * 1000) / 1000,
        method: '多组联立反算'
      }
    ]
  }

  /**
   * 求解正规方程 A^T A x = A^T b
   * 使用高斯消元法（带部分选主元）
   */
  _solveNormalEquation(A, b, numParams) {
    const n = numParams
    // 构造 A^T A (n×n) 和 A^T b (n×1)
    const ata = Array(n).fill(null).map(() => Array(n).fill(0))
    const atb = Array(n).fill(0)

    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < n; j++) {
        atb[j] += A[i][j] * b[i]
        for (let k = 0; k < n; k++) {
          ata[j][k] += A[i][j] * A[i][k]
        }
      }
    }

    // 高斯消元
    for (let col = 0; col < n; col++) {
      // 部分选主元
      let maxRow = col
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(ata[row][col]) > Math.abs(ata[maxRow][col])) {
          maxRow = row
        }
      }
      // 交换行
      [ata[col], ata[maxRow]] = [ata[maxRow], ata[col]]
      const tmpB = atb[col]
      atb[col] = atb[maxRow]
      atb[maxRow] = tmpB

      // 消元
      const pivot = ata[col][col]
      if (Math.abs(pivot) < 1e-12) continue

      for (let row = col + 1; row < n; row++) {
        const factor = ata[row][col] / pivot
        for (let k = col; k < n; k++) {
          ata[row][k] -= factor * ata[col][k]
        }
        atb[row] -= factor * atb[col]
      }
    }

    // 回代
    const x = Array(n).fill(0)
    for (let i = n - 1; i >= 0; i--) {
      let sum = atb[i]
      for (let j = i + 1; j < n; j++) {
        sum -= ata[i][j] * x[j]
      }
      x[i] = Math.abs(ata[i][i]) < 1e-12 ? 0 : sum / ata[i][i]
    }

    return x
  }

  /**
   * 合并各组诊断结果
   */
  _mergeResults(allResults, sharedParams) {
    const merged = {
      strengthParams: [],
      admixtureParams: [],
      reducingRateParams: []
    }

    for (const groupResult of allResults) {
      for (const r of groupResult.results) {
        const sym = r.symbol
        if (sym === 'f_ce' || sym === 'γ_f' || sym === 'γ_s' ||
            sym === 'γ_l' || sym === 'γ_c' || sym === 'α_a' || sym === 'α_b') {
          merged.strengthParams.push(r)
        } else if (sym === 'baseDosage' || sym === 'strengthInfluence' ||
                   sym === 'mbInfluence' || sym === 'finenessInfluence') {
          merged.admixtureParams.push(r)
        } else if (sym === 'baseReducingRate' || sym === 'ratePer01') {
          merged.reducingRateParams.push(r)
        }
      }
    }

    return merged
  }

  /**
   * 计算各组数据的预测值 vs 实测值残差
   */
  _calculateResiduals(mixDesigns, merged) {
    const residuals = []

    // 收集诊断得到的强度参数用于预测
    const strengthParams = {}
    for (const p of merged.strengthParams) {
      if (p.diagnosedValue !== undefined) {
        strengthParams[p.symbol] = p.diagnosedValue
      }
    }

    for (const mix of mixDesigns) {
      const tr = mix.testResults || {}
      const actual = tr.strengthR28 || tr.strength28d || 0
      if (actual <= 0) continue

      const predicted = this._predictStrength(strengthParams, mix)

      residuals.push({
        groupName: mix.name || mix.id || '未知',
        actual: Math.round(actual * 10) / 10,
        predicted: Math.round(predicted * 10) / 10,
        residual: Math.round((actual - predicted) * 10) / 10
      })
    }

    return residuals
  }

  /**
   * 格式化输出为符合设计文档 5.2 的 JSON 结构
   */
  _formatOutput(merged, residuals, mixDesigns) {
    const classifyParams = (params) => {
      const abnormal = []
      const normal = []

      for (const p of params) {
        const dv = p.designValue || 0
        const devPct = dv !== 0 ? ((p.diagnosedValue - dv) / dv) * 100 : 0
        const absDev = Math.abs(devPct)

        const entry = {
          name: p.name,
          symbol: p.symbol,
          designValue: p.designValue,
          diagnosedValue: p.diagnosedValue,
          deviationPercent: Math.round(devPct * 10) / 10,
          direction: devPct > 1 ? '偏高' : devPct < -1 ? '偏低' : '一致',
          confidence: this._assessConfidence(p, absDev),
          sharedAcross: this._describeSharedAcross(p),
          method: p.method
        }

        if (absDev > 5) {
          abnormal.push(entry)
        } else {
          normal.push(entry)
        }
      }

      return { abnormal, normal }
    }

    const strengthClassified = classifyParams(merged.strengthParams)
    const admixtureClassified = classifyParams(merged.admixtureParams)
    const reducingRateClassified = classifyParams(merged.reducingRateParams)

    const totalAbnormal = strengthClassified.abnormal.length +
      admixtureClassified.abnormal.length +
      reducingRateClassified.abnormal.length

    // 计算 R²
    const ssRes = residuals.reduce((sum, r) => sum + r.residual * r.residual, 0)
    const actualMean = residuals.length > 0
      ? residuals.reduce((sum, r) => sum + r.actual, 0) / residuals.length
      : 0
    const ssTot = residuals.reduce((sum, r) => sum + (r.actual - actualMean) ** 2, 0)
    const rSquared = ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 1000) / 1000 : 0

    let overallAssessment
    if (totalAbnormal === 0) {
      overallAssessment = '各项参数与设计值吻合良好'
    } else if (totalAbnormal <= 2) {
      overallAssessment = `存在 ${totalAbnormal} 项参数偏差，整体影响有限`
    } else {
      overallAssessment = `存在 ${totalAbnormal} 项参数显著偏差，建议重点关注`
    }

    // 计算材料组合数
    const combos = new Set()
    for (const mix of mixDesigns) {
      const mapping = mix.materialMapping || {}
      combos.add(this._getCombinationKey(mapping))
    }

    return {
      summary: {
        totalGroups: mixDesigns.length,
        materialCombinations: combos.size,
        abnormalCount: totalAbnormal,
        rSquared,
        overallAssessment
      },
      strengthParams: {
        label: '强度相关参数',
        abnormal: strengthClassified.abnormal,
        normal: strengthClassified.normal
      },
      admixtureParams: {
        label: '外加剂掺量相关参数',
        abnormal: admixtureClassified.abnormal,
        normal: admixtureClassified.normal
      },
      reducingRateParams: {
        label: '减水率相关参数',
        abnormal: reducingRateClassified.abnormal,
        normal: reducingRateClassified.normal
      },
      residuals
    }
  }

  /**
   * 定性评估置信度
   */
  _assessConfidence(param, absDeviation) {
    const method = param.method || ''
    if (method.includes('数据不足') || method.includes('无有效实测数据')) return '低'
    if (method.includes('多组联立')) {
      return absDeviation > 10 ? '高' : '中'
    }
    if (method.includes('单组偏差溯源')) return '低'
    return '低'
  }

  /**
   * 描述参数跨组合共享范围（简化实现）
   */
  _describeSharedAcross(param) {
    return ''
  }
}

module.exports = new ParameterDiagnosisService()

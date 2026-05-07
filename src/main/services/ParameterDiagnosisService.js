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

  // ---- 占位方法（后续任务实现） ----

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

      // 1.2 假设只有 γ_f 不准
      if (flyAsh.id) {
        const gammaWithout = this._getGammaWithout(flyAsh, slag, lithiumSlag, compositePowder, 'flyAsh', mix)
        const gammaF = actualStrength28d / (alphaA * (cement.compressiveStrength28d || 48) * gammaWithout * (wbReciprocal - alphaB))
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
        const gammaS = actualStrength28d / (alphaA * (cement.compressiveStrength28d || 48) * gammaWithout * (wbReciprocal - alphaB))
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
        const gammaL = actualStrength28d / (alphaA * (cement.compressiveStrength28d || 48) * gammaWithout * (wbReciprocal - alphaB))
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
        const gammaC = actualStrength28d / (alphaA * (cement.compressiveStrength28d || 48) * gammaWithout * (wbReciprocal - alphaB))
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
    if (!material || !dosage) return 1.0
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

  _multiGroupDiagnosis(group, sharedParams) {
    return { group, results: [], method: 'multi' }
  }

  _mergeResults(allResults, sharedParams) {
    return { strengthParams: [], admixtureParams: [], reducingRateParams: [] }
  }

  _calculateResiduals(mixDesigns, merged) {
    return []
  }

  _formatOutput(merged, residuals, mixDesigns) {
    return {
      summary: { totalGroups: 0, materialCombinations: 0, abnormalCount: 0, overallAssessment: '' },
      strengthParams: { label: '强度相关参数', abnormal: [], normal: [] },
      admixtureParams: { label: '外加剂掺量相关参数', abnormal: [], normal: [] },
      reducingRateParams: { label: '减水率相关参数', abnormal: [], normal: [] },
      residuals: []
    }
  }
}

module.exports = new ParameterDiagnosisService()

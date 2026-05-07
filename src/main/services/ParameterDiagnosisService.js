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

  _singleGroupDiagnosis(group) {
    return { group, results: [], method: 'single' }
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

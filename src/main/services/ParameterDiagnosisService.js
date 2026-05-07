/**
 * 参数诊断服务
 * 智能解析的第一步：上传数据后自动反算材料参数，对比新旧参数差异
 *
 * 诊断策略：
 * - 同材料组合仅 1 组 → 单组偏差溯源
 * - 同材料组合 ≥ 2 组 → 多组联立反算（坐标下降法 + 线性最小二乘）
 */

const MixDesignService = require('./MixDesignService')

class ParameterDiagnosisService {
  /**
   * 执行参数诊断
   * @param {Array} mixDesigns - 配合比数据列表，每条需含 testResults 和 materialMapping
   * @returns {Object} 诊断结果（符合设计文档 5.2 输出 JSON 结构）
   */
  async diagnose(mixDesigns) {
    // Step A: 材料组合分组
    const groups = this._groupByMaterialCombination(mixDesigns)

    // Step B: 跨组合共享参数分析
    const sharedParams = this._analyzeSharedParams(groups, mixDesigns)

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
   * 分析跨组合参数共享关系
   * 返回每个参数的共享范围
   */
  _analyzeSharedParams(groups, mixDesigns) {
    const shared = {
      f_ce: [],
      gamma_f: [],
      gamma_s: [],
      gamma_l: [],
      gamma_c: [],
      alpha_ab: [],
      admixture: [],
    }

    // 水泥 → f_ce 共享分析
    const cementMap = {}
    for (const group of groups) {
      if (group.cement) {
        const cid = group.cement.id
        if (!cementMap[cid]) cementMap[cid] = { cementId: cid, name: group.cement.name, groups: [] }
        cementMap[cid].groups.push(group)
      }
    }
    shared.f_ce = Object.values(cementMap)

    // 粉煤灰 → γ_f 共享分析
    const faMap = {}
    for (const group of groups) {
      if (group.flyAsh) {
        const fid = group.flyAsh.id
        if (!faMap[fid]) faMap[fid] = { materialId: fid, name: group.flyAsh.name, groups: [] }
        faMap[fid].groups.push(group)
      }
    }
    shared.gamma_f = Object.values(faMap)

    // 矿渣粉 → γ_s 共享分析
    const slagMap = {}
    for (const group of groups) {
      if (group.slag) {
        const sid = group.slag.id
        if (!slagMap[sid]) slagMap[sid] = { materialId: sid, name: group.slag.name, groups: [] }
        slagMap[sid].groups.push(group)
      }
    }
    shared.gamma_s = Object.values(slagMap)

    // 锂渣 → γ_l 共享分析
    const lsMap = {}
    for (const group of groups) {
      if (group.lithiumSlag) {
        const lid = group.lithiumSlag.id
        if (!lsMap[lid]) lsMap[lid] = { materialId: lid, name: group.lithiumSlag.name, groups: [] }
        lsMap[lid].groups.push(group)
      }
    }
    shared.gamma_l = Object.values(lsMap)

    // 复合粉 → γ_c 共享分析
    const cpMap = {}
    for (const group of groups) {
      if (group.compositePowder) {
        const cid = group.compositePowder.id
        if (!cpMap[cid]) cpMap[cid] = { materialId: cid, name: group.compositePowder.name, groups: [] }
        cpMap[cid].groups.push(group)
      }
    }
    shared.gamma_c = Object.values(cpMap)

    // 粗骨料类型 → α_a, α_b 共享分析
    const aggTypeMap = {}
    for (const group of groups) {
      if (group.stone) {
        const aggType = group.stone.specification?.includes('卵石') ? '卵石' : '碎石'
        if (!aggTypeMap[aggType]) aggTypeMap[aggType] = { aggType, groups: [] }
        aggTypeMap[aggType].groups.push(group)
      }
    }
    shared.alpha_ab = Object.values(aggTypeMap)

    // 减水剂 → 外加剂参数共享分析
    const spMap = {}
    for (const group of groups) {
      if (group.superplasticizer) {
        const spId = group.superplasticizer.id
        if (!spMap[spId]) spMap[spId] = { materialId: spId, name: group.superplasticizer.name, groups: [] }
        spMap[spId].groups.push(group)
      }
    }
    shared.admixture = Object.values(spMap)

    return shared
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

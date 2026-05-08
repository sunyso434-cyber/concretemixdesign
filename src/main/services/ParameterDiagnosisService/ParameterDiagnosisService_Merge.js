/**
 * 结果合并模块
 * 职责：结果合并和格式化
 */

module.exports = {
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
  },

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
  },

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
  },

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
  },

  /**
   * 描述参数跨组合共享范围（简化实现）
   */
  _describeSharedAcross(param) {
    return ''
  }
}

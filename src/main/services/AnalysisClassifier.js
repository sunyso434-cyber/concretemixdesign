/**
 * 分析类型自动识别服务
 * 输入：mixDesigns + materialMapping + userPrompt
 * 输出：{ modes, param_trend, material_contrast }
 */

const MATERIAL_LABEL_TO_KEY = {
  水泥: 'cement',
  粉煤灰: 'flyAsh',
  矿渣粉: 'slag',
  锂渣: 'lithiumSlag',
  复合粉: 'compositePowder',
  细骨料: 'fineAggregate1',
  粗骨料: 'coarseAggregate',
  减水剂: 'superplasticizer'
}

const VALID_MATERIAL_KEYS = new Set([
  'cement',
  'flyAsh',
  'slag',
  'lithiumSlag',
  'compositePowder',
  'fineAggregate1',
  'fineAggregate2',
  'coarseAggregate',
  'superplasticizer'
])

class AnalysisClassifier {
  /**
   * 主入口：分类分析类型
   * @param {Array} mixDesigns - buildAnalysisData 输出的配合比详情
   * @param {Object} materialMapping - { [mixId]: { cement: id, flyAsh: id, ... } }
   * @param {string} userPrompt - 用户提示词（可选）
   * @param {Object} options - 可选项
   * @param {string[]} options.selectedContrastMaterials - 用户勾选的对比材料类型
   * @returns {Object} { modes: string[], param_trend: {...}, material_contrast: {...} }
   */
  classify(mixDesigns, materialMapping, userPrompt = '', options = {}) {
    if (!mixDesigns || mixDesigns.length < 2) {
      return { modes: [] }
    }

    const paramTrend = this._detectParamTrend(mixDesigns, materialMapping)
    const materialContrast = this._detectMaterialContrast(
      mixDesigns,
      materialMapping,
      userPrompt,
      options.selectedContrastMaterials
    )

    const modes = []
    if (paramTrend) modes.push('param_trend')
    if (materialContrast) modes.push('material_contrast')

    return { modes, param_trend: paramTrend, material_contrast: materialContrast }
  }

  /**
   * 参数趋势检测：材料组合完全一致 + 某参数存在 ≥2 个不同值
   */
  _detectParamTrend(mixDesigns, materialMapping) {
    // 提取材料组合签名（各材料类型的ID组合）
    const signatures = mixDesigns.map(mix => {
      const mapping = materialMapping[mix.id] || {}
      return JSON.stringify({
        cement: this._materialId(mapping.cement) || 'same',
        flyAsh: this._materialId(mapping.flyAsh) || 'same',
        slag: this._materialId(mapping.slag) || 'same',
        lithiumSlag: this._materialId(mapping.lithiumSlag) || 'same',
        compositePowder: this._materialId(mapping.compositePowder) || 'same',
        fineAggregate1: this._materialId(mapping.fineAggregate1) || 'same',
        fineAggregate2: this._materialId(mapping.fineAggregate2) || 'same',
        coarseAggregate: this._materialId(mapping.coarseAggregate) || 'same',
        superplasticizer: this._materialId(mapping.superplasticizer) || 'same'
      })
    })

    const allSameMaterial = new Set(signatures).size === 1
    if (!allSameMaterial) return null

    // 遍历参数，找 ≥2 个不同值的参数
    const paramFields = [
      'waterBinderRatio', 'cement', 'flyAsh', 'slag',
      'lithiumSlag', 'compositePowder', 'sandRate',
      'waterReducerDosage', 'fineAggregate1'
    ]

    const varyingParams = []
    for (const field of paramFields) {
      const values = new Set()
      for (const mix of mixDesigns) {
        let val = mix[field]
        if (val === undefined) val = mix.mixDesign?.[field]
        if (val !== undefined && val !== null) {
          values.add(Number(val).toFixed(4))
        }
      }
      if (values.size >= 2) {
        varyingParams.push(field)
      }
    }

    if (varyingParams.length === 0) return null

    return {
      varying_params: varyingParams,
      fixed_params: ['material_combination']
    }
  }

  /**
   * 材料对比检测
   * 条件A：材料组合不一致 → 排除砂率/外加剂掺量 → 比较其余参数是否一致
   * 条件B：用户提示词指定对比材料
   */
  _detectMaterialContrast(mixDesigns, materialMapping, userPrompt, selectedContrastMaterials = null) {
    const selected = this._normalizeContrastMaterials(selectedContrastMaterials)
    if (selected.length > 0) {
      const autoResult = this._autoDetectContrast(mixDesigns, materialMapping)
      return {
        changed_materials: selected,
        groups: autoResult?.groups || [],
        source: 'user_selected'
      }
    }

    // 条件B：用户指定
    const userSpecified = this._parseUserSpecifiedContrast(userPrompt)
    if (userSpecified) {
      const autoResult = this._autoDetectContrast(mixDesigns, materialMapping)
      return {
        ...userSpecified,
        groups: autoResult?.groups || []
      }
    }

    // 条件A：自动识别
    return this._autoDetectContrast(mixDesigns, materialMapping)
  }

  /**
   * 解析用户提示词中的材料对比意图
   */
  _parseUserSpecifiedContrast(userPrompt) {
    if (!userPrompt || !userPrompt.trim()) return null
    // 匹配模式：对比 + 材料类型
    const patterns = [
      /对比\s*(水泥|粉煤灰|矿渣粉|锂渣|复合粉|细骨料|粗骨料|减水剂)/,
      /比较\s*(水泥|粉煤灰|矿渣粉|锂渣|复合粉|细骨料|粗骨料|减水剂)/,
      /(水泥|粉煤灰|矿渣粉|锂渣|复合粉|细骨料|粗骨料|减水剂)\s*对比/,
    ]
    for (const p of patterns) {
      const match = userPrompt.match(p)
      if (match) {
        return {
          changed_materials: [MATERIAL_LABEL_TO_KEY[match[1]] || match[1]],
          source: 'user_specified'
        }
      }
    }
    return null
  }

  /**
   * 自动检测材料对比
   */
  _autoDetectContrast(mixDesigns, materialMapping) {
    if (mixDesigns.length < 2) return null

    // 按材料组合签名分组
    const groups = new Map()
    for (const mix of mixDesigns) {
      const mapping = materialMapping[mix.id] || {}
      const sig = JSON.stringify({
        cement: this._materialId(mapping.cement),
        flyAsh: this._materialId(mapping.flyAsh),
        slag: this._materialId(mapping.slag),
        lithiumSlag: this._materialId(mapping.lithiumSlag),
        compositePowder: this._materialId(mapping.compositePowder),
        fineAggregate1: this._materialId(mapping.fineAggregate1),
        fineAggregate2: this._materialId(mapping.fineAggregate2),
        coarseAggregate: this._materialId(mapping.coarseAggregate),
        superplasticizer: this._materialId(mapping.superplasticizer)
      })
      if (!groups.has(sig)) groups.set(sig, [])
      groups.get(sig).push(mix)
    }

    if (groups.size < 2) return null

    // 找出变化的材料类型
    const entries = [...groups.entries()]
    const sig0 = JSON.parse(entries[0][0])
    const sig1 = JSON.parse(entries[1][0])
    const changedTypes = []

    for (const key of Object.keys(sig0)) {
      if (sig0[key] !== sig1[key] && sig0[key] && sig1[key]) {
        changedTypes.push(key)
      }
    }

    if (changedTypes.length === 0) return null

    // 排除砂率、外加剂掺量后，验证其余参数是否一致
    const excludedParams = ['sandRate', 'waterReducerDosage']
    const checkParams = [
      'waterBinderRatio', 'cement', 'flyAsh', 'slag',
      'lithiumSlag', 'compositePowder', 'fineAggregate1'
    ]

    for (const param of checkParams) {
      const groupMeans = entries.map(([sig, mixes]) => {
        const vals = mixes.map(m => {
          let v = m[param]
          if (v === undefined) v = m.mixDesign?.[param]
          return v
        }).filter(v => v !== undefined && v !== null)
        if (vals.length === 0) return null
        return vals.reduce((s, v) => s + Number(v), 0) / vals.length
      }).filter(v => v !== null)

      if (groupMeans.length >= 2) {
        const maxMean = Math.max(...groupMeans)
        const minMean = Math.min(...groupMeans)
        const threshold = Math.abs(minMean) > 0.01 ? 0.10 : 0.05
        if (Math.abs(maxMean - minMean) > Math.abs(minMean) * threshold + 0.01) {
          return null  // 参数不一致，非纯材料对比
        }
      }
    }

    return {
      changed_materials: changedTypes,
      groups: entries.map(([sig, mixes]) => ({
        signature: JSON.parse(sig),
        mixIds: mixes.map(m => m.id)
      })),
      source: 'auto_detected'
    }
  }

  _normalizeContrastMaterials(materials) {
    if (!Array.isArray(materials)) return []
    const normalized = []
    for (const item of materials) {
      const key = MATERIAL_LABEL_TO_KEY[item] || item
      if (VALID_MATERIAL_KEYS.has(key) && !normalized.includes(key)) {
        normalized.push(key)
      }
    }
    return normalized
  }

  _materialId(material) {
    if (Array.isArray(material)) {
      return material.map(item => this._materialId(item)).filter(Boolean).join(',')
    }
    if (material && typeof material === 'object') {
      return material.id || ''
    }
    return material || ''
  }
}

module.exports = AnalysisClassifier

/**
 * 材料组合分组模块
 * 职责：材料组合分析
 */

module.exports = {
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
  },

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
  },

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
  },

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
  },

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
}

// src/main/services/CandidatePoolBuilder.js
const MaterialService = require('./MaterialService')

/**
 * materialIds 字段到 candidatePool key 的映射
 */
const FIELD_TO_POOL_KEY = {
  cementIds: 'cement',
  flyAshIds: 'flyAsh',
  slagIds: 'slag',
  lithiumSlagIds: 'lithiumSlag',
  compositePowderIds: 'compositePowder',
  sandIds: 'sand',
  stoneIds: 'stone',
  spIds: 'sp',
  waterIds: 'water',
}

const CandidatePoolBuilder = {
  /**
   * 从 materialIds 构建材料快照。
   * 1. 从数据库获取所有材料
   * 2. 校验 ID 存在性、必填、数量限制
   * 3. 构建 byId Map、byType 分组、candidatePools
   * @param {Object} materialIds - 用户指定的材料 ID 列表
   * @returns {Promise<{byId: Map, byType: Object, candidatePools: Object}>}
   */
  async buildSnapshot(materialIds) {
    const materials = await MaterialService.getAllMaterials()

    // 1. 构建 byId Map（所有材料，用于快速查属性）
    const byId = new Map()
    for (const m of materials) {
      byId.set(m.id, m)
    }

    // 2. 构建 byType 分组（所有材料，按 type 字段分组）
    const byType = {}
    for (const m of materials) {
      if (!byType[m.type]) {
        byType[m.type] = []
      }
      byType[m.type].push(m)
    }

    // 3. 收集所有用户传入的 ID
    const allIds = []
    for (const fieldKey of Object.keys(FIELD_TO_POOL_KEY)) {
      const ids = materialIds[fieldKey]
      if (Array.isArray(ids)) {
        for (const id of ids) {
          allIds.push(id)
        }
      }
    }

    // 4. 校验所有 ID 存在于材料库中
    for (const id of allIds) {
      if (!byId.has(id)) {
        throw new Error(`材料 ID ${id} 不存在`)
      }
    }

    // 5. 安全获取 ID 数组的辅助函数（缺失字段视为空数组）
    const getIds = (key) => {
      const val = materialIds[key]
      return Array.isArray(val) ? val : []
    }

    // 6. 校验必填和数量限制
    const cementIds = getIds('cementIds')
    if (cementIds.length === 0) {
      throw new Error('水泥候选不能为空')
    }

    const waterIds = getIds('waterIds')
    if (waterIds.length === 0) {
      throw new Error('水候选不能为空')
    }
    if (waterIds.length !== 1) {
      throw new Error('水候选必须且只能指定 1 种')
    }

    const spIds = getIds('spIds')
    if (spIds.length === 0) {
      throw new Error('减水剂候选不能为空')
    }

    const sandIds = getIds('sandIds')
    if (sandIds.length === 0) {
      throw new Error('细骨料候选不能为空')
    }
    if (sandIds.length > 2) {
      throw new Error('细骨料候选最多2种')
    }

    const stoneIds = getIds('stoneIds')
    if (stoneIds.length === 0) {
      throw new Error('粗骨料候选不能为空')
    }
    if (stoneIds.length > 2) {
      throw new Error('粗骨料候选最多2种')
    }

    // 7. 构建 candidatePools
    const candidatePools = {}
    for (const [fieldKey, poolKey] of Object.entries(FIELD_TO_POOL_KEY)) {
      const ids = getIds(fieldKey)
      candidatePools[poolKey] = ids.map((id) => byId.get(id))
    }

    return { byId, byType, candidatePools }
  },
}

module.exports = CandidatePoolBuilder

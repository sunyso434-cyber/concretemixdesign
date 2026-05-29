const { BasicMixDesign } = require('../db/database')

function normalizeMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) {
    throw new Error('基础配合比必须包含材料用量')
  }
  return materials.map(item => ({
    materialId: item.materialId,
    materialType: item.materialType,
    materialName: item.materialName,
    usage: Number(item.usage)
  }))
}

async function clearDefaultForGroup(strengthGrade, concreteType, exceptId = null) {
  const rows = await BasicMixDesign.findAll({ where: { strengthGrade, concreteType, isDefault: true } })
  for (const row of rows) {
    if (exceptId == null || row.id !== exceptId) {
      await row.update({ isDefault: false })
    }
  }
}

async function createBasicMixDesign(data) {
  const payload = {
    name: data.name,
    strengthGrade: data.strengthGrade,
    concreteType: data.concreteType || '普通',
    slump: data.slump,
    materials: normalizeMaterials(data.materials),
    isDefault: !!data.isDefault,
    remarks: data.remarks || '',
    source: data.source || '手工新增',
    enabled: data.enabled !== false
  }
  if (payload.isDefault) {
    await clearDefaultForGroup(payload.strengthGrade, payload.concreteType)
  }
  return await BasicMixDesign.create(payload)
}

async function updateBasicMixDesign(id, data) {
  const row = await BasicMixDesign.findByPk(id)
  if (!row) throw new Error('基础配合比不存在')
  const payload = { ...data }
  if (data.materials) payload.materials = normalizeMaterials(data.materials)
  if (payload.isDefault) {
    await clearDefaultForGroup(payload.strengthGrade || row.strengthGrade, payload.concreteType || row.concreteType, row.id)
  }
  await row.update(payload)
  return row
}

async function listBasicMixDesigns(filters = {}) {
  const where = {}
  if (filters.strengthGrade) where.strengthGrade = filters.strengthGrade
  if (filters.concreteType) where.concreteType = filters.concreteType
  if (filters.enabled != null) where.enabled = filters.enabled
  return await BasicMixDesign.findAll({ where, order: [['isDefault', 'DESC'], ['updatedAt', 'DESC']] })
}

async function findDefaultMix(strengthGrade, concreteType) {
  console.log('[findDefaultMix] 查找:', { strengthGrade, concreteType })
  const result = await BasicMixDesign.findOne({
    where: { strengthGrade, concreteType, enabled: true, isDefault: true }
  }) || await BasicMixDesign.findOne({
    where: { strengthGrade, concreteType, enabled: true },
    order: [['updatedAt', 'DESC']]
  })
  console.log('[findDefaultMix] 结果:', result ? `找到 ID=${result.id}` : '未找到')
  if (!result) {
    // 列出所有匹配 strengthGrade 的记录，帮助调试
    const all = await BasicMixDesign.findAll({ where: { strengthGrade }, attributes: ['id', 'strengthGrade', 'concreteType', 'enabled', 'isDefault'] })
    console.log('[findDefaultMix] 数据库中所有', strengthGrade, '记录:', all.map(r => r.toJSON()))
  }
  return result
}

async function deleteBasicMixDesign(id) {
  const row = await BasicMixDesign.findByPk(id)
  if (!row) throw new Error('基础配合比不存在')
  await row.destroy()
}

async function getBasicMixDesignById(id) {
  return await BasicMixDesign.findByPk(id)
}

async function findById(id) {
  return await BasicMixDesign.findByPk(id)
}

module.exports = {
  createBasicMixDesign,
  updateBasicMixDesign,
  listBasicMixDesigns,
  findDefaultMix,
  deleteBasicMixDesign,
  getBasicMixDesignById,
  findById
}
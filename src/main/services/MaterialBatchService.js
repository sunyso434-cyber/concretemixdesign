const MaterialBatch = require('../db/models/MaterialBatch')
const Material = require('../db/models/Material')
const { sequelize } = require('../db/database')
const { Mutex } = require('async-mutex')

const batchMutex = new Mutex()

// 从 spec A.1 的表结构中提取的检测值字段名列表（不含 ID/元数据字段）
const DETECTION_FIELDS = [
  'density', 'fineness', 'waterContent',
  'specificSurfaceArea', 'standardConsistency', 'stability',
  'initialSettingTime', 'finalSettingTime', 'flexuralStrength3d', 'flexuralStrength28d',
  'compressiveStrength3d', 'compressiveStrength28d', 'cementHeat3d', 'cementHeat7d',
  'waterDemandRatio', 'lossOnIgnition', 'activityIndex7d', 'activityIndex28d',
  'fluidityRatio', 'influenceFactor_10', 'influenceFactor_20',
  'influenceFactor_30', 'influenceFactor_40', 'influenceFactor_50',
  'mudContent', 'clayLumpContent', 'mbValue', 'finenessModulus',
  'sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15',
  'needleFlakeContent', 'crushingValue', 'grading',
  'sieve_37_5', 'sieve_31_5', 'sieve_26_5', 'sieve_19_0', 'sieve_16_0', 'sieve_9_50',
  'solidContent', 'waterReducingRate', 'airContent',
  'recommendedDosage', 'waterReducingRatePer01Dosage',
  'phValue', 'insolubleMatter', 'solubleMatter'
]

// 过期规则（key 匹配 materialType，骨料用 receiptDate 判断库存超期）
const EXPIRY_RULES = {
  '水泥':   { months: 3, field: 'productionDate' },
  '粉煤灰': { months: 6, field: 'productionDate' },
  '矿渣粉': { months: 6, field: 'productionDate' },
  '锂渣':   { months: 6, field: 'productionDate' },
  '复合粉': { months: 6, field: 'productionDate' },
  '减水剂': { months: 6, field: 'expiryDate' },
  '细骨料': { days: 30, field: 'receiptDate', warningOnly: true },
  '粗骨料': { days: 30, field: 'receiptDate', warningOnly: true }
}

class MaterialBatchService {
  // --- 基础 CRUD ---
  async getBatchesByMaterialId(materialId) {
    return await MaterialBatch.findAll({ where: { materialId }, order: [['createdAt', 'DESC']] })
  }

  async getBatchById(id) {
    return await MaterialBatch.findByPk(id)
  }

  async getCurrentBatch(materialId) {
    const material = await Material.findByPk(materialId)
    if (!material || !material.currentBatchId) return null
    return await MaterialBatch.findByPk(material.currentBatchId)
  }

  async createBatch(data) {
    return await MaterialBatch.create(data)
  }

  async updateBatch(id, data) {
    return await sequelize.transaction(async (t) => {
      // 先更新批次
      await MaterialBatch.update(data, { where: { id }, transaction: t })
      // 如果这个批次是某材料的当前批次，同步主表
      const material = await Material.findOne({ where: { currentBatchId: id }, transaction: t })
      if (material) {
        const updateFields = {}
        for (const key of DETECTION_FIELDS) {
          if (data[key] !== undefined) updateFields[key] = data[key]
        }
        if (Object.keys(updateFields).length > 0) {
          await Material.update(updateFields, { where: { id: material.id }, transaction: t })
        }
      }
      return await MaterialBatch.findByPk(id, { transaction: t })
    })
  }

  async deleteBatch(id) {
    // 在用批次不可删
    const material = await Material.findOne({ where: { currentBatchId: id } })
    if (material) throw new Error(`批次正在被材料"${material.name}"使用，请先切换当前批次`)
    return await MaterialBatch.destroy({ where: { id } })
  }

  // --- 真相源机制：切换当前批次（事务 + 互斥锁）---
  async setCurrentBatch(materialId, batchId) {
    return await batchMutex.runExclusive(async () => {
      return await sequelize.transaction(async (t) => {
        const batch = await MaterialBatch.findByPk(batchId, { transaction: t })
        if (!batch) throw new Error(`批次 ${batchId} 不存在`)
        // 同步批次检测值到主表
        const updateFields = {}
        for (const key of DETECTION_FIELDS) {
          if (batch[key] !== undefined) updateFields[key] = batch[key]
        }
        updateFields.currentBatchId = batchId
        await Material.update(updateFields, { where: { id: materialId }, transaction: t })
        return batch
      })
    })
  }

  // --- 过期检查 ---
  _getExpiryRules() { return EXPIRY_RULES }

  getExpiringBatches(days = 30) {
    const now = new Date()
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    // 返回未来 N 天内将过期的批次（遍历所有在用批次）
    return this._checkAllBatches(threshold)
  }

  async checkExpired() {
    const batches = await MaterialBatch.findAll({ where: { status: '在用' } })
    const now = new Date()
    for (const batch of batches) {
      const rule = EXPIRY_RULES[batch.materialType]
      if (!rule) continue
      const dateField = batch[rule.field]
      if (!dateField) continue
      const date = new Date(dateField)
      let expired = false
      if (rule.months) {
        date.setMonth(date.getMonth() + rule.months)
        expired = now > date
      }
      if (rule.days) {
        date.setDate(date.getDate() + rule.days)
        expired = now > date && !rule.warningOnly  // 骨料仅警告不标记过期
      }
      if (expired) {
        await MaterialBatch.update({ status: '过期' }, { where: { id: batch.id } })
      }
    }
  }

  async _checkAllBatches(threshold) {
    const batches = await MaterialBatch.findAll({ where: { status: '在用' } })
    return batches.filter(batch => {
      const rule = EXPIRY_RULES[batch.materialType]
      if (!rule) return false
      const dateField = batch[rule.field]
      if (!dateField) return false
      const date = new Date(dateField)
      if (rule.months) date.setMonth(date.getMonth() + rule.months)
      if (rule.days) date.setDate(date.getDate() + rule.days)
      return date <= threshold
    })
  }
}

module.exports = new MaterialBatchService()

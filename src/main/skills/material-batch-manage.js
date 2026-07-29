/**
 * 材料批次管理 Skill
 * 让 Agent 能够查询/新增/修改/删除材料批次，以及切换材料的当前批次。
 *
 * action 类型：
 * - list：按 materialId 查询该材料的所有批次概要（不含检测值，省 token）
 * - get：按 batchId 查询单个批次详情（含完整检测值，供配合比设计前查）
 * - create：新增批次，需 materialId + data.batchNumber
 * - update：修改批次，需 batchId + data
 * - delete：删除批次，需 batchId（在用批次不可删，由 service 抛错）
 * - setCurrent：设为当前批次，需 materialId + batchId（会同步批次检测值到材料主表）
 *
 * 检测值字段参考 src/main/db/models/MaterialBatch.js，
 * 与前端 MaterialBatchPanel 的 getTestFields 保持一致。
 */

// list 返回的概要字段（只保留识别/库存字段，不含检测值；检测值用 get 查）
const SUMMARY_FIELDS = [
  'id', 'batchNumber', 'supplier', 'quantity', 'status',
  'productionDate', 'receiptDate', 'expiryDate', 'testDate'
]

function summarize(batch) {
  const out = {}
  for (const k of SUMMARY_FIELDS) {
    out[k] = batch[k] !== undefined ? batch[k] : null
  }
  return out
}

module.exports = {
  name: 'manage_material_batches',
  description: '管理材料批次（每个材料可有多个批次，记录不同进货批次的供应商、数量、检测值等）。支持 list(查批次概要)/get(查批次检测值详情)/create(新增)/update(修改)/delete(删除)/setCurrent(设为当前批次) 六种操作。' +
    '\n\n批次字段：batchNumber(批次号,必填), supplier(供应商), quantity(数量吨), productionDate(生产日期), receiptDate(进场日期), expiryDate(有效期至), testDate(检测日期), testReportNo(检测报告编号), status(状态:在用/备用/正常/过期), price(单价), notes(备注), 以及各类检测值字段(密度density/细度fineness/强度compressiveStrength28d/影响系数influenceFactor_10~50/筛余sieve_xx等, 与材料类型匹配)。' +
    '\n\n说明：list 只返回批次概要(不含检测值)；需要检测值做配合比设计时用 get 查单个批次详情。setCurrent 会把该批次检测值同步到材料主表，后续配合比设计默认用主表值即为该批次值。',
  version: '1.0.0',
  category: 'manage',

  parameters: {
    action: {
      type: 'string',
      description: '操作类型：list=查材料批次概要, get=查批次检测值详情, create=新增批次, update=修改批次, delete=删除批次, setCurrent=设为当前批次',
      required: true,
      enum: ['list', 'get', 'create', 'update', 'delete', 'setCurrent']
    },
    materialId: {
      type: 'number',
      description: '材料ID。list/create/setCurrent 必填；可通过 list_available_materials 查询获取。',
      required: false
    },
    batchId: {
      type: 'number',
      description: '批次ID。get/update/delete 必填；可通过 list 查询获取。',
      required: false
    },
    data: {
      type: 'object',
      description: '批次数据对象。create 时必填(至少含 batchNumber)；update 时只传需要改的字段。可含：batchNumber, supplier, quantity, productionDate, receiptDate, expiryDate, testDate, testReportNo, status, price, notes, 及检测值字段。create 不需要传 materialId/materialType(由 materialId 自动填)。',
      required: false
    }
  },

  errors: {
    INVALID_PARAMS: {
      code: 'INVALID_PARAMS',
      message: '参数不合法',
      hint: '请检查：list/create/setCurrent 需 materialId；get/update/delete 需 batchId；create 需 data.batchNumber',
      recovery: 'retry'
    },
    BATCH_NOT_FOUND: {
      code: 'BATCH_NOT_FOUND',
      message: '批次不存在',
      hint: '请通过 list 查询正确的 batchId',
      recovery: 'retry'
    },
    MATERIAL_NOT_FOUND: {
      code: 'MATERIAL_NOT_FOUND',
      message: '材料不存在',
      hint: '请通过 list_available_materials 查询正确的 materialId',
      recovery: 'retry'
    },
    OPERATION_FAILED: {
      code: 'OPERATION_FAILED',
      message: '批次操作失败',
      hint: '请稍后重试，或检查数据格式/是否违反约束(如删除在用批次)',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { materialBatchService, materialService, logger } = context
    const { action, materialId, batchId, data } = args

    logger.info(`批次管理操作: action=${action}, materialId=${materialId || '无'}, batchId=${batchId || '无'}`)

    // 1. 参数校验
    if (['list', 'create', 'setCurrent'].includes(action) && !materialId) {
      return { success: false, error: this.errors.INVALID_PARAMS, details: { reason: `${action} 操作必须提供 materialId` } }
    }
    if (['get', 'update', 'delete'].includes(action) && !batchId) {
      return { success: false, error: this.errors.INVALID_PARAMS, details: { reason: `${action} 操作必须提供 batchId` } }
    }
    if (action === 'create' && (!data || !data.batchNumber)) {
      return { success: false, error: this.errors.INVALID_PARAMS, details: { reason: 'create 操作必须提供 data.batchNumber' } }
    }
    if (action === 'update' && (!data || Object.keys(data).length === 0)) {
      return { success: false, error: this.errors.INVALID_PARAMS, details: { reason: 'update 操作的 data 不能为空' } }
    }

    try {
      // list: 查材料批次概要
      if (action === 'list') {
        const material = await materialService.getMaterialById(materialId)
        if (!material) {
          return { success: false, error: this.errors.MATERIAL_NOT_FOUND, details: { materialId } }
        }
        const batches = await materialBatchService.getBatchesByMaterialId(materialId)
        const summaries = batches.map(summarize)
        logger.info(`查询批次列表: materialId=${materialId}, count=${summaries.length}`)
        return {
          success: true,
          action: 'list',
          materialId,
          materialName: material.name,
          count: summaries.length,
          batches: summaries,
          message: `材料「${material.name}」共 ${summaries.length} 个批次`
        }
      }

      // get: 查批次检测值详情
      if (action === 'get') {
        const batch = await materialBatchService.getBatchById(batchId)
        if (!batch) {
          return { success: false, error: this.errors.BATCH_NOT_FOUND, details: { batchId } }
        }
        logger.info(`查询批次详情: batchId=${batchId}`)
        return {
          success: true,
          action: 'get',
          batch,
          message: `批次「${batch.batchNumber}」详情`
        }
      }

      // create: 新增批次
      if (action === 'create') {
        const material = await materialService.getMaterialById(materialId)
        if (!material) {
          return { success: false, error: this.errors.MATERIAL_NOT_FOUND, details: { materialId } }
        }
        const batchData = { ...data }
        delete batchData.id
        batchData.materialId = materialId
        batchData.materialType = batchData.materialType || material.type
        const batch = await materialBatchService.createBatch(batchData)
        const created = batch && typeof batch.toJSON === 'function' ? batch.toJSON() : batch
        logger.info(`新增批次成功: id=${created?.id}, batchNumber=${created?.batchNumber}`)
        return {
          success: true,
          action: 'create',
          batch: created,
          message: `已新增批次：${created?.batchNumber}（ID: ${created?.id}）`
        }
      }

      // update: 修改批次
      if (action === 'update') {
        const existing = await materialBatchService.getBatchById(batchId)
        if (!existing) {
          return { success: false, error: this.errors.BATCH_NOT_FOUND, details: { batchId } }
        }
        const updateData = { ...data }
        delete updateData.id
        delete updateData.materialId    // 不允许改归属
        delete updateData.materialType  // 不允许改类型
        const batch = await materialBatchService.updateBatch(batchId, updateData)
        const updated = batch && typeof batch.toJSON === 'function' ? batch.toJSON() : batch
        logger.info(`修改批次成功: id=${batchId}`)
        return {
          success: true,
          action: 'update',
          batch: updated,
          message: `已修改批次：${updated?.batchNumber || batchId}（ID: ${batchId}）`
        }
      }

      // delete: 删除批次
      if (action === 'delete') {
        const existing = await materialBatchService.getBatchById(batchId)
        if (!existing) {
          return { success: false, error: this.errors.BATCH_NOT_FOUND, details: { batchId } }
        }
        const batchNumber = existing.batchNumber
        await materialBatchService.deleteBatch(batchId)
        logger.info(`删除批次成功: id=${batchId}, batchNumber=${batchNumber}`)
        return {
          success: true,
          action: 'delete',
          deletedId: batchId,
          deletedBatchNumber: batchNumber,
          message: `已删除批次：${batchNumber}（ID: ${batchId}）`
        }
      }

      // setCurrent: 设为当前批次
      if (action === 'setCurrent') {
        const batch = await materialBatchService.getBatchById(batchId)
        if (!batch) {
          return { success: false, error: this.errors.BATCH_NOT_FOUND, details: { batchId } }
        }
        if (batch.materialId !== materialId) {
          return { success: false, error: this.errors.INVALID_PARAMS, details: { reason: `批次 ${batchId} 不属于材料 ${materialId}` } }
        }
        await materialBatchService.setCurrentBatch(materialId, batchId)
        logger.info(`设为当前批次: materialId=${materialId}, batchId=${batchId}`)
        return {
          success: true,
          action: 'setCurrent',
          materialId,
          batchId,
          message: `已将批次「${batch.batchNumber}」设为材料(ID:${materialId})的当前批次，检测值已同步到材料主表`
        }
      }

      // 未知 action 兜底
      return { success: false, error: this.errors.INVALID_PARAMS, details: { reason: `未知操作类型: ${action}` } }
    } catch (error) {
      logger.error(`批次管理失败 (action=${action}):`, error)
      return {
        success: false,
        error: this.errors.OPERATION_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['materialBatchService', 'materialService']
}

const { Op } = require('sequelize')
const { SalesQuoteHistory } = require('../db/database')

/**
 * v0.6.0 Task 1.12：保存报价（支持幂等）
 *
 * 幂等键：data.requestId（tool_call_id）。传入时先查同一 requestId 是否已保存过报价：
 * - 命中 → 直接返回旧记录，不再重复写（断点续跑重跑同一 tool call 时防重复报价）
 * - 未命中 / 未传 requestId → 正常创建
 *
 * 兼容：旧调用方不传 requestId，走原逻辑（每次都创建新记录）。
 */
async function saveQuote(data) {
  // 幂等查重：同 requestId 已保存 → 返回旧记录
  if (data.requestId) {
    const existing = await SalesQuoteHistory.findOne({ where: { requestId: data.requestId } })
    if (existing) return existing.toJSON()
  }

  return (await SalesQuoteHistory.create({
    strengthGrade: data.strengthGrade,
    concreteType: data.concreteType,
    slump: data.slump,
    basicMixId: data.basicMixId || null,
    basicMixName: data.basicMixName || '',
    mixDesignId: data.mixDesignId || null,
    pricingParams: data.pricingParams || {},
    materialPriceOverrides: data.materialPriceOverrides || {},
    materialDetails: data.materialDetails || [],
    selectedPumpingItems: data.selectedPumpingItems || [],
    resultSnapshot: data.resultSnapshot || {},
    remarks: data.remarks || '',
    quoteMode: data.quoteMode || null,
    polishStrategy: data.polishStrategy || null,
    polishedUnitPrices: data.polishedUnitPrices || null,
    equipmentPurchaseCost: data.equipmentPurchaseCost ?? null,
    equipmentAmortizeVolume: data.equipmentAmortizeVolume ?? null,
    equipmentUnitAmortization: data.equipmentUnitAmortization ?? null,
    requestId: data.requestId || null
  })).toJSON()
}

async function listHistory(filters = {}) {
  const where = {}
  if (filters.strengthGrade) where.strengthGrade = filters.strengthGrade
  if (filters.concreteType) where.concreteType = filters.concreteType
  if (filters.startDate) where.createdAt = { [Op.gte]: new Date(filters.startDate) }
  if (filters.endDate) {
    where.createdAt = { ...where.createdAt, [Op.lte]: new Date(filters.endDate) }
  }
  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20))
  const offset = (page - 1) * pageSize
  const { count, rows } = await SalesQuoteHistory.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    offset,
    limit: pageSize
  })
  return {
    total: count,
    page,
    pageSize,
    data: rows.map(row => row.toJSON())
  }
}

async function deleteQuote(id) {
  const item = await SalesQuoteHistory.findByPk(id)
  if (!item) throw new Error('报价历史不存在')
  await item.destroy()
}

module.exports = { saveQuote, listHistory, deleteQuote }

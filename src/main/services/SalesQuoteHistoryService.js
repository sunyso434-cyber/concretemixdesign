const { Op } = require('sequelize')
const { SalesQuoteHistory } = require('../db/database')

async function saveQuote(data) {
  return (await SalesQuoteHistory.create({
    strengthGrade: data.strengthGrade,
    concreteType: data.concreteType,
    slump: data.slump,
    basicMixId: data.basicMixId || null,
    basicMixName: data.basicMixName || '',
    pricingParams: data.pricingParams || {},
    materialPriceOverrides: data.materialPriceOverrides || {},
    materialDetails: data.materialDetails || [],
    selectedPumpingItems: data.selectedPumpingItems || [],
    resultSnapshot: data.resultSnapshot || {},
    remarks: data.remarks || ''
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

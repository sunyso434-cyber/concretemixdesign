const { SalesQuoteRule } = require('../db/database')

const DEFAULT_RULES = [
  {
    concreteType: '普通',
    keywords: ['普通', '常规'],
    suggestedSlump: 180,
    suggestedManufacturingFee: 18,
    suggestedTechnicalServiceFee: 0,
    technicalServiceFeeRange: [0, 0],
    suggestedProfitRate: 0.12,
    suggestedTransportDistance: 20,
    suggestedTransportUnitPrice: 2.5,
    vatRate: 0.13,
    quoteRangeDelta: 5
  },
  {
    concreteType: '抗渗',
    keywords: ['抗渗', '防水', 'P6', 'P8', 'P10'],
    suggestedSlump: 180,
    suggestedManufacturingFee: 18,
    suggestedTechnicalServiceFee: 20,
    technicalServiceFeeRange: [15, 25],
    suggestedProfitRate: 0.12,
    suggestedTransportDistance: 20,
    suggestedTransportUnitPrice: 2.5,
    vatRate: 0.13,
    quoteRangeDelta: 5
  },
  {
    concreteType: '早强',
    keywords: ['早强', '快硬', '赶工'],
    suggestedSlump: 180,
    suggestedManufacturingFee: 18,
    suggestedTechnicalServiceFee: 25,
    technicalServiceFeeRange: [20, 35],
    suggestedProfitRate: 0.12,
    suggestedTransportDistance: 20,
    suggestedTransportUnitPrice: 2.5,
    vatRate: 0.13,
    quoteRangeDelta: 5
  }
]

async function initDefaultRules() {
  for (const rule of DEFAULT_RULES) {
    const existing = await SalesQuoteRule.findOne({ where: { concreteType: rule.concreteType } })
    if (!existing) {
      await SalesQuoteRule.create({ ...rule, enabled: true })
    }
  }
}

async function listRules() {
  return (await SalesQuoteRule.findAll({ order: [['concreteType', 'ASC']] })).map(row => row.toJSON())
}

async function findRuleByType(concreteType) {
  return await SalesQuoteRule.findOne({ where: { concreteType, enabled: true } })
}

async function matchRuleByText(text) {
  const rules = await listRules()
  return rules.find(rule => (rule.keywords || []).some(keyword => String(text || '').includes(keyword))) || null
}

async function createRule(data) {
  const concreteType = String(data.concreteType || '').trim()
  if (!concreteType) throw new Error('销售报价规则类型不能为空')
  const existing = await SalesQuoteRule.findOne({ where: { concreteType } })
  if (existing) throw new Error('销售报价规则类型已存在')
  return await SalesQuoteRule.create({
    ...data,
    concreteType,
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    technicalServiceFeeRange: Array.isArray(data.technicalServiceFeeRange) ? data.technicalServiceFeeRange : [0, 0],
    enabled: data.enabled !== false
  })
}

async function updateRule(id, data) {
  const row = await SalesQuoteRule.findByPk(id)
  if (!row) throw new Error('销售报价规则不存在')
  await row.update(data)
  return row
}

module.exports = { DEFAULT_RULES, initDefaultRules, listRules, findRuleByType, matchRuleByText, createRule, updateRule }

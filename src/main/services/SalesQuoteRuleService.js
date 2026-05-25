const { SalesQuoteRule } = require('../db/database')

const DEFAULT_RULES = [
  {
    concreteType: '普通',
    keywords: ['普通', '常规'],
    salesExplanation: '普通混凝土用于常规结构部位，报价主要由材料成本、制造费、运输泵送和税费构成。',
    costDrivers: ['材料单价', '胶材用量', '砂石价格'],
    productionDifficulties: ['保持坍落度稳定', '控制强度富余'],
    suggestedSlump: 180,
    suggestedManufacturingFee: 18,
    suggestedTechnicalServiceFee: 0,
    technicalServiceFeeRange: [0, 0],
    suggestedProfitRate: 0.12,
    suggestedTransportFee: 0,
    suggestedPumpingFee: 0,
    vatRate: 0.13,
    quoteRangeDelta: 5
  },
  {
    concreteType: '抗渗',
    keywords: ['抗渗', '防水', 'P6', 'P8', 'P10'],
    salesExplanation: '抗渗混凝土不是简单多加水泥，而是通过控制水胶比、优化胶材和外加剂，让混凝土更不容易渗水。',
    costDrivers: ['水胶比控制更严', '外加剂适配要求更高', '试配验证成本增加'],
    productionDifficulties: ['坍落度保持', '抗渗等级验证', '施工窗口控制'],
    suggestedSlump: 180,
    suggestedManufacturingFee: 18,
    suggestedTechnicalServiceFee: 20,
    technicalServiceFeeRange: [15, 25],
    suggestedProfitRate: 0.12,
    suggestedTransportFee: 0,
    suggestedPumpingFee: 0,
    vatRate: 0.13,
    quoteRangeDelta: 5
  },
  {
    concreteType: '早强',
    keywords: ['早强', '快硬', '赶工'],
    salesExplanation: '早强混凝土重点保证早期强度，需要更高的材料稳定性、外加剂适配和生产控制。',
    costDrivers: ['早强材料成本', '外加剂成本', '试配验证成本'],
    productionDifficulties: ['凝结时间控制', '早期强度波动', '施工节奏配合'],
    suggestedSlump: 180,
    suggestedManufacturingFee: 18,
    suggestedTechnicalServiceFee: 25,
    technicalServiceFeeRange: [20, 35],
    suggestedProfitRate: 0.12,
    suggestedTransportFee: 0,
    suggestedPumpingFee: 0,
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
    costDrivers: Array.isArray(data.costDrivers) ? data.costDrivers : [],
    productionDifficulties: Array.isArray(data.productionDifficulties) ? data.productionDifficulties : [],
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

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000
}

function normalizeRate(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return n > 1 ? n / 100 : n
}

function getMaterialPrice(material, overrides = {}) {
  const override = overrides[material.materialId] ?? overrides[String(material.materialId)]
  const price = override != null ? override : material.price
  if (price == null || price === '') {
    throw new Error(`${material.materialName || material.name || '材料'}没有单价，无法准确报价`)
  }
  const n = Number(price)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${material.materialName || material.name || '材料'}单价无效`)
  }
  return n
}

function calculate({ basicMix, pricing }) {
  if (!basicMix) {
    throw new Error('缺少基础配合比，无法计算报价')
  }
  if (!Array.isArray(basicMix.materials) || basicMix.materials.length === 0) {
    throw new Error('基础配合比没有材料用量，无法计算报价')
  }

  const priceOverrides = pricing.materialPriceOverrides || {}
  const marketAdjustmentRate = normalizeRate(pricing.marketAdjustmentRate)
  const profitRate = normalizeRate(pricing.profitRate)
  const vatRate = pricing.vatRate == null ? 0.13 : normalizeRate(pricing.vatRate)

  const materialDetails = basicMix.materials.map(material => {
    const usage = Number(material.usage)
    if (!Number.isFinite(usage) || usage < 0) {
      throw new Error(`${material.materialName || material.name || '材料'}用量无效`)
    }
    const unitPrice = getMaterialPrice(material, priceOverrides)
    const cost = roundMoney(usage * unitPrice / 1000)
    return {
      materialId: material.materialId,
      materialType: material.materialType,
      materialName: material.materialName,
      usage,
      unitPrice,
      cost
    }
  })

  const materialCostSubtotal = roundMoney(materialDetails.reduce((sum, item) => sum + item.cost, 0))
  const marketAdjustmentAmount = roundMoney(materialCostSubtotal * marketAdjustmentRate)
  const manufacturingFee = roundMoney(pricing.manufacturingFee)
  const technicalServiceFee = roundMoney(pricing.technicalServiceFee)
  const costBase = roundMoney(materialCostSubtotal + marketAdjustmentAmount + manufacturingFee + technicalServiceFee)
  const baseProfit = roundMoney(costBase * profitRate)
  const transportDistance = Number(pricing.transportDistance) || 20
  const transportUnitPrice = Number(pricing.transportUnitPrice) || 2.5
  const transportFee = roundMoney(transportDistance * transportUnitPrice)
  const preTaxPrice = roundMoney(costBase + baseProfit + transportFee)
  const vatAmount = roundMoney(preTaxPrice * vatRate)
  const suggestedDealPrice = roundMoney(preTaxPrice + vatAmount)
  const quoteRangeDelta = roundMoney(pricing.quoteRangeDelta)

  return {
    strengthGrade: basicMix.strengthGrade,
    concreteType: basicMix.concreteType,
    slump: basicMix.slump,
    materialDetails,
    materialCostSubtotal,
    marketAdjustmentRate,
    marketAdjustmentAmount,
    manufacturingFee,
    technicalServiceFee,
    costBase,
    profitRate,
    baseProfit,
    transportFee,
    transportDistance,
    transportUnitPrice,
    vatRate,
    preTaxPrice,
    vatAmount,
    internalFloorPrice: preTaxPrice,
    suggestedDealPrice,
    quoteRange: {
      min: roundMoney(suggestedDealPrice - quoteRangeDelta),
      max: roundMoney(suggestedDealPrice + quoteRangeDelta)
    },
    includes: {
      transport: transportFee > 0,
      vat: vatRate > 0
    }
  }
}

module.exports = { calculate, roundMoney, normalizeRate }
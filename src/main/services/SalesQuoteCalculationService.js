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

// ponytail: 公用 helper,reverse/forward/老 calculate 都用,避免每个函数重写
function calculateMaterialDetails(materials, priceOverrides = {}) {
  return materials.map(material => {
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
}

function sumMaterialCost(materialDetails) {
  return roundMoney(materialDetails.reduce((sum, item) => sum + item.cost, 0))
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
  const pumpingFee = roundMoney(pricing.pumpingFee)
  const preTaxPrice = roundMoney(costBase + baseProfit + transportFee + pumpingFee)
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
    pumpingFee,
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

// ─────────────────────────────────────────────────────────────────
// 反向套价：按目标市价反推（普通混凝土）
// 入参:materials/strengthGrade/concreteType/slumptargetUnitPrice必填
//      fixedFees 可选（缺省走默认费 率）
//      polishStrategy/profitSafeRange/vatRate/priceOverrides 可选
// 利润区间默认 [0.005, 0.03]，但用户可通过 agent 动态覆盖
// ─────────────────────────────────────────────────────────────────
const REVERSE_DEFAULT_FEES = Object.freeze({
  manufacturingFee: 18,
  laborFee: 10,
  technicalServiceFee: 0,
  salesFee: 0,
  financeFee: 0,
  transportDistance: 20,
  transportUnitPrice: 2.5,
  pumpingFee: 0,
  equipmentFee: 0
})
const PRICE_POLISH_BOUND = Object.freeze({ min: 0.7, max: 1.3 })
const FEE_POLISH_MULTIPLIER = 1.5

function resolveReverseFees(fixedFees = {}) {
  return {
    manufacturingFee: Number(fixedFees.manufacturingFee ?? REVERSE_DEFAULT_FEES.manufacturingFee) || 0,
    laborFee: Number(fixedFees.laborFee ?? REVERSE_DEFAULT_FEES.laborFee) || 0,
    technicalServiceFee: Number(fixedFees.technicalServiceFee ?? REVERSE_DEFAULT_FEES.technicalServiceFee) || 0,
    salesFee: Number(fixedFees.salesFee ?? REVERSE_DEFAULT_FEES.salesFee) || 0,
    financeFee: Number(fixedFees.financeFee ?? REVERSE_DEFAULT_FEES.financeFee) || 0,
    transportDistance: Number(fixedFees.transportDistance ?? REVERSE_DEFAULT_FEES.transportDistance) || 0,
    transportUnitPrice: Number(fixedFees.transportUnitPrice ?? REVERSE_DEFAULT_FEES.transportUnitPrice) || 0,
    pumpingFee: Number(fixedFees.pumpingFee ?? REVERSE_DEFAULT_FEES.pumpingFee) || 0,
    equipmentFee: Number(fixedFees.equipmentFee ?? REVERSE_DEFAULT_FEES.equipmentFee) || 0
  }
}

function calculateReverse({
  materials,
  targetUnitPrice,
  polishStrategy = 'material_price',
  profitSafeRange = [0.005, 0.03],
  vatRate = 0.13,
  fixedFees = {},
  priceOverrides = {},
  strengthGrade,
  concreteType,
  slump
} = {}) {
  if (!Array.isArray(materials) || materials.length === 0) {
    throw new Error('缺少材料用量，无法反向套价')
  }
  if (!Number.isFinite(Number(targetUnitPrice)) || Number(targetUnitPrice) <= 0) {
    throw new Error('缺少有效的目标市价')
  }

  const fees = resolveReverseFees(fixedFees)
  const transportFee = roundMoney(fees.transportDistance * fees.transportUnitPrice)
  const fixedFeeTotal = roundMoney(
    fees.manufacturingFee + fees.laborFee + fees.technicalServiceFee +
    fees.salesFee + fees.financeFee + transportFee + fees.pumpingFee + fees.equipmentFee
  )
  const v = normalizeRate(vatRate)

  // 步骤 1-2: 算材料明细、总成本(不含税)、目标不含税价
  let materialDetails = calculateMaterialDetails(materials, priceOverrides)
  let materialCostSubtotal = sumMaterialCost(materialDetails)
  let totalCost = roundMoney(materialCostSubtotal + fixedFeeTotal)
  const targetPreTax = roundMoney(Number(targetUnitPrice) / (1 + v))

  // 步骤 3-4: 实际利润率
  const initialProfit = roundMoney(targetPreTax - totalCost)
  const initialProfitRate = totalCost > 0 ? roundMoney(initialProfit / totalCost) : 0

  const [profitMin, profitMax] = profitSafeRange
  const inRange = initialProfitRate >= profitMin && initialProfitRate <= profitMax

  // 步骤 5-6: 包装策略
  let polished = false
  let polishedUnitPrices = []
  let warning = null
  let effectiveManufacturingFee = fees.manufacturingFee
  let effectiveLaborFee = fees.laborFee

  if (!inRange) {
    if (polishStrategy === 'none') {
      warning = `实际利润率 ${(initialProfitRate * 100).toFixed(2)}% 偏离安全区间 [${(profitMin * 100).toFixed(1)}%, ${(profitMax * 100).toFixed(1)}%]`
    } else if (polishStrategy === 'material_price') {
      // 按材料价值占比分摊调整单价
      // 包装目标:让实际利润率落在区间边界(profitMax 或 profitMin)
      const targetRate = initialProfitRate > profitMax ? profitMax : profitMin
      const targetTotalCost = roundMoney(targetPreTax / (1 + targetRate))
      const deltaCost = roundMoney(targetTotalCost - totalCost)
      const targetMaterialCost = roundMoney(materialCostSubtotal + deltaCost)

      // 算每种材料价值占比 + 建议新单价
      const newUnitPrices = materialDetails.map(item => {
        const share = materialCostSubtotal > 0 ? item.cost / materialCostSubtotal : 0
        const newCost = roundMoney(item.cost + share * deltaCost)
        const newUnitPrice = item.usage > 0 ? roundMoney(newCost * 1000 / item.usage) : item.unitPrice
        return { item, newUnitPrice, originalPrice: item.unitPrice, share }
      })

      // 边界钳制:原单价 × [0.7, 1.3]
      materialDetails = newUnitPrices.map(({ item, newUnitPrice, originalPrice }) => {
        const lower = roundMoney(originalPrice * PRICE_POLISH_BOUND.min)
        const upper = roundMoney(originalPrice * PRICE_POLISH_BOUND.max)
        let finalPrice = newUnitPrice
        let clamped = false
        if (finalPrice < lower) {
          finalPrice = lower
          clamped = true
        } else if (finalPrice > upper) {
          finalPrice = upper
          clamped = true
        }
        const finalCost = roundMoney(item.usage * finalPrice / 1000)
        if (clamped) {
          warning = warning || '部分材料单价包装超界已按边界钳制'
          polishedUnitPrices.push({
            materialId: item.materialId,
            materialName: item.materialName,
            originalPrice,
            polishedPrice: finalPrice,
            clamped: true
          })
        } else if (finalPrice !== originalPrice) {
          polishedUnitPrices.push({
            materialId: item.materialId,
            materialName: item.materialName,
            originalPrice,
            polishedPrice: finalPrice,
            clamped: false
          })
        }
        return {
          materialId: item.materialId,
          materialType: item.materialType,
          materialName: item.materialName,
          usage: item.usage,
          unitPrice: finalPrice,
          cost: finalCost
        }
      })

      materialCostSubtotal = sumMaterialCost(materialDetails)
      totalCost = roundMoney(materialCostSubtotal + fixedFeeTotal)
      polished = true
    } else if (polishStrategy === 'manufacturing') {
      // 调整制造费(不超 1.5×)
      const targetManufacturing = roundMoney(targetPreTax - (materialCostSubtotal + fees.laborFee + fees.technicalServiceFee + transportFee + fees.equipmentFee))
      const limit = roundMoney(fees.manufacturingFee * FEE_POLISH_MULTIPLIER)
      effectiveManufacturingFee = targetManufacturing
      if (targetManufacturing > limit) {
        effectiveManufacturingFee = limit
        warning = `制造费调整超过 ${FEE_POLISH_MULTIPLIER}× 上限，差额未完全吸收`
      } else if (targetManufacturing < 0) {
        effectiveManufacturingFee = 0
        warning = '制造费调整至 0 后仍有缺口，差额未完全吸收'
      }
      totalCost = roundMoney(materialCostSubtotal + effectiveManufacturingFee + fees.laborFee + fees.technicalServiceFee + transportFee + fees.equipmentFee)
      polished = true
    } else if (polishStrategy === 'labor') {
      // 调整人工费(不超 1.5×)
      const targetLabor = roundMoney(targetPreTax - (materialCostSubtotal + fees.manufacturingFee + fees.technicalServiceFee + transportFee + fees.equipmentFee))
      const limit = roundMoney(fees.laborFee * FEE_POLISH_MULTIPLIER)
      effectiveLaborFee = targetLabor
      if (targetLabor > limit) {
        effectiveLaborFee = limit
        warning = `人工费调整超过 ${FEE_POLISH_MULTIPLIER}× 上限，差额未完全吸收`
      } else if (targetLabor < 0) {
        effectiveLaborFee = 0
        warning = '人工费调整至 0 后仍有缺口，差额未完全吸收'
      }
      totalCost = roundMoney(materialCostSubtotal + fees.manufacturingFee + effectiveLaborFee + fees.technicalServiceFee + transportFee + fees.equipmentFee)
      polished = true
    } else {
      warning = `未知包装策略: ${polishStrategy}`
    }
  }

  // 步骤 7: 最终利润 + 含税总价
  const finalPreTax = roundMoney(targetPreTax)
  const finalProfit = roundMoney(finalPreTax - totalCost)
  const finalProfitRate = totalCost > 0 ? roundMoney(finalProfit / totalCost) : 0
  const vatAmount = roundMoney(finalPreTax * v)
  const finalPrice = roundMoney(finalPreTax + vatAmount)

  return {
    mode: 'reverse',
    strengthGrade,
    concreteType,
    slump,
    materialDetails,
    materialCostSubtotal,
    manufacturingFee: effectiveManufacturingFee,
    laborFee: effectiveLaborFee,
    technicalServiceFee: fees.technicalServiceFee,
    salesFee: fees.salesFee,
    financeFee: fees.financeFee,
    transportDistance: fees.transportDistance,
    transportUnitPrice: fees.transportUnitPrice,
    transportFee,
    pumpingFee: fees.pumpingFee,
    equipmentFee: fees.equipmentFee,
    totalCost,
    targetUnitPrice: Number(targetUnitPrice),
    targetPreTax,
    vatRate: v,
    vatAmount,
    suggestedDealPrice: finalPrice,
    actualProfit: finalProfit,
    actualProfitRate: finalProfitRate,
    profitSafeRange: { min: profitMin, max: profitMax },
    polished,
    polishStrategy,
    polishedUnitPrices,
    warning
  }
}

// ─────────────────────────────────────────────────────────────────
// 正向议价测算:按成本+利润出三档价(特殊混凝土)
// 入参:materials 必填, fixedFees/equipmentAmortization/profitRange/vatRate 可选
// 设备摊销 = purchaseCost ÷ totalAmortizeVolume
// 利润区间默认 [0.10, 0.40],三档价按 [min, mid, max] 算
// ─────────────────────────────────────────────────────────────────
function resolveForwardFees(fixedFees = {}) {
  return resolveReverseFees(fixedFees)
}

function calculateForward({
  materials,
  fixedFees = {},
  equipmentAmortization = null,
  profitRange = [0.10, 0.40],
  vatRate = 0.13,
  priceOverrides = {},
  strengthGrade,
  concreteType,
  slump
} = {}) {
  if (!Array.isArray(materials) || materials.length === 0) {
    throw new Error('缺少材料用量，无法正向测算')
  }
  const fees = resolveForwardFees(fixedFees)
  const transportFee = roundMoney(fees.transportDistance * fees.transportUnitPrice)
  const v = normalizeRate(vatRate)

  // 设备摊销 = 采购价 ÷ 预计总方量
  let equipmentUnitAmortization = 0
  let equipmentTotalAmortization = 0
  if (equipmentAmortization) {
    const purchaseCost = Number(equipmentAmortization.purchaseCost) || 0
    const totalAmortizeVolume = Number(equipmentAmortization.totalAmortizeVolume) || 0
    const currentOrderVolume = Number(equipmentAmortization.currentOrderVolume) || 0
    if (totalAmortizeVolume <= 0) {
      throw new Error('设备摊销预计总方量必须大于 0')
    }
    equipmentUnitAmortization = roundMoney(purchaseCost / totalAmortizeVolume)
    if (currentOrderVolume > 0) {
      equipmentTotalAmortization = roundMoney(equipmentUnitAmortization * currentOrderVolume)
    }
  }

  const materialDetails = calculateMaterialDetails(materials, priceOverrides)
  const materialCostSubtotal = sumMaterialCost(materialDetails)
  const totalCost = roundMoney(
    materialCostSubtotal + fees.manufacturingFee + fees.laborFee +
    fees.technicalServiceFee + fees.salesFee + fees.financeFee +
    transportFee + fees.pumpingFee + equipmentUnitAmortization
  )

  // 三档价:min/mid/max,中位用算术平均
  const profitMin = Number(profitRange[0] ?? 0.10)
  const profitMax = Number(profitRange[1] ?? 0.40)
  const profitMid = roundMoney((profitMin + profitMax) / 2)
  const minPrice = roundMoney(totalCost * (1 + profitMin) * (1 + v))
  const suggestedPrice = roundMoney(totalCost * (1 + profitMid) * (1 + v))
  const maxPrice = roundMoney(totalCost * (1 + profitMax) * (1 + v))
  const vatAmount = roundMoney(suggestedPrice / (1 + v) * v)

  return {
    mode: 'forward',
    strengthGrade,
    concreteType,
    slump,
    materialDetails,
    materialCostSubtotal,
    manufacturingFee: fees.manufacturingFee,
    laborFee: fees.laborFee,
    technicalServiceFee: fees.technicalServiceFee,
    salesFee: fees.salesFee,
    financeFee: fees.financeFee,
    transportDistance: fees.transportDistance,
    transportUnitPrice: fees.transportUnitPrice,
    transportFee,
    pumpingFee: fees.pumpingFee,
    equipmentAmortization: equipmentAmortization || null,
    equipmentUnitAmortization,
    equipmentTotalAmortization,
    totalCost,
    profitRange: { min: profitMin, mid: profitMid, max: profitMax },
    vatRate: v,
    vatAmount,
    minPrice,
    suggestedPrice,
    maxPrice
  }
}

module.exports = { calculate, calculateReverse, calculateForward, roundMoney, normalizeRate }
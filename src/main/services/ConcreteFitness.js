const XGBoostPredictionService = require('./XGBoostPredictionService')
const MixDesignService_Database = require('./MixDesignService/MixDesignService_Database')

/**
 * 计算减水剂偏差罚分（独立函数，可单独测试）
 * 偏差 > 0.5 个百分点时：
 *   materialCost = spPrice/1000 × (deviation × binderTotal / 100)
 *   riskCost     = 10 × deviation
 *   总罚分 = materialCost + riskCost
 * @param {number} spPrice - 减水剂单价（元/吨）
 * @param {number} spDeviation - 偏差（百分点）
 * @param {number} binderTotal - 胶凝材料总量（kg/m³）
 * @returns {{ penalty: number, materialCost: number, riskCost: number }}
 */
function calcSpPenalty(spPrice, spDeviation, binderTotal) {
  if (spDeviation <= 0.5) {
    return { penalty: 0, materialCost: 0, riskCost: 0 }
  }
  const materialCost = (spPrice / 1000) * (spDeviation * binderTotal / 100)
  const riskCost = 10 * spDeviation
  const penalty = materialCost + riskCost
  return { penalty, materialCost, riskCost }
}

/**
 * 混凝土适应度函数
 * 评估基因方案（配比参数 + 材料选择）的适应度
 * 适应度 = 真实成本 + 强度罚分 + 减水剂偏差罚分 + 掺合料总掺超限罚分
 * 适应度越低越好
 */
class ConcreteFitness {
  /**
   * @param {Object} snapshot - 材料快照（含 byId, candidatePools）
   * @param {number} targetStrength - 目标强度（MPa）
   * @param {number} slump - 坍落度（mm）
   * @param {Object} options - 可选参数 { strengthGrade, calculationMethod, targetDensity, airContent }
   */
  constructor(snapshot, targetStrength, slump, options = {}) {
    this.snapshot = snapshot
    this.targetStrength = targetStrength
    this.slump = slump
    this.options = options
  }

  /**
   * 评估基因方案的适应度
   * @param {Object} genes - 基因方案
   * @param {Object} genes.cement - 水泥材料
   * @param {Object|Array} genes.sand - 细骨料（单材料或数组）
   * @param {Object|Array} genes.stone - 粗骨料（单材料或数组）
   * @param {Object} genes.sp - 减水剂材料
   * @param {Object} genes.water - 水材料
   * @param {Object} [genes.flyAsh] - 粉煤灰材料
   * @param {Object} [genes.slag] - 矿渣粉材料
   * @param {Object} [genes.lithiumSlag] - 锂渣材料
   * @param {Object} [genes.compositePowder] - 复合粉材料
   * @param {number} genes.wb - 水胶比
   * @param {number} [genes.flyAshDosage=0] - 粉煤灰掺量（%）
   * @param {number} [genes.slagDosage=0] - 矿渣粉掺量（%）
   * @param {number} [genes.lithiumSlagDosage=0] - 锂渣掺量（%）
   * @param {number} [genes.compositePowderDosage=0] - 复合粉掺量（%）
   * @param {number} genes.sandRatio - 砂率（%）
   * @param {number} genes.spDosage - 减水剂掺量（%）
   * @param {number} [genes.sand2Proportion=0] - 第二种砂比例（%）
   * @param {number} [genes.stone2Proportion=0] - 第二种石比例（%）
   * @returns {Promise<Object>} 评估结果
   */
  async evaluate(genes) {
    // 1. 将基因映射为 calculateMixDesign 所需的 materials 对象
    const mappedMaterials = {}
    mappedMaterials.cement = genes.cement
    mappedMaterials.sand = genes.sand
    mappedMaterials.stone = genes.stone
    mappedMaterials.superplasticizer = genes.sp
    if (genes.flyAsh) mappedMaterials.flyAsh = genes.flyAsh
    if (genes.slag) mappedMaterials.slag = genes.slag
    if (genes.lithiumSlag) mappedMaterials.lithiumSlag = genes.lithiumSlag
    if (genes.compositePowder) mappedMaterials.compositePowder = genes.compositePowder

    // 2. 调用计算配合比获取各材料用量
    const strengthGrade = this.options.strengthGrade || this._getStrengthGrade(this.targetStrength)
    const mixResult = await MixDesignService_Database.calculateMixDesign({
      strength: strengthGrade,
      slump: this.slump,
      materials: mappedMaterials,
      calculationMethod: this.options.calculationMethod || 'mass',
      targetDensity: this.options.targetDensity || 2400,
      airContent: this.options.airContent,
      flyAshDosage: genes.flyAshDosage ?? 0,
      slagDosage: genes.slagDosage ?? 0,
      lithiumSlagDosage: genes.lithiumSlagDosage ?? 0,
      compositePowderDosage: genes.compositePowderDosage ?? 0,
      sandRatio: genes.sandRatio,
      waterRatio: genes.wb,
      _overrideBaseWaterAmount: genes._overrideBaseWaterAmount ?? this.options.overrideBaseWaterAmount,
      _overrideSpDosage: genes.spDosage,
      _overrideWaterRatio: genes.wb
    })

    const amounts = mixResult.materials || mixResult.materialAmounts || {}

    // 3. 处理骨料分拆（sand2Proportion / stone2Proportion）
    const sand1 = Array.isArray(genes.sand) ? genes.sand[0] : genes.sand
    const sand2 = Array.isArray(genes.sand) && genes.sand.length > 1 ? genes.sand[1] : null
    const stone1 = Array.isArray(genes.stone) ? genes.stone[0] : genes.stone
    const stone2 = Array.isArray(genes.stone) && genes.stone.length > 1 ? genes.stone[1] : null

    const sand2Proportion = genes.sand2Proportion ?? 0
    const stone2Proportion = genes.stone2Proportion ?? 0

    const sandTotalAmount = amounts.sand || 0
    const stoneTotalAmount = amounts.stone || 0

    const sand1Mass = sandTotalAmount * (1 - sand2Proportion)
    const sand2Mass = sandTotalAmount * sand2Proportion
    const stone1Mass = stoneTotalAmount * (1 - stone2Proportion)
    const stone2Mass = stoneTotalAmount * stone2Proportion

    // 4. 计算真实材料成本（元/m³）
    // 单价单位：元/吨，用量单位：kg/m³ → 元/kg = 元/吨 ÷ 1000
    const getPrice = (mat) => (mat && mat.price) || 0

    let realCost = 0
    realCost += (amounts.cement || 0) * getPrice(genes.cement) / 1000
    realCost += (amounts.water || 0) * getPrice(genes.water) / 1000
    realCost += (amounts.flyAsh || 0) * getPrice(genes.flyAsh) / 1000
    realCost += (amounts.slag || 0) * getPrice(genes.slag) / 1000
    realCost += (amounts.lithiumSlag || 0) * getPrice(genes.lithiumSlag) / 1000
    realCost += (amounts.compositePowder || 0) * getPrice(genes.compositePowder) / 1000
    realCost += sand1Mass * getPrice(sand1) / 1000
    realCost += sand2Mass * getPrice(sand2) / 1000
    realCost += stone1Mass * getPrice(stone1) / 1000
    realCost += stone2Mass * getPrice(stone2) / 1000
    realCost += (amounts.superplasticizer || 0) * getPrice(genes.sp) / 1000

    // 5. XGBoost 预测：强度28d、容重、减水剂掺量
    const xgbParams = {
      cementAmount: amounts.cement || 0,
      waterBinderRatio: genes.wb,
      cementId: genes.cement.id,
      sandId: sand1.id,
      stoneId: stone1.id,
      flyAshDosage: genes.flyAshDosage ?? 0,
      slagDosage: genes.slagDosage ?? 0,
      sandRatio: genes.sandRatio,
      superplasticizerDosage: genes.spDosage,
      superplasticizerId: genes.sp.id,
      slump: this.slump,
      flyAshAmount: amounts.flyAsh ?? 0,
      slagAmount: amounts.slag ?? 0,
      waterAmount: amounts.water || 0,
      sandAmount: sandTotalAmount,
      stoneAmount: stoneTotalAmount,
      superplasticizerAmount: amounts.superplasticizer || 0
    }

    const pred = await XGBoostPredictionService.predict(xgbParams)
    const strength28d = pred.predictions && pred.predictions.strength28d ? pred.predictions.strength28d.value : 0
    const density = pred.predictions && pred.predictions.density ? pred.predictions.density.value : 0
    const spPredicted = pred.predictions && pred.predictions.superplasticizer_dosage ? pred.predictions.superplasticizer_dosage.value : 0

    // 6. 计算强度差距
    const strengthGap = this.targetStrength - strength28d

    // 7. 强度罚分
    // 差距 >= 3MPa → 硬淘汰
    if (strengthGap >= 3) {
      return this._hardReject(realCost, strengthGap, spPredicted, strength28d, density)
    }

    let strengthPenalty = 0
    if (strengthGap > 0) {
      // 0 < 差距 < 3MPa → 软约束：每 MPa 罚 2 元
      strengthPenalty = strengthGap * 2
    }

    // 8. 减水剂偏差罚分
    const spDeviation = Math.abs(spPredicted - genes.spDosage)
    const spPrice = (genes.sp && genes.sp.price) || 0
    const binderTotal = (amounts.cement || 0) + (amounts.flyAsh || 0) + (amounts.slag || 0)
      + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
    const { penalty: spDeviationPenalty, materialCost: spMaterialCost, riskCost: spRiskCost } = calcSpPenalty(spPrice, spDeviation, binderTotal)

    // 9. 掺合料总掺超限罚分
    const additiveTotal = (genes.flyAshDosage ?? 0) + (genes.slagDosage ?? 0)
      + (genes.lithiumSlagDosage ?? 0) + (genes.compositePowderDosage ?? 0)
    let additivePenalty = 0
    if (additiveTotal > 50) {
      additivePenalty = 5 * (additiveTotal - 50)
    }

    // 10. 总适应度 = 成本 + 各罚分
    const fitness = realCost + strengthPenalty + spDeviationPenalty + additivePenalty

    // 11. 构建材料输出数组
    const materials = this._buildMaterials(genes, amounts, sand1, sand2, stone1, stone2, sand1Mass, sand2Mass, stone1Mass, stone2Mass)

    return {
      fitness,
      realCost,
      strengthGap,
      spDeviation,
      spDeviationPenalty,
      spMaterialCost,
      spRiskCost,
      additivePenalty,
      materials,
      predictions: { strength28d, density, spDosage: spPredicted }
    }
  }

  /**
   * 硬淘汰返回值
   */
  _hardReject(realCost, strengthGap, spPredicted, strength28d, density) {
    return {
      fitness: Number.MAX_VALUE,
      realCost,
      strengthGap,
      spDeviation: 0,
      spDeviationPenalty: 0,
      spMaterialCost: 0,
      spRiskCost: 0,
      additivePenalty: 0,
      materials: [],
      predictions: { strength28d, density, spDosage: spPredicted }
    }
  }

  /**
   * 计算减水剂偏差罚分
   * 偏差 > 0.5 个百分点时：
   *   materialCost = spPrice/1000 × (deviation × binderTotal / 100)
   *   riskCost     = 10 × deviation
   *   总罚分 = materialCost + riskCost
   * @param {Object} spMaterial - 减水剂材料
   * @param {number} spDeviation - 偏差（百分点）
   * @param {Object} amounts - 各材料用量
   * @returns {number} 减水剂偏差罚分
   */
  _calcSpPenalty(spMaterial, spDeviation, amounts) {
    const spPrice = (spMaterial && spMaterial.price) || 0
    const binderTotal = (amounts.cement || 0) + (amounts.flyAsh || 0) + (amounts.slag || 0)
      + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)
    return calcSpPenalty(spPrice, spDeviation, binderTotal).penalty
  }

  /**
   * 构建材料输出数组（供 Validator 使用）
   * @returns {Array<{type: string, materialId: number, mass: number, density: number}>}
   */
  _buildMaterials(genes, amounts, sand1, sand2, stone1, stone2, sand1Mass, sand2Mass, stone1Mass, stone2Mass) {
    return [
      {
        type: 'cement',
        materialId: genes.cement.id,
        mass: Math.round(amounts.cement || 0),
        density: genes.cement.density * 1000
      },
      {
        type: 'flyAsh',
        materialId: genes.flyAsh ? genes.flyAsh.id : 0,
        mass: Math.round(amounts.flyAsh || 0),
        density: genes.flyAsh ? genes.flyAsh.density * 1000 : 0
      },
      {
        type: 'water',
        materialId: genes.water.id,
        mass: Math.round(amounts.water || 0),
        density: genes.water.density * 1000
      },
      {
        type: 'sand1',
        materialId: sand1.id,
        mass: Math.round(sand1Mass),
        density: sand1.density * 1000
      },
      {
        type: 'sand2',
        materialId: sand2 ? sand2.id : 0,
        mass: Math.round(sand2Mass),
        density: sand2 ? sand2.density * 1000 : 0
      },
      {
        type: 'stone1',
        materialId: stone1.id,
        mass: Math.round(stone1Mass),
        density: stone1.density * 1000
      },
      {
        type: 'stone2',
        materialId: stone2 ? stone2.id : 0,
        mass: Math.round(stone2Mass),
        density: stone2 ? stone2.density * 1000 : 0
      },
      {
        type: 'sp',
        materialId: genes.sp.id,
        mass: Math.round(amounts.superplasticizer || 0),
        density: genes.sp.density * 1000
      }
    ]
  }

  /**
   * 将目标强度（数值）转换为等级字符串
   * @param {number} targetStrength - 目标强度（MPa）
   * @returns {string} 强度等级（如 'C30'）
   */
  _getStrengthGrade(targetStrength) {
    const grades = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
    let closest = 30
    let minDiff = Infinity
    for (const g of grades) {
      const diff = Math.abs(targetStrength - g)
      if (diff < minDiff) {
        minDiff = diff
        closest = g
      }
    }
    return `C${closest}`
  }
}

module.exports = ConcreteFitness
module.exports.calcSpPenalty = calcSpPenalty

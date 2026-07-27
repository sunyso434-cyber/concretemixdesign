const XGBoostPredictionService = require('./XGBoostPredictionService')
const MixDesignService_Database = require('./MixDesignService/MixDesignService_Database')

/**
 * 混凝土适应度函数
 * 评估基因方案（配比参数 + 材料选择）的适应度
 * 适应度 = 真实成本 + 强度罚分 + 强度余量罚分 + 掺合料总掺超限罚分 + 砂率罚分
 * 减水剂成本用 XGBoost 预测掺量计算（不用基因掺量），但用水量等不重算
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
    this.additiveTotalMax = options?.additiveTotalMax ?? 50
    this.singleAdditiveMax = options?.singleAdditiveMax ?? 30
    this.spDosageMin = options?.spDosageMin ?? 1.0
    this.spDosageMax = options?.spDosageMax ?? 5.0
    // 方案B：胶凝材料下限约束（用户可调，默认300）
    // 训练数据胶凝材料下限300，低于此值模型外推预测不可信
    this.binderMin = options?.binderMin ?? 300
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

    const sand1Mass = sandTotalAmount * (1 - sand2Proportion / 100)
    const sand2Mass = sandTotalAmount * (sand2Proportion / 100)
    const stone1Mass = stoneTotalAmount * (1 - stone2Proportion / 100)
    const stone2Mass = stoneTotalAmount * (stone2Proportion / 100)

    // 4. 计算胶凝材料总量（提前算，供减水剂用量计算用）
    const binderTotal = (amounts.cement || 0) + (amounts.flyAsh || 0) + (amounts.slag || 0)
      + (amounts.lithiumSlag || 0) + (amounts.compositePowder || 0)

    // 5. XGBoost 预测：强度28d、容重、减水剂掺量
    // 输入用基因 spDosage（不换成预测值，避免误差传递：预测值是模型的"建议"，用它再喂模型会引入误差）
    const xgbParams = {
      cementAmount: amounts.cement || 0,
      waterBinderRatio: genes.wb,
      cementId: genes.cement.id,
      sandId: sand1.id,
      stoneId: stone1.id,
      flyAshDosage: genes.flyAshDosage ?? 0,
      slagDosage: genes.slagDosage ?? 0,
      lithiumSlagDosage: genes.lithiumSlagDosage ?? 0,
      compositePowderDosage: genes.compositePowderDosage ?? 0,
      sandRatio: genes.sandRatio,
      superplasticizerDosage: genes.spDosage,
      superplasticizerId: genes.sp.id,
      flyAshId: genes.flyAsh ? genes.flyAsh.id : undefined,
      slagId: genes.slag ? genes.slag.id : undefined,
      lithiumSlagId: genes.lithiumSlag ? genes.lithiumSlag.id : undefined,
      compositePowderId: genes.compositePowder ? genes.compositePowder.id : undefined,
      slump: this.slump,
      flyAshAmount: amounts.flyAsh ?? 0,
      slagAmount: amounts.slag ?? 0,
      lithiumSlagAmount: amounts.lithiumSlag ?? 0,
      compositePowderAmount: amounts.compositePowder ?? 0,
      waterAmount: amounts.water || 0,
      sandAmount: sandTotalAmount,
      stoneAmount: stoneTotalAmount,
      superplasticizerAmount: amounts.superplasticizer || 0
    }

    const pred = await XGBoostPredictionService.predict(xgbParams)
    const strength28d = pred.predictions && pred.predictions.strength28d ? pred.predictions.strength28d.value : 0
    const density = pred.predictions && pred.predictions.density ? pred.predictions.density.value : 0
    const spPredicted = pred.predictions && pred.predictions.superplasticizer_dosage ? pred.predictions.superplasticizer_dosage.value : 0

    // 6. 计算减水剂预测用量（用预测掺量，不用基因掺量）
    // 注意：用水量、胶凝材料、砂石等不随预测掺量重算（保持 amounts 原值）
    const spPredictedAmount = binderTotal * (spPredicted / 100)

    // 7. 计算真实材料成本（元/m³）
    // 单价单位：元/吨，用量单位：kg/m³ → 元/kg = 元/吨 ÷ 1000
    // 减水剂成本用预测掺量算的用量，其他材料用原 amounts
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
    realCost += spPredictedAmount * getPrice(genes.sp) / 1000

    // 8. 计算强度差距
    const strengthGap = this.targetStrength - strength28d

    // 9. 强度罚分
    // 差距 >= 3MPa → 硬淘汰
    if (strengthGap >= 3) {
      return this._hardReject(realCost, strengthGap, spPredicted, strength28d, density)
    }

    let strengthPenalty = 0
    if (strengthGap > 0) {
      // 0 < 差距 < 3MPa → 软约束：每 MPa 罚 2 元
      strengthPenalty = strengthGap * 2
    }

    // 9.5 方案F：强度余量罚分（递增式）
    // 强度超出目标5 MPa以内不罚（安全余量）；超出5~10 MPa部分罚 4元/MPa；
    // 超出10 MPa以上部分罚 6元/MPa（递增压制过度保守解）
    // 目的：打破"强度都达标→适应度平坦→GA随机停泊"的不稳定问题
    const strengthSurplus = -strengthGap  // 正值=超出，负值=不足
    const strengthSurplusPenalty = this._calcStrengthSurplusPenalty(strengthSurplus)

    // 10. 方案B：胶凝材料下限约束（避免模型外推失真）
    // 训练数据胶凝材料下限300，低于此值模型预测不可信，直接淘汰
    if (binderTotal < this.binderMin) {
      return this._binderReject(realCost, binderTotal, this.binderMin, spPredicted, strength28d, density)
    }

    // 11. 掺合料总掺超限罚分（梯度递增式）
    const additiveTotal = (genes.flyAshDosage ?? 0) + (genes.slagDosage ?? 0)
      + (genes.lithiumSlagDosage ?? 0) + (genes.compositePowderDosage ?? 0)
    const additivePenalty = this._calcAdditivePenalty(additiveTotal)

    // 12. 方案E：砂率合理性罚分
    // 模型对砂率不敏感（r=-0.32），GA 会压到下限省成本，但工程上砂率过低会离析
    // 合理区间 = JGJ 55 表5.4.1 查表 + 细度模数修正（基准 2.7）
    // 偏离区间每 1% 罚 4 元
    const sandRatioPenalty = this._calcSandRatioPenalty(genes.sandRatio, genes.wb, sand1)

    // 13. 总适应度 = 成本 + 各罚分（已删除减水剂偏差罚分，减水剂成本用预测掺量算）
    const fitness = realCost + strengthPenalty + strengthSurplusPenalty + additivePenalty + sandRatioPenalty

    // 14. 构建材料输出数组（减水剂用量用预测掺量算）
    const materials = this._buildMaterials(genes, amounts, sand1, sand2, stone1, stone2, sand1Mass, sand2Mass, stone1Mass, stone2Mass, spPredictedAmount)

    return {
      fitness,
      realCost,
      strengthGap,
      strengthSurplus: strengthSurplus > 0 ? strengthSurplus : 0,
      strengthSurplusPenalty,
      additivePenalty,
      additiveTotal,
      sandRatioPenalty,
      materials,
      amounts,
      spPredictedAmount,
      predictions: {
        strength28d,
        density,
        spDosagePredicted: spPredicted,
        spDosageGene: genes.spDosage
      }
    }
  }

  /**
   * 计算掺合料总掺超限罚分（梯度递增式）
   * 每超 1% 一个梯度，罚分翻倍：1%=10, 2%=20, 3%=40, 4%=80, 5%=160...
   * @param {number} additiveTotal - 掺合料总掺量百分比
   * @returns {number}
   */
  _calcAdditivePenalty(additiveTotal) {
    const excess = additiveTotal - this.additiveTotalMax
    if (excess <= 0) return 0
    // 梯度递增：每超 1% 一个梯度，罚分翻倍
    // excess=0.5 → tier=0 → 罚 10
    // excess=1.0 → tier=0 → 罚 10
    // excess=1.01 → tier=1 → 罚 20
    // excess=2.0 → tier=1 → 罚 20
    // excess=2.01 → tier=2 → 罚 40
    const tier = Math.floor(excess - 1e-9)
    return 10 * Math.pow(2, tier)
  }

  /**
   * 方案F：计算强度余量罚分（递增式）
   * surplus <= 5       → 0（安全余量，不罚）
   * 5 < surplus <= 10  → (surplus-5) × 4 元/MPa
   * surplus > 10       → 5×4 + (surplus-10) × 6 元/MPa
   * @param {number} surplus - 强度超出目标的余量（MPa），负值表示不足则不罚
   * @returns {number}
   */
  _calcStrengthSurplusPenalty(surplus) {
    if (surplus <= 5) return 0
    if (surplus <= 10) return (surplus - 5) * 4
    return 5 * 4 + (surplus - 10) * 6
  }

  /**
   * 硬淘汰返回值
   */
  _hardReject(realCost, strengthGap, spPredicted, strength28d, density) {
    return {
      fitness: Number.MAX_VALUE,
      realCost,
      strengthGap,
      additivePenalty: 0,
      materials: [],
      predictions: { strength28d, density, spDosagePredicted: spPredicted }
    }
  }

  /**
   * 方案B：胶凝材料下限淘汰返回值
   * 胶凝材料 < binderMin（默认300），模型外推预测不可信，直接淘汰
   */
  _binderReject(realCost, binderTotal, binderMin, spPredicted, strength28d, density) {
    return {
      fitness: Number.MAX_VALUE,
      realCost,
      strengthGap: 0,
      additivePenalty: 0,
      materials: [],
      predictions: { strength28d, density, spDosagePredicted: spPredicted },
      rejectReason: `胶凝材料 ${binderTotal.toFixed(0)} < 下限 ${binderMin} kg/m³（外推失真）`
    }
  }

  /**
   * 方案E：计算砂率合理性罚分
   * 方法：JGJ 55-2011 表5.4.1 查表 + 细度模数修正（基准 2.7）
   *   - 查表：水胶比 0.40→[30,35]，0.50→[33,38]，0.60→[36,41]，中间线性插值
   *   - fm 修正：细度模数每偏离基准 2.7 一个 0.1，区间上下限整体平移 0.5%
   *   - 罚分：偏离区间每 1% 罚 4 元
   *   - 水胶比超出 [0.40, 0.60] 范围用边界值（不外推）
   */
  _calcSandRatioPenalty(sandRatio, wb, sand1) {
    // 1. JGJ 55-2011 表5.4.1 水胶比-砂率区间（碎石混凝土）
    let tableMin, tableMax
    if (wb <= 0.40) {
      tableMin = 30; tableMax = 35
    } else if (wb >= 0.60) {
      tableMin = 36; tableMax = 41
    } else {
      // 在 0.40~0.60 之间线性插值
      const t = (wb - 0.40) / 0.20
      tableMin = 30 + t * (36 - 30)
      tableMax = 35 + t * (41 - 35)
    }

    // 2. 细度模数修正（基准 2.7，每 0.1 fm 变化，砂率上下限平移 0.5%）
    const finenessModulus = sand1?.finenessModulus ?? 2.7
    const fmAdjust = (finenessModulus - 2.7) * 5  // 系数 5 = 0.05 × 100（每0.1 fm → 0.5%）

    // 3. 最终合理区间
    const lowerBound = tableMin + fmAdjust
    const upperBound = tableMax + fmAdjust

    // 4. 罚分（偏离区间每 1% 罚 4 元）
    let penalty = 0
    if (sandRatio < lowerBound) {
      penalty = (lowerBound - sandRatio) * 4
    } else if (sandRatio > upperBound) {
      penalty = (sandRatio - upperBound) * 4
    }
    return penalty
  }

  /**
   * 构建材料输出数组（供 Validator 使用）
   * @param {number} spPredictedAmount - 减水剂用量（按预测掺量算，kg/m³）
   * @returns {Array<{type: string, materialId: number, mass: number, density: number}>}
   */
  _buildMaterials(genes, amounts, sand1, sand2, stone1, stone2, sand1Mass, sand2Mass, stone1Mass, stone2Mass, spPredictedAmount) {
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
        type: 'slag',
        materialId: genes.slag ? genes.slag.id : 0,
        mass: Math.round(amounts.slag || 0),
        density: genes.slag ? genes.slag.density * 1000 : 0
      },
      {
        type: 'lithiumSlag',
        materialId: genes.lithiumSlag ? genes.lithiumSlag.id : 0,
        mass: Math.round(amounts.lithiumSlag || 0),
        density: genes.lithiumSlag ? genes.lithiumSlag.density * 1000 : 0
      },
      {
        type: 'compositePowder',
        materialId: genes.compositePowder ? genes.compositePowder.id : 0,
        mass: Math.round(amounts.compositePowder || 0),
        density: genes.compositePowder ? genes.compositePowder.density * 1000 : 0
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
        mass: Math.round(spPredictedAmount || 0),
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

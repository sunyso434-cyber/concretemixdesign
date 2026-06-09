/**
 * 混凝土配合比格式转换器
 * 在质量输入(kg/m³)和百分比输入之间进行转换，供XGBoost预测使用
 */

class MixFormatConverter {
  massToPercent(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('MixFormatConverter: params必须为非空对象')
    }

    const {
      cementAmount = 0,
      waterAmount = 0,
      flyAshAmount = 0,
      slagAmount = 0,
      lithiumSlagAmount = 0,
      compositePowderAmount = 0,
      sandAmount = 0,
      stoneAmount = 0,
      superplasticizerAmount = 0,
      waterBinderRatio: fallbackWaterBinderRatio,
      flyAshDosage: fallbackFlyAshDosage,
      slagDosage: fallbackSlagDosage,
      lithiumSlagDosage: fallbackLithiumSlagDosage,
      compositePowderDosage: fallbackCompositePowderDosage,
      sandRatio: fallbackSandRatio,
      superplasticizerDosage: fallbackSuperplasticizerDosage
    } = params

    const binderTotal =
      cementAmount + flyAshAmount + slagAmount + lithiumSlagAmount + compositePowderAmount

    if (binderTotal <= 0) {
      throw new Error(
        `MixFormatConverter: 胶凝材料总量必须大于0，当前值为 ${binderTotal}（cement=${cementAmount}, flyAsh=${flyAshAmount}, slag=${slagAmount}, lithiumSlag=${lithiumSlagAmount}, compositePowder=${compositePowderAmount}）`
      )
    }

    const flyAshDosage = flyAshAmount > 0
      ? (flyAshAmount / binderTotal) * 100
      : (fallbackFlyAshDosage ?? 0)

    const slagDosage = slagAmount > 0
      ? (slagAmount / binderTotal) * 100
      : (fallbackSlagDosage ?? 0)

    const lithiumSlagDosage = lithiumSlagAmount > 0
      ? (lithiumSlagAmount / binderTotal) * 100
      : (fallbackLithiumSlagDosage ?? 0)

    const compositePowderDosage = compositePowderAmount > 0
      ? (compositePowderAmount / binderTotal) * 100
      : (fallbackCompositePowderDosage ?? 0)

    const waterBinderRatio = waterAmount > 0
      ? waterAmount / binderTotal
      : fallbackWaterBinderRatio

    const aggregateTotal = sandAmount + stoneAmount
    const sandRatio = aggregateTotal > 0
      ? (sandAmount / aggregateTotal) * 100
      : fallbackSandRatio

    const superplasticizerDosage = superplasticizerAmount > 0
      ? (superplasticizerAmount / binderTotal) * 100
      : (fallbackSuperplasticizerDosage ?? 0)

    const has = (value) => (value > 0 ? 1 : 0)

    return {
      waterBinderRatio,
      flyAshDosage,
      slagDosage,
      lithiumSlagDosage,
      compositePowderDosage,
      sandRatio,
      superplasticizerDosage,
      has_fly_ash: has(flyAshAmount || (fallbackFlyAshDosage ?? 0)),
      has_slag: has(slagAmount || (fallbackSlagDosage ?? 0)),
      has_lithium_slag: has(lithiumSlagAmount || (fallbackLithiumSlagDosage ?? 0)),
      has_composite_powder: has(compositePowderAmount || (fallbackCompositePowderDosage ?? 0)),
      has_superplasticizer: has(superplasticizerAmount || (fallbackSuperplasticizerDosage ?? 0))
    }
  }

  hasMassInputs(params) {
    if (!params || typeof params !== 'object') return false
    const massKeys = [
      'cementAmount',
      'waterAmount',
      'flyAshAmount',
      'slagAmount',
      'lithiumSlagAmount',
      'compositePowderAmount',
      'sandAmount',
      'stoneAmount',
      'superplasticizerAmount'
    ]
    return massKeys.some((key) => key in params && params[key] !== undefined && params[key] !== null)
  }

  /**
   * 将 calculate_mix_design 返回的配合比结果格式转换为预测模型所需格式
   * 输入: { materials: { cement: 292, flyAsh: 51, sand: 856, ... }, waterRatio: 0.45, sandRatio: 0.38, ... }
   * 输出: { cementAmount: 292, flyAshAmount: 51, sandAmount: 856, waterBinderRatio: 0.45, sandRatio: 38, ... }
   */
  mixDesignResultToPredictionInput(input) {
    if (!input || typeof input !== 'object') return input
    const { materials, waterRatio, sandRatio, ...rest } = input
    const result = { ...rest }

    if (materials && typeof materials === 'object') {
      if (materials.cement != null) result.cementAmount = materials.cement
      if (materials.flyAsh != null) result.flyAshAmount = materials.flyAsh
      if (materials.slag != null) result.slagAmount = materials.slag
      if (materials.lithiumSlag != null) result.lithiumSlagAmount = materials.lithiumSlag
      if (materials.compositePowder != null) result.compositePowderAmount = materials.compositePowder
      if (materials.sand != null) result.sandAmount = materials.sand
      if (materials.stone != null) result.stoneAmount = materials.stone
      if (materials.water != null) result.waterAmount = materials.water
      if (materials.superplasticizer != null) result.superplasticizerAmount = materials.superplasticizer
    }
    if (waterRatio != null && result.waterBinderRatio == null) result.waterBinderRatio = waterRatio
    if (sandRatio != null && result.sandRatio == null) result.sandRatio = (sandRatio > 1 ? sandRatio : sandRatio * 100)

    return result
  }
}

module.exports = new MixFormatConverter()

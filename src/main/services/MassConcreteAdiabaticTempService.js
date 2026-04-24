const MassConcreteAdiabaticTemp = require('../db/models/MassConcreteAdiabaticTemp')

/**
 * 大体积混凝土绝热温升计算服务
 * 基于 GB 50496-2018《大体积混凝土施工标准》
 */
class MassConcreteAdiabaticTempService {
  // M0系数表（根据入模温度查表）
  // 格式：{入模温度: {A, B}}
  static M0_TABLE = {
    10: { A: 0.0023, B: 0.045 },
    20: { A: 0.0024, B: 0.5159 },
    30: { A: 0.0026, B: 0.9871 }
  }

  // 水泥水化热折算系数 lambda
  // 简化取值为 0.67（3d/7d 热折算比例）
  static CEMENT_LAMBDA = 0.67

  // 混凝土比热容默认值 kJ/(kg·℃)
  static DEFAULT_CONCRETE_C = 0.97

  // 混凝土密度默认值 kg/m³
  static DEFAULT_CONCRETE_RHO = 2400

  /**
   * 根据入模温度获取 m0 系数
   * @param {number} moldingTemp - 入模温度 ℃
   * @returns {Object} {A, B} 系数
   */
  static getM0Coefficients(moldingTemp) {
    const temps = Object.keys(MassConcreteAdiabaticTempService.M0_TABLE)
      .map(Number)
      .sort((a, b) => a - b)

    // 边界处理
    if (moldingTemp <= temps[0]) {
      return MassConcreteAdiabaticTempService.M0_TABLE[temps[0]]
    }
    if (moldingTemp >= temps[temps.length - 1]) {
      return MassConcreteAdiabaticTempService.M0_TABLE[temps[temps.length - 1]]
    }

    // 线性插值
    let lower = temps[0]
    let upper = temps[temps.length - 1]
    for (let i = 0; i < temps.length - 1; i++) {
      if (moldingTemp >= temps[i] && moldingTemp <= temps[i + 1]) {
        lower = temps[i]
        upper = temps[i + 1]
        break
      }
    }

    const t = (moldingTemp - lower) / (upper - lower)
    const lowerCoeff = MassConcreteAdiabaticTempService.M0_TABLE[lower]
    const upperCoeff = MassConcreteAdiabaticTempService.M0_TABLE[upper]

    return {
      A: lowerCoeff.A + t * (upperCoeff.A - lowerCoeff.A),
      B: lowerCoeff.B + t * (upperCoeff.B - lowerCoeff.B)
    }
  }

  /**
   * 生成温度分布数据（单一时刻）
   * @param {number} maxTemp - 最高温度 ℃
   * @param {number} m - 温升系数
   * @param {number} concreteThickness - 混凝土厚度 m
   * @param {number} concreteLength - 混凝土长度 m
   * @param {number} moldingTemp - 入模温度 ℃
   * @returns {Array} 温度分布数据
   */
  static generateTempDistribution(maxTemp, m, concreteThickness, concreteLength, moldingTemp) {
    const distribution = []
    const points = 20 // 沿长度方向的采样点数

    for (let i = 0; i <= points; i++) {
      // position: 从中心到表面，0%=中心，100%=表面
      const position = i / points * 100 // 百分比 0-100
      const x = (i / points) * (concreteThickness / 2)
      // 正确：温度 = 入模温度 + 绝热温升（绝热温升沿厚度衰减）
      const adiabaticTempRise = maxTemp * (1 - Math.exp(-m * x))
      const temp = moldingTemp + adiabaticTempRise

      distribution.push({
        position, // 百分比 0-100
        distance: Math.round(x * 100) / 100, // 距离 m
        temperature: Math.round(temp * 10) / 10
      })
    }

    return distribution
  }

  /**
   * 生成温度场数据（时间-位置-温度三维数据）
   * @param {number} maxAdiabaticTemp - 最高绝热温升 ℃
   * @param {number} m0 - 温升系数
   * @param {number} moldingTemp - 入模温度 ℃
   * @param {number} ambientTemp - 环境温度 ℃
   * @param {number} concreteThickness - 混凝土厚度 m
   * @returns {Array} 温度场数据 [{day, position, distance, temperature}]
   */
  static generateTempFieldData(maxAdiabaticTemp, m0, moldingTemp, ambientTemp, concreteThickness) {
    const tempFieldData = []
    const days = [1, 3, 7, 14, 21, 28]
    const positionPoints = 10 // 沿厚度方向的采样点数

    for (const day of days) {
      // 计算该时刻的绝热温升
      const adiabaticTemp = maxAdiabaticTemp * (1 - Math.exp(-m0 * day))

      for (let i = 0; i <= positionPoints; i++) {
        const position = i / positionPoints * 100 // 百分比 0-100
        const x = (i / positionPoints) * (concreteThickness / 2)
        // 正确：温度 = 入模温度 + 绝热温升（绝热温升沿厚度衰减）
        const adiabaticTempRise = adiabaticTemp * (1 - Math.exp(-m0 * x))
        const temp = moldingTemp + adiabaticTempRise

        tempFieldData.push({
          day,
          position: Math.round(position * 10) / 10, // 百分比
          distance: Math.round(x * 100) / 100, // 距离 m
          temperature: Math.round(temp * 10) / 10
        })
      }
    }

    return tempFieldData
  }

  /**
   * 生成温差曲线数据
   * @param {number} maxAdiabaticTemp - 最高绝热温升 ℃
   * @param {number} m0 - 温升系数
   * @param {number} moldingTemp - 入模温度 ℃
   * @param {number} ambientTemp - 环境温度 ℃
   * @param {number} concreteThickness - 混凝土厚度 m
   * @returns {Object} {tempDiffCurveData: 里表温差, surfaceTempDiffCurveData: 表气温差}
   */
  static generateTempDiffData(maxAdiabaticTemp, m0, moldingTemp, ambientTemp, concreteThickness) {
    const tempDiffCurveData = [] // 里表温差（中心-表面）
    const surfaceTempDiffCurveData = [] // 表气温差（表面-大气）

    const days = [1, 2, 3, 5, 7, 10, 14, 21, 28]
    // 表面节点位于 x = concreteThickness / 2
    const surfaceX = concreteThickness / 2

    for (const day of days) {
      // 绝热温升
      const adiabaticTempRise = maxAdiabaticTemp * (1 - Math.exp(-m0 * day))
      // 混凝土中心温度（简化：中心温度 = 入模温度 + 绝热温升）
      const centerTemp = moldingTemp + adiabaticTempRise
      // 表面温度：考虑散热后的温度
      const surfaceTemp = ambientTemp + (centerTemp - ambientTemp) * Math.exp(-m0 * surfaceX)

      // 里表温差
      const interiorSurfaceDiff = centerTemp - surfaceTemp
      // 表气温差
      const surfaceAirDiff = surfaceTemp - ambientTemp

      tempDiffCurveData.push({
        day,
        tempDiff: Math.round(interiorSurfaceDiff * 10) / 10
      })

      surfaceTempDiffCurveData.push({
        day,
        tempDiff: Math.round(surfaceAirDiff * 10) / 10
      })
    }

    return {
      tempDiffCurveData,
      surfaceTempDiffCurveData
    }
  }

  /**
   * 计算绝热温升
   * @param {Object} params - 计算参数
   * @param {string} params.strengthGrade - 强度等级（新增）
   * @param {number} params.cementContent - 水泥用量 kg/m³
   * @param {number} params.cementConsumption - 水泥用量 kg/m³（alias for cementContent）
   * @param {number} params.flyAshConsumption - 粉煤灰用量 kg/m³（新增）
   * @param {number} params.slagConsumption - 矿渣粉用量 kg/m³（新增）
   * @param {number} params.totalBinder - 总胶凝材料 kg/m³
   * @param {number} params.totalHeat - 总发热量 kJ/m³
   * @param {number} params.moldingTemp - 入模温度 ℃
   * @param {number} params.ambientTemp - 环境温度 ℃
   * @param {number} params.concreteThickness - 混凝土厚度 m
   * @param {number} params.concreteLength - 混凝土长度 m
   * @param {string} params.cementType - 水泥类型
   * @param {number} params.concreteC - 混凝土比热容 kJ/(kg·℃)
   * @param {number} params.concreteRho - 混凝土密度 kg/m³
   * @returns {Object} 计算结果
   */
  calculate(params) {
    const {
      strengthGrade = 'C30',
      cementContent,
      cementConsumption,
      flyAshConsumption = 0,
      slagConsumption = 0,
      totalBinder,
      totalHeat,
      moldingTemp,
      ambientTemp,
      concreteThickness,
      concreteLength,
      cementType,
      concreteC = MassConcreteAdiabaticTempService.DEFAULT_CONCRETE_C,
      concreteRho = MassConcreteAdiabaticTempService.DEFAULT_CONCRETE_RHO
    } = params

    // 实际水泥用量：优先使用 cementContent，否则使用 cementConsumption
    const actualCementContent = cementContent || cementConsumption || 0

    // 计算胶材总量和掺量比例（新增）
    const binderTotal = (flyAshConsumption || 0) + (slagConsumption || 0) + actualCementContent
    const flyAshRatio = binderTotal > 0 ? ((flyAshConsumption || 0) / binderTotal) * 100 : 0
    const slagRatio = binderTotal > 0 ? ((slagConsumption || 0) / binderTotal) * 100 : 0

    // 1. 计算 W = lambda * actualCementContent
    const lambda = MassConcreteAdiabaticTempService.CEMENT_LAMBDA
    const W = lambda * actualCementContent

    // 2. 计算 m0 = A * W + B
    const { A, B } = MassConcreteAdiabaticTempService.getM0Coefficients(moldingTemp)
    const m0 = A * W + B

    // 3. 计算最高绝热温升
    // 公式：maxAdiabaticTemp = (totalBinder * totalHeat) / (concreteC * concreteRho)
    const maxAdiabaticTemp = (totalBinder * totalHeat) / (concreteC * concreteRho)

    // 4. 生成温度曲线数据（0-28天，共56个点，每12小时一个点）
    const tempCurveData = []
    const totalPoints = 56
    const maxDays = 28

    for (let i = 0; i <= totalPoints; i++) {
      const t = (i / totalPoints) * maxDays // 时间，天
      // T(t) = maxAdiabaticTemp * (1 - exp(-m0 * t))
      const T = maxAdiabaticTemp * (1 - Math.exp(-m0 * t))
      tempCurveData.push({
        day: Math.round(t * 100) / 100,
        temperature: Math.round(T * 100) / 100
      })
    }

    // 5. 生成温差曲线数据（里表温差和表气温差）
    const {
      tempDiffCurveData,
      surfaceTempDiffCurveData
    } = MassConcreteAdiabaticTempService.generateTempDiffData(
      maxAdiabaticTemp,
      m0,
      moldingTemp,
      ambientTemp,
      concreteThickness
    )

    // 6. 生成温度分布数据
    const tempDistributionData = MassConcreteAdiabaticTempService.generateTempDistribution(
      maxAdiabaticTemp,
      m0,
      concreteThickness,
      concreteLength || 0,
      moldingTemp
    )

    // 7. 生成温度场数据（时间-位置-温度）
    const tempFieldData = MassConcreteAdiabaticTempService.generateTempFieldData(
      maxAdiabaticTemp,
      m0,
      moldingTemp,
      ambientTemp,
      concreteThickness
    )

    console.log('[绝热温升计算] 参数:', {
      cementContent,
      totalBinder,
      totalHeat,
      moldingTemp,
      concreteThickness,
      cementType,
      concreteC,
      concreteRho
    })

    console.log('[绝热温升计算] 结果:', {
      lambda,
      W: W.toFixed(2),
      A: A.toFixed(4),
      B: B.toFixed(4),
      m0: m0.toFixed(4),
      maxAdiabaticTemp: maxAdiabaticTemp.toFixed(2),
      tempCurveDataPoints: tempCurveData.length
    })

    return {
      // === 配合比继承（新增）===
      strengthGrade,
      mixDesignSummary: {
        cement: { name: cementType || '普通硅酸盐水泥', consumption: actualCementContent },
        flyAsh: { consumption: flyAshConsumption || 0 },
        slag: { consumption: slagConsumption || 0 }
      },
      binderTotal,
      flyAshRatio,
      slagRatio,

      // === 原有字段 ===
      cementContent: actualCementContent,
      cementConsumption: actualCementContent,
      flyAshConsumption: flyAshConsumption || 0,
      slagConsumption: slagConsumption || 0,
      totalBinder,
      totalHeat,
      moldingTemp,
      ambientTemp,
      concreteThickness,
      concreteLength,
      cementType,
      lambda,
      W,
      hydrationRateCoefficient: m0,
      maxAdiabaticTemp,
      concreteC,
      concreteRho,
      tempCurveData,
      tempDiffCurveData,
      surfaceTempDiffCurveData,
      tempDistributionData,
      tempFieldData
    }
  }

  /**
   * 保存绝热温升计算结果
   * @param {number} schemeId - 方案ID
   * @param {Object} data - 计算结果数据
   * @returns {Promise<Object>} 保存后的数据
   */
  async saveResult(schemeId, data) {
    try {
      // 查找是否已存在该方案的绝热温升记录
      let adiabaticTemp = await MassConcreteAdiabaticTemp.findOne({ where: { schemeId } })

      // 准备保存的数据
      const saveData = {
        schemeId,
        moldingTemp: data.moldingTemp,
        ambientTemp: data.ambientTemp || 20,
        concreteThickness: data.concreteThickness,
        concreteLength: data.concreteLength || 0,
        hydrationRateCoefficient: data.hydrationRateCoefficient,
        maxAdiabaticTemp: data.maxAdiabaticTemp,
        tempCurveData: data.tempCurveData,
        tempDiffCurveData: data.tempDiffCurveData,
        surfaceTempDiffCurveData: data.surfaceTempDiffCurveData,
        tempDistributionData: data.tempDistributionData,
        tempFieldData: data.tempFieldData
      }

      if (adiabaticTemp) {
        // 更新现有记录
        await adiabaticTemp.update(saveData)
        console.log('[绝热温升保存] 更新方案' + schemeId + '的绝热温升成功')
        return adiabaticTemp.toJSON()
      } else {
        // 创建新记录
        adiabaticTemp = await MassConcreteAdiabaticTemp.create(saveData)
        console.log('[绝热温升保存] 新增方案' + schemeId + '的绝热温升成功')
        return adiabaticTemp.toJSON()
      }
    } catch (error) {
      console.error('[绝热温升保存] 保存绝热温升失败:', error)
      throw error
    }
  }

  /**
   * 获取方案的绝热温升结果
   * @param {number} schemeId - 方案ID
   * @returns {Promise<Object|null>}
   */
  async getResultBySchemeId(schemeId) {
    try {
      const adiabaticTemp = await MassConcreteAdiabaticTemp.findOne({ where: { schemeId } })
      return adiabaticTemp ? adiabaticTemp.toJSON() : null
    } catch (error) {
      console.error('[绝热温升获取] 获取绝热温升失败:', error)
      throw error
    }
  }
}

module.exports = new MassConcreteAdiabaticTempService()
const MassConcreteStress = require('../db/models/MassConcreteStress')

/**
 * 大体积混凝土应力计算服务
 * 基于 GB 50496-2018《大体积混凝土施工标准》附录B
 */
class MassConcreteStressService {
  // 线膨胀系数 α (1/℃)
  static ALPHA = 1.0e-5

  // 泊松比 μ
  static MU = 0.15

  // 系数 φ (胶凝材料效能系数)
  static PHI = 0.09

  // 系数 γ (抗拉强度发展系数)
  static GAMMA = 0.3

  // 防裂安全系数 K
  static K = 1.15

  // 基础弹性模量 E0 表 (×10^4 N/mm²)
  static E0_TABLE = {
    'C25': 2.80,
    'C30': 3.00,
    'C35': 3.15,
    'C40': 3.25,
    'C50': 3.45
  }

  // 粉煤灰修正系数 β1 表
  static BETA1_TABLE = {
    0: 1.00,
    20: 0.99,
    30: 0.98,
    40: 0.96,
    50: 0.95
  }

  // 矿渣粉修正系数 β2 表
  static BETA2_TABLE = {
    0: 1.00,
    20: 1.02,
    30: 1.03,
    40: 1.04,
    50: 1.05
  }

  // 地基约束系数 Cx 表 (N/mm³)
  static CX_TABLE = {
    '软黏土': { min: 1, max: 3 },
    '砂质黏土': { min: 3, max: 6 },
    '硬黏土': { min: 6, max: 10 },
    '风化岩': { min: 10, max: 15 },
    '基岩': { min: 15, max: 20 }
  }

  // 抗拉强度标准值 ftk 表 (N/mm²)
  static FTK_TABLE = {
    'C25': 1.78,
    'C30': 2.01,
    'C35': 2.20,
    'C40': 2.39,
    'C50': 2.64
  }

  /**
   * 从表格插值计算系数
   * @param {number} value - 查表值
   * @param {Object} table - 系数表 {值: 系数}
   * @returns {number} 插值后的系数
   */
  static interpolateTable(value, table) {
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b)

    // 边界处理
    if (value <= keys[0]) {
      return table[keys[0]]
    }
    if (value >= keys[keys.length - 1]) {
      return table[keys[keys.length - 1]]
    }

    // 线性插值
    let lower = keys[0]
    let upper = keys[keys.length - 1]
    for (let i = 0; i < keys.length - 1; i++) {
      if (value >= keys[i] && value <= keys[i + 1]) {
        lower = keys[i]
        upper = keys[i + 1]
        break
      }
    }

    const t = (value - lower) / (upper - lower)
    return table[lower] + t * (table[upper] - table[lower])
  }

  /**
   * 根据强度等级获取基础弹性模量 E0 (N/mm²)
   * @param {string} strengthGrade - 强度等级 (如 'C30')
   * @returns {number} 弹性模量 E0
   */
  static getE0(strengthGrade) {
    const e0Base = MassConcreteStressService.E0_TABLE[strengthGrade] || 3.00
    return e0Base * 1e4 // 转换为 N/mm²
  }

  /**
   * 根据粉煤灰和矿渣粉掺量计算修正系数 β
   * @param {number} flyAshRatio - 粉煤灰掺量 %
   * @param {number} slagRatio - 矿渣粉掺量 %
   * @returns {number} 修正系数 β
   */
  static calculateBeta(flyAshRatio, slagRatio) {
    const beta1 = MassConcreteStressService.interpolateTable(flyAshRatio, MassConcreteStressService.BETA1_TABLE)
    const beta2 = MassConcreteStressService.interpolateTable(slagRatio, MassConcreteStressService.BETA2_TABLE)
    return beta1 * beta2
  }

  /**
   * 根据约束类型和参数获取约束系数 Cx
   * @param {string} externalConstraintType - 外部约束类型
   * @param {number} cxMin - 约束系数最小值
   * @param {number} cxMax - 约束系数最大值
   * @returns {number} 约束系数 Cx (N/mm³)
   */
  static getCxValue(externalConstraintType, cxMin, cxMax) {
    // 如果提供了明确的 cxMin/cxMax，使用它们
    if (cxMin !== undefined && cxMax !== undefined) {
      return (cxMin + cxMax) / 2
    }

    // 否则从表格查找
    const cxRange = MassConcreteStressService.CX_TABLE[externalConstraintType]
    if (cxRange) {
      return (cxRange.min + cxRange.max) / 2
    }

    // 默认返回值
    return 3.0
  }

  /**
   * 计算弹性模量随时间发展 E(t)
   * @param {number} t - 龄期 (天)
   * @param {number} beta - 修正系数
   * @param {number} E0 - 基础弹性模量 (N/mm²)
   * @returns {number} t 时刻弹性模量 (N/mm²)
   */
  static calculateElasticModulus(t, beta, E0) {
    return beta * E0 * (1 - Math.exp(-MassConcreteStressService.PHI * t))
  }

  /**
   * 计算抗拉强度随时间发展 f_tk(t)
   * @param {number} t - 龄期 (天)
   * @param {number} ftk - 抗拉强度标准值 (N/mm²)
   * @returns {number} t 时刻抗拉强度 (N/mm²)
   */
  static calculateTensileStrength(t, ftk) {
    return ftk * (1 - Math.exp(-MassConcreteStressService.GAMMA * t))
  }

  /**
   * 计算外约束系数 Rx
   * @param {number} cx - 约束系数 (N/mm³)
   * @param {number} E - 弹性模量 (N/mm²)
   * @param {number} L - 混凝土长度 (mm)
   * @returns {number} 外约束系数 Rx
   */
  static calculateRx(cx, E, L) {
    if (E <= 0 || L <= 0) return 0
    const sqrtTerm = Math.sqrt(cx / E) * (L / 2)
    return 1 - 1 / Math.cosh(sqrtTerm)
  }

  /**
   * 计算应力
   * @param {Object} params - 计算参数
   * @param {string} params.strengthGrade - 强度等级 (如 'C30')
   * @param {number} params.flyAshRatio - 粉煤灰掺量 %
   * @param {number} params.slagRatio - 矿渣粉掺量 %
   * @param {Array} params.tempRiseData - 温升曲线数据 [{day, temperature}]
   * @param {Array} params.tempDiffCurveData - 温差曲线数据 [{day, tempDiff}]
   * @param {number} params.concreteLength - 混凝土长度 (mm)
   * @param {number} params.concreteThickness - 混凝土厚度 (mm)
   * @param {string} params.externalConstraintType - 外部约束类型
   * @param {number} params.cxMin - 约束系数最小值 (可选)
   * @param {number} params.cxMax - 约束系数最大值 (可选)
   * @returns {Object} 计算结果
   */
  calculate(params) {
    const {
      strengthGrade,
      flyAshRatio = 0,
      slagRatio = 0,
      tempRiseData = [],
      tempDiffCurveData = [],
      concreteLength = 0,
      concreteThickness = 0,
      externalConstraintType = '软黏土',
      cxMin,
      cxMax
    } = params

    // 1. 计算基础参数
    const E0 = MassConcreteStressService.getE0(strengthGrade)
    const beta = MassConcreteStressService.calculateBeta(flyAshRatio, slagRatio)
    const cx = MassConcreteStressService.getCxValue(externalConstraintType, cxMin, cxMax)
    const ftk = MassConcreteStressService.FTK_TABLE[strengthGrade] || 2.01
    const alpha = MassConcreteStressService.ALPHA
    const mu = MassConcreteStressService.MU
    const K = MassConcreteStressService.K

    console.log('[应力计算] 基础参数:', {
      strengthGrade,
      flyAshRatio,
      slagRatio,
      E0: E0.toFixed(2),
      beta: beta.toFixed(4),
      cx: cx.toFixed(2),
      ftk,
      concreteLength,
      concreteThickness
    })

    // 2. 生成时间序列 (0-28天，每0.5天一个点)
    const timePoints = []
    const maxDays = 28
    const step = 0.5
    for (let t = 0; t <= maxDays; t += step) {
      timePoints.push(Math.round(t * 100) / 100)
    }

    // 3. 计算弹性模量发展曲线 E(t)
    const elasticModulusData = timePoints.map(t => ({
      day: t,
      elasticModulus: MassConcreteStressService.calculateElasticModulus(t, beta, E0)
    }))

    // 4. 计算抗拉强度发展曲线 f_tk(t)
    const tensileStrengthData = timePoints.map(t => ({
      day: t,
      tensileStrength: MassConcreteStressService.calculateTensileStrength(t, ftk)
    }))

    // 5. 计算自约束应力 sigma_z(t)
    // 简化计算：sigma_z(t) = (alpha/2) * sum(deltaT * E(t) * H)
    // 其中 H 为松弛系数，简化取 0.5
    const H = 0.5 // 松弛系数简化值
    const selfConstraintStress = []
    let sigmaZ = 0

    for (let i = 0; i < timePoints.length; i++) {
      const t = timePoints[i]
      const E = MassConcreteStressService.calculateElasticModulus(t, beta, E0)

      // 计算温度变化 deltaT
      let deltaT = 0
      if (i > 0 && tempDiffCurveData.length > 0) {
        const prevIdx = Math.floor(i * step / step)
        const currIdx = i
        if (currIdx < tempDiffCurveData.length && prevIdx < tempDiffCurveData.length) {
          deltaT = Math.abs(tempDiffCurveData[currIdx]?.tempDiff - tempDiffCurveData[prevIdx]?.tempDiff) || 0
        }
      }

      // 累积自约束应力
      sigmaZ += alpha * deltaT * E * H
      selfConstraintStress.push({
        day: t,
        stress: sigmaZ
      })
    }

    // 6. 计算外约束应力 sigma_x(t)
    // sigma_x(t) = (alpha/(1-μ)) * sum(deltaT2 * E(t) * H(t,τ) * Rx)
    const externalConstraintStress = []
    let sigmaX = 0
    const Rx = MassConcreteStressService.calculateRx(cx, E0, concreteLength)

    for (let i = 0; i < timePoints.length; i++) {
      const t = timePoints[i]
      const E = MassConcreteStressService.calculateElasticModulus(t, beta, E0)

      // 计算温差变化 deltaT2 (考虑厚度方向)
      let deltaT2 = 0
      if (tempDiffCurveData.length > 0) {
        const maxTempDiff = Math.max(...tempDiffCurveData.map(d => d.tempDiff))
        const minTempDiff = Math.min(...tempDiffCurveData.map(d => d.tempDiff))
        deltaT2 = maxTempDiff - minTempDiff
      }

      // 累积外约束应力
      const factor = alpha / (1 - mu)
      sigmaX += factor * deltaT2 * E * H * Rx
      externalConstraintStress.push({
        day: t,
        stress: sigmaX
      })
    }

    // 7. 计算总应力
    const totalStress = timePoints.map((t, i) => ({
      day: t,
      selfStress: selfConstraintStress[i]?.stress || 0,
      externalStress: externalConstraintStress[i]?.stress || 0,
      total: (selfConstraintStress[i]?.stress || 0) + (externalConstraintStress[i]?.stress || 0)
    }))

    // 8. 抗裂验算
    const crackResistanceCheck = []
    for (let i = 0; i < timePoints.length; i++) {
      const t = timePoints[i]
      const tensileStrength = tensileStrengthData[i].tensileStrength
      const allowStress = tensileStrength / K
      const selfStress = selfConstraintStress[i]?.stress || 0
      const extStress = externalConstraintStress[i]?.stress || 0
      const total = totalStress[i].total

      crackResistanceCheck.push({
        day: t,
        tensileStrength,
        allowableStress: allowStress,
        selfStress,
        externalStress: extStress,
        totalStress: total,
        selfCheck: selfStress <= allowStress,
        externalCheck: extStress <= allowStress,
        totalCheck: total <= allowStress
      })
    }

    // 9. 查找最大应力及危险点
    const maxSelfStress = Math.max(...selfConstraintStress.map(s => Math.abs(s.stress)))
    const maxExtStress = Math.max(...externalConstraintStress.map(s => Math.abs(s.stress)))
    const maxTotalStress = Math.max(...totalStress.map(s => Math.abs(s.total)))

    const criticalDaySelf = selfConstraintStress.find(s => Math.abs(s.stress) === maxSelfStress)?.day || 0
    const criticalDayExt = externalConstraintStress.find(s => Math.abs(s.stress) === maxExtStress)?.day || 0
    const criticalDayTotal = totalStress.find(s => Math.abs(s.total) === maxTotalStress)?.day || 0

    console.log('[应力计算] 结果:', {
      maxSelfStress: maxSelfStress.toFixed(4),
      maxExtStress: maxExtStress.toFixed(4),
      maxTotalStress: maxTotalStress.toFixed(4),
      criticalDaySelf,
      criticalDayExt,
      criticalDayTotal,
      Rx: Rx.toFixed(4)
    })

    return {
      // 输入参数
      strengthGrade,
      flyAshRatio,
      slagRatio,
      concreteLength,
      concreteThickness,
      externalConstraintType,
      cxValue: cx,

      // 中间参数
      E0,
      beta,
      ftk,

      // 曲线数据
      elasticModulusData,
      tensileStrengthCurve: tensileStrengthData,
      selfConstraintStress,
      externalConstraintStress,
      totalStress,

      // 抗裂验算
      crackResistanceCheck,

      // 关键指标
      maxSelfStress,
      maxExternalStress: maxExtStress,
      maxTotalStress,
      criticalDaySelf,
      criticalDayExternal: criticalDayExt,
      criticalDayTotal,
      Rx,

      // 防裂安全系数
      safetyFactor: K,
      allowableStress: ftk / K
    }
  }

  /**
   * 保存应力计算结果
   * @param {number} schemeId - 方案ID
   * @param {Object} data - 计算结果数据
   * @returns {Promise<Object>} 保存后的数据
   */
  async saveResult(schemeId, data) {
    try {
      // 查找是否已存在该方案的应力记录
      let stressRecord = await MassConcreteStress.findOne({ where: { schemeId } })

      // 准备保存的数据
      const saveData = {
        schemeId,
        externalConstraintType: data.externalConstraintType,
        cxValue: data.cxValue,
        selfConstraintStress: data.selfConstraintStress,
        externalConstraintStress: data.externalConstraintStress,
        totalStress: data.totalStress,
        crackResistanceCheck: data.crackResistanceCheck,
        tensileStrengthCurve: data.tensileStrengthCurve
      }

      if (stressRecord) {
        // 更新现有记录
        await stressRecord.update(saveData)
        console.log('[应力保存] 更新方案' + schemeId + '的应力计算结果成功')
        return stressRecord.toJSON()
      } else {
        // 创建新记录
        stressRecord = await MassConcreteStress.create(saveData)
        console.log('[应力保存] 新增方案' + schemeId + '的应力计算结果成功')
        return stressRecord.toJSON()
      }
    } catch (error) {
      console.error('[应力保存] 保存应力计算结果失败:', error)
      throw error
    }
  }

  /**
   * 获取方案的应力计算结果
   * @param {number} schemeId - 方案ID
   * @returns {Promise<Object|null>}
   */
  async getResultBySchemeId(schemeId) {
    try {
      const stressRecord = await MassConcreteStress.findOne({ where: { schemeId } })
      return stressRecord ? stressRecord.toJSON() : null
    } catch (error) {
      console.error('[应力获取] 获取应力计算结果失败:', error)
      throw error
    }
  }
}

module.exports = new MassConcreteStressService()
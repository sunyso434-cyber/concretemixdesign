/**
 * 蓄温水养护计算服务
 */
class WaterRetentionService {
  static RHO_W = 1000      // 水的密度 kg/m³
  static C_W = 4.18        // 水的比热 kJ/(kg·K)
  static HEAT_LOSS_RATE = 0.05 // 热量损失率 /h

  /**
   * 计算混凝土总放热量
   * Q = V × ρ × c × ΔT
   */
  static calculateTotalHeatRelease(volume, adiabaticTempRise) {
    const rho = 2400 // 混凝土密度 kg/m³
    const c = 0.97   // 混凝土比热 kJ/(kg·K)
    return volume * rho * c * adiabaticTempRise / 1000 // kJ
  }

  /**
   * 计算所需蓄水池容积
   * V = Q / (ρ_w × c_w × ΔT_w)
   */
  calculatePoolVolume(params) {
    const { concreteVolume, maxConcreteTemp, targetWaterTemp, adiabaticTempRise } = params

    const Q = WaterRetentionService.calculateTotalHeatRelease(concreteVolume, adiabaticTempRise)
    const deltaT = maxConcreteTemp - targetWaterTemp

    if (deltaT <= 0) {
      throw new Error('混凝土最高温度应大于目标水温')
    }

    const V = Q / (WaterRetentionService.RHO_W * WaterRetentionService.C_W * deltaT)
    return Math.ceil(V * 10) / 10
  }

  /**
   * 计算初始水温
   * T_w0 = T_c_max - δT_target + ΔT_safety
   */
  static calculateInitialWaterTemp(maxConcreteTemp, targetTempDiff, safetyMargin = 3) {
    return maxConcreteTemp - targetTempDiff + safetyMargin
  }

  /**
   * 计算换水周期
   */
  calculateReplaceInterval(params) {
    const { concreteVolume, poolVolume, maxConcreteTemp, targetWaterTemp, adiabaticTempRise } = params

    const Q = WaterRetentionService.calculateTotalHeatRelease(concreteVolume, adiabaticTempRise)
    const deltaT = maxConcreteTemp - targetWaterTemp
    const heatCapacity = WaterRetentionService.RHO_W * WaterRetentionService.C_W * poolVolume * deltaT

    if (Q <= heatCapacity) {
      return 24 * 7 // 热量足够，一周换一次
    }

    const k = WaterRetentionService.HEAT_LOSS_RATE
    const tau = Math.log(Q / (Q - heatCapacity)) / k

    return Math.round(tau * 10) / 10
  }

  /**
   * 计算加热负荷
   */
  static calculateHeatingLoad(poolVolume, tempRise, heatingHours = 12) {
    const Q = WaterRetentionService.RHO_W * WaterRetentionService.C_W * poolVolume * tempRise
    return Q / heatingHours / 3600 // kW
  }

  /**
   * 蓄温水养护计算主方法
   */
  calculate(params) {
    const {
      concreteVolume,
      surfaceArea,
      maxConcreteTemp,
      targetWaterTemp,
      ambientTemp,
      waterDepth = 0.5,
      heatingMethod = 'electric'
    } = params

    // 基础温度参数
    const targetTempDiff = maxConcreteTemp - targetWaterTemp
    const safetyMargin = 3
    const adiabaticTempRise = maxConcreteTemp - 20 // 假设入模温度20°C

    // 1. 计算蓄水池容积
    const poolVolume = this.calculatePoolVolume({
      concreteVolume,
      maxConcreteTemp,
      targetWaterTemp,
      adiabaticTempRise
    })

    // 2. 计算初始水温
    const initialWaterTemp = WaterRetentionService.calculateInitialWaterTemp(
      maxConcreteTemp,
      targetTempDiff,
      safetyMargin
    )

    // 3. 计算换水周期
    const replaceInterval = this.calculateReplaceInterval({
      concreteVolume,
      poolVolume,
      maxConcreteTemp,
      targetWaterTemp,
      adiabaticTempRise
    })

    // 4. 计算加热负荷
    const tempRise = Math.max(0, maxConcreteTemp - ambientTemp)
    const heatingLoad = WaterRetentionService.calculateHeatingLoad(poolVolume, tempRise)

    // 5. 生成建议
    const recommendations = []
    if (poolVolume > 50) {
      recommendations.push('蓄水池容量较大，建议分区域蓄水')
    }
    if (heatingMethod === 'electric') {
      recommendations.push('电加热成本较高，建议采用蒸汽加热或太阳能预热')
    }
    if (replaceInterval < 12) {
      recommendations.push('换水周期较短，需配置备用蓄水设施')
    }
    if (surfaceArea && waterDepth) {
      const waterAmount = surfaceArea * waterDepth
      if (waterAmount > poolVolume) {
        recommendations.push(`蓄水量(${waterAmount.toFixed(1)}m³)超过池容，需增加蓄水面积或深度`)
      }
    }

    return {
      poolVolume: Math.round(poolVolume * 100) / 100,
      initialWaterTemp: Math.round(initialWaterTemp * 10) / 10,
      replaceInterval: Math.round(replaceInterval * 10) / 10,
      heatingLoad: Math.round(heatingLoad * 100) / 100,
      recommendations
    }
  }
}

module.exports = new WaterRetentionService()
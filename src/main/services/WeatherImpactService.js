/**
 * 气象条件影响评估服务
 */
class WeatherImpactService {
  // 获取表面传热系数
  static getBetaT(windSpeed, surfaceRoughness = 'smooth') {
    const BETA_T = {
      0: { verySmooth: 12.5, smooth: 14.0, rough: 18.0 },
      5: { verySmooth: 22.0, smooth: 25.5, rough: 32.0 },
      10: { verySmooth: 32.0, smooth: 38.0, rough: 47.0 }
    }

    if (windSpeed <= 0) return BETA_T[0][surfaceRoughness]
    if (windSpeed >= 10) return BETA_T[10][surfaceRoughness]

    const t = windSpeed / 5
    const lower = BETA_T[Math.floor(t) * 5] || BETA_T[0]
    const upper = BETA_T[Math.ceil(t) * 5] || BETA_T[10]
    const frac = t - Math.floor(t)

    return (1 - frac) * lower[surfaceRoughness] + frac * upper[surfaceRoughness]
  }

  /**
   * 日照影响系数
   * K_sun = 1 + α_sun × I_sun / β
   */
  static calculateSunFactor(solarRadiation, windSpeed, surfaceRoughness = 'smooth') {
    const alphaSun = 0.6 // 日照吸收率
    const beta = WeatherImpactService.getBetaT(windSpeed, surfaceRoughness)
    return 1 + alphaSun * solarRadiation / beta
  }

  /**
   * 大风预警评估
   */
  static evaluateWindAlert(windSpeed) {
    if (windSpeed < 6) return { level: 'green', message: '风力正常，可正常施工' }
    if (windSpeed < 8) return { level: 'yellow', message: '注意高空作业安全' }
    if (windSpeed < 12) return { level: 'orange', message: '停止高空作业，加强保温层固定' }
    return { level: 'red', message: '停止一切露天作业，采取防风措施' }
  }

  /**
   * 寒潮预警评估
   */
  static evaluateColdWaveAlert(tempDrop, hours = 48) {
    if (hours <= 24) {
      if (tempDrop < 8) return { level: 'yellow', message: '24h内降温6-8°C，注意保温' }
      return { level: 'orange', message: '24h内降温超过8°C，紧急加强保温' }
    } else {
      if (tempDrop < 6) return { level: 'green', message: '48h内降温较小' }
      if (tempDrop < 8) return { level: 'blue', message: '48h内降温6-8°C，发布寒潮蓝色预警' }
      if (tempDrop < 10) return { level: 'yellow', message: '48h内降温8-10°C，发布寒潮黄色预警' }
      return { level: 'orange', message: '48h内降温超过10°C，发布寒潮橙色预警' }
    }
  }

  /**
   * 气象影响评估主方法
   */
  evaluate(params) {
    const {
      weather = {},
      alertThresholds = {}
    } = params

    const {
      temperature = 15,
      windSpeed = 0,
      solarRadiation = 0,
      humidity = 70,
      cloudCover = 5
    } = weather

    // 1. 计算修正系数
    const sunFactor = WeatherImpactService.calculateSunFactor(solarRadiation, windSpeed)
    const windFactor = 1 + windSpeed * 0.02

    // 2. 评估预警
    const windAlert = WeatherImpactService.evaluateWindAlert(windSpeed)
    const tempDrop = alertThresholds.tempDrop || 8
    const hours = alertThresholds.hours || 48
    const coldWaveAlert = WeatherImpactService.evaluateColdWaveAlert(tempDrop, hours)

    // 3. 生成措施建议
    const measures = []
    if (windAlert.level !== 'green') {
      const levelText = { yellow: '黄色', orange: '橙色', red: '红色' }
      measures.push(`【${levelText[windAlert.level] || windAlert.level}大风预警】${windAlert.message}`)
    }
    if (coldWaveAlert.level !== 'green' && coldWaveAlert.level !== 'blue') {
      const levelText = { blue: '蓝色', yellow: '黄色', orange: '橙色' }
      measures.push(`【寒潮${levelText[coldWaveAlert.level] || ''}预警】${coldWaveAlert.message}`)
    }
    if (cloudCover < 3) {
      measures.push('晴天太阳辐射强，注意表面温升')
    }
    if (temperature < 5) {
      measures.push('环境温度低于5°C，需采取冬季施工措施')
    }
    if (solarRadiation > 800) {
      measures.push('高辐射强度天气，注意防晒和降温')
    }

    return {
      coefficients: {
        sunFactor: Math.round(sunFactor * 100) / 100,
        windFactor: Math.round(windFactor * 100) / 100
      },
      alerts: [
        { type: 'wind', ...windAlert },
        { type: 'cold_wave', ...coldWaveAlert }
      ],
      measures
    }
  }
}

module.exports = new WeatherImpactService()
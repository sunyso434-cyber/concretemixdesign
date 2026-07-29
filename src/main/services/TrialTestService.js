const { TrialTestRecord } = require('../db/models/TrialTestRecord')
const XGBoostPredictionService = require('./XGBoostPredictionService')

class TrialTestService {
  /**
   * 创建试配记录，自动计算预测偏差
   * @param {Object} data - 试配数据（字段名与 TrialTestRecord 模型一致）
   */
  async createRecord(data) {
    let deviation = null
    try {
      const predicted = await XGBoostPredictionService.predict({
        waterBinderRatio: data.water_binder_ratio,
        cementAmount: data.cement_amount,
        flyAshDosage: data.fly_ash_dosage,
        slagDosage: data.slag_dosage,
        lithiumSlagDosage: data.lithium_slag_dosage,
        compositePowderDosage: data.composite_powder_dosage,
        sandRatio: data.sand_ratio,
        superplasticizerDosage: data.superplasticizer_dosage,
        slump: data.slump
      })

      if (predicted.success && predicted.predictions) {
        const strengthPred = predicted.predictions.strength28d?.value
        const densityPred = predicted.predictions.density?.value

        deviation = {
          version: '1.1',
          strengthPredicted: strengthPred,
          strengthActual: data.trialTestedStrength,
          strengthDeviation: data.trialTestedStrength - strengthPred,
          strengthDeviationPct: strengthPred
            ? ((data.trialTestedStrength - strengthPred) / strengthPred * 100)
            : null,
          slumpDesigned: data.slump,
          slumpActual: data.trialTestedSlump,
          slumpDeviation: data.trialTestedSlump - (data.slump || 0),
          densityPredicted: densityPred,
          densityActual: data.trialTestedDensity,
          analyzedAt: new Date().toISOString()
        }
      }
    } catch (e) {
      console.error('[TrialTest] 偏差分析失败:', e.message)
    }

    const record = await TrialTestRecord.create({
      ...data,
      deviationAnalysis: deviation
    })

    return { record, deviation }
  }

  /**
   * 查询试配记录列表
   * @param {string} [status] - 按状态筛选（已试配/已复核/驳回）
   */
  async listRecords(status) {
    const where = status ? { trialStatus: status } : {}
    return await TrialTestRecord.findAll({
      where,
      order: [['trialTestDate', 'DESC']]
    })
  }

  /**
   * 获取单条试配记录
   * @param {number} id - 记录ID
   */
  async getRecord(id) {
    return await TrialTestRecord.findByPk(id)
  }
}

module.exports = new TrialTestService()

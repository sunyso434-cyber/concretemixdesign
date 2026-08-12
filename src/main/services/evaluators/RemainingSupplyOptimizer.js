// src/main/services/evaluators/RemainingSupplyOptimizer.js
const { DailyPlan, VehicleDetail, CapacityConfig } = require('../../db/database')
const { calcAvgCapacity, calcPlanTrips, calcTripInterval } = require('./planEvaluatorUtils')

class RemainingSupplyOptimizer {
  /**
   * 场景B：滚动优化建议（spec 6.5~6.7）
   */
  async optimize(date, branchId = null) {
    const where = { planDate: date }
    if (branchId) where.branchId = branchId
    const plans = await DailyPlan.findAll({ where, order: [['plannedSendTime', 'ASC']] })
    if (plans.length === 0) {
      const err = new Error('无计划可评估')
      err.code = 'E-EVAL-001'
      throw err
    }

    const allConfigs = await CapacityConfig.findAll()
    const configsMap = {}
    for (const c of allConfigs) configsMap[c.id] = c.toJSON()

    const perPlan = []
    let onTrack = 0, atRisk = 0, delayed = 0, overBudget = 0
    const overallRisks = []

    for (const planRow of plans) {
      const plan = planRow.toJSON()
      const config = configsMap[plan.branchId]

      const vehicles = await VehicleDetail.findAll({
        where: { planId: plan.id },
        order: [['productionTime', 'ASC']]
      })
      const vData = vehicles.map(v => v.toJSON())

      if (vData.length === 0) {
        // 无车次数据，跳过（场景B需要车次）
        continue
      }

      const executedVolume = vData.reduce((s, v) => s + (v.volume || 0), 0)
      const remaining = Math.max(0, plan.volume - executedVolume)
      const isOverBudget = executedVolume > plan.volume
      if (isOverBudget) overBudget++

      // 6.5 节奏推算
      const pace = this._calcPace(vData)

      // 6.6 发料时间修正
      const sendTimeFix = this._calcSendTimeFix(plan, vData, config)

      // 6.7 剩余风险
      const remainingRisk = this._calcRemainingRisk(plan, executedVolume, remaining, pace, config)

      let advice = ''
      if (pace.paceStatus === 'paceUnknown') {
        advice = '车次不足，暂无法推算节奏，建议继续观察'
      } else if (sendTimeFix.actualInterval > sendTimeFix.plannedInterval * 1.2) {
        advice = `发料间隔偏慢(实际${sendTimeFix.actualInterval.toFixed(1)}h vs 计划${sendTimeFix.plannedInterval.toFixed(1)}h)，工地可能等料，建议加快发料`
        atRisk++
      } else if (sendTimeFix.actualInterval < sendTimeFix.plannedInterval * 0.8) {
        advice = `发料间隔偏快(实际${sendTimeFix.actualInterval.toFixed(1)}h vs 计划${sendTimeFix.plannedInterval.toFixed(1)}h)，可能压车，建议放慢发料`
        atRisk++
      } else if (!remainingRisk.canFinishOnTime) {
        advice = `剩余${remaining}方，按当前节奏需${remainingRisk.remainingHoursNeeded}h，超预计，建议增加运力或调整发料时间`
        delayed++
      } else {
        advice = '进度正常'
        onTrack++
      }

      perPlan.push({
        planId: plan.id,
        projectName: plan.projectName,
        strengthGrade: plan.strengthGrade,
        totalVolume: plan.volume,
        executedVolume,
        remaining,
        overBudget: isOverBudget,
        vehicleCount: vData.length,
        pace_m3h: pace.paceM3h,
        paceStatus: pace.paceStatus,
        plannedSendTime: plan.plannedSendTime,
        actualFirstTime: vData[0] ? vData[0].productionTime : null,
        delay: sendTimeFix.delay,
        plannedInterval: sendTimeFix.plannedInterval,
        actualInterval: sendTimeFix.actualInterval,
        suggestedNextTime: sendTimeFix.suggestedNextTime,
        canFinishOnTime: remainingRisk.canFinishOnTime,
        remainingRisk: remainingRisk.risk,
        advice
      })
    }

    if (perPlan.length === 0) {
      const err = new Error('无车次数据(场景B需要)')
      err.code = 'E-EVAL-002'
      throw err
    }

    return {
      perPlan,
      overallRisks,
      summary: {
        totalPlans: plans.length,
        onTrackPlans: onTrack,
        atRiskPlans: atRisk,
        delayedPlans: delayed,
        overBudgetPlans: overBudget
      }
    }
  }

  /**
   * 节奏推算（spec 6.5）
   * ★ pace = (累计方量 - 首车方量) / 总间隔时间
   */
  _calcPace(vehicles) {
    if (vehicles.length < 2) return { paceM3h: null, paceStatus: 'paceUnknown' }

    // 排除间隔异常大的车次(>2小时)
    // 间隔计算走 _timeDiffMin（下方定义）

    // 取连续段
    const segments = [[vehicles[0]]]
    for (let i = 1; i < vehicles.length; i++) {
      const prev = vehicles[i - 1]
      const curr = vehicles[i]
      const gap = this._timeDiffMin(prev.productionDate, prev.productionTime, curr.productionDate, curr.productionTime)
      if (gap > 120) {
        segments.push([curr])
      } else {
        segments[segments.length - 1].push(curr)
      }
    }
    // 取最长的连续段
    const longest = segments.reduce((longest, s) => s.length > longest.length ? s : longest, segments[0])
    if (longest.length < 2) return { paceM3h: null, paceStatus: 'paceUnknown' }

    const first = longest[0]
    const last = longest[longest.length - 1]
    const totalIntervalHours = this._timeDiffMin(first.productionDate, first.productionTime, last.productionDate, last.productionTime) / 60
    if (totalIntervalHours <= 0) return { paceM3h: null, paceStatus: 'paceUnknown' }

    const cumulativeVolume = longest.reduce((s, v) => s + (v.volume || 0), 0)
    const firstVolume = first.volume || 0
    // ★ 修正公式：分子分母对齐到 n-1 个间隔
    const paceM3h = (cumulativeVolume - firstVolume) / totalIntervalHours
    return { paceM3h: Math.round(paceM3h * 10) / 10, paceStatus: 'paceKnown' }
  }

  _timeDiffMin(date1, time1, date2, time2) {
    const d1 = new Date(`${date1} ${time1}`)
    const d2 = new Date(`${date2} ${time2}`)
    return (d2 - d1) / 60000
  }

  /**
   * 发料时间修正（spec 6.6）
   */
  _calcSendTimeFix(plan, vehicles, config) {
    const avgCapacity = config ? calcAvgCapacity(config) : 8
    const planTrips = calcPlanTrips(plan.volume, avgCapacity)
    const plannedInterval = calcTripInterval(plan.expectedDuration, planTrips)

    const [ph, pm] = plan.plannedSendTime.split(':').map(Number)
    const plannedMinute = ph * 60 + pm

    let delay = 0
    let actualFirstTime = null
    if (vehicles.length > 0) {
      const [ah, am] = vehicles[0].productionTime.split(':').map(Number)
      const actualMinute = ah * 60 + am
      actualFirstTime = vehicles[0].productionTime
      delay = (actualMinute - plannedMinute) / 60 // 小时
    }

    // 实际车次间隔（最近3-5车）
    let actualInterval = plannedInterval
    if (vehicles.length >= 2) {
      const recent = vehicles.slice(-5)
      const intervals = []
      for (let i = 1; i < recent.length; i++) {
        const diff = this._timeDiffMin(recent[i - 1].productionDate, recent[i - 1].productionTime, recent[i].productionDate, recent[i].productionTime) / 60
        intervals.push(diff)
      }
      actualInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length
    }

    // 后续建议发料时间
    let suggestedNextTime = null
    if (vehicles.length > 0) {
      const last = vehicles[vehicles.length - 1]
      const lastDate = new Date(`${last.productionDate} ${last.productionTime}`)
      lastDate.setMinutes(lastDate.getMinutes() + actualInterval * 60)
      suggestedNextTime = lastDate.toTimeString().slice(0, 5)
    }

    return {
      plannedSendTime: plan.plannedSendTime,
      actualFirstTime,
      delay: Math.round(delay * 10) / 10,
      plannedInterval: Math.round(plannedInterval * 100) / 100,
      actualInterval: Math.round(actualInterval * 100) / 100,
      suggestedNextTime
    }
  }

  /**
   * 剩余风险（spec 6.7）
   */
  _calcRemainingRisk(plan, executedVolume, remaining, pace, config) {
    if (remaining === 0) {
      return { canFinishOnTime: true, risk: 'none', remainingHoursNeeded: 0 }
    }
    if (pace.paceStatus !== 'paceKnown' || !pace.paceM3h) {
      return { canFinishOnTime: true, risk: 'unknown', remainingHoursNeeded: null }
    }

    const remainingHoursNeeded = remaining / pace.paceM3h
    // 已用时间
    const [ph, pm] = plan.plannedSendTime.split(':').map(Number)
    const elapsedHours = (Date.now() - new Date(`${plan.planDate} ${plan.plannedSendTime}`).getTime()) / 3600000
    const remainingTimeAvailable = plan.expectedDuration - Math.max(0, elapsedHours)

    const canFinish = remainingHoursNeeded <= remainingTimeAvailable
    return {
      canFinishOnTime: canFinish,
      risk: canFinish ? 'low' : 'delay',
      remainingHoursNeeded: Math.round(remainingHoursNeeded * 10) / 10
    }
  }
}

module.exports = new RemainingSupplyOptimizer()
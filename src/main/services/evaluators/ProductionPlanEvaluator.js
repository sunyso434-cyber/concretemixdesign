// src/main/services/evaluators/ProductionPlanEvaluator.js
const { DailyPlan, CapacityConfig, ProjectDistance, MixDesign } = require('../../db/database')
const { calcAvgCapacity, calcPlanTrips, calcTripInterval, calcTripSendMinute, buildVehiclePool } = require('./planEvaluatorUtils')

class ProductionPlanEvaluator {
  /**
   * 场景A：计划合理性评估（spec 6.1~6.4）
   */
  async evaluate(date, branchId = null) {
    const plans = await this._getPlans(date, branchId)
    if (plans.length === 0) {
      const err = new Error('无计划可评估')
      err.code = 'E-EVAL-001'
      throw err
    }

    const allConfigs = await CapacityConfig.findAll()
    const configsMap = {}
    for (const c of allConfigs) configsMap[c.id] = c.toJSON()

    const skippedBranches = []
    const branchIds = [...new Set(plans.map(p => p.branchId))]
    for (const bid of branchIds) {
      if (!configsMap[bid]) {
        skippedBranches.push({ branchId: bid, reason: '产能配置缺失' })
      }
    }

    const capacityWarnings = []
    const transportWarnings = []
    for (const bid of branchIds) {
      if (!configsMap[bid]) continue
      const branchPlans = plans.filter(p => p.branchId === bid)
      const config = configsMap[bid]

      const capWarn = this._calcCapacityWarning(branchPlans, config)
      if (capWarn) capacityWarnings.push(capWarn)

      const transWarn = await this._calcTransportWarning(branchPlans, config)
      if (transWarn) transportWarnings.push(transWarn)
    }

    const transportCostOptimizations = await this._calcCostOptimizations(plans, configsMap, capacityWarnings, transportWarnings)

    const comprehensiveSuggestions = this._calcComprehensiveSuggestions(plans, capacityWarnings, transportWarnings, transportCostOptimizations)

    const riskPlans = [...capacityWarnings, ...transportWarnings].filter(w => w.riskLevel === '红').length
    return {
      capacityWarnings,
      transportWarnings,
      transportCostOptimizations,
      comprehensiveSuggestions,
      skippedBranches,
      summary: {
        totalPlans: plans.length,
        riskPlans,
        overallRiskLevel: riskPlans > 0 ? '红' : (capacityWarnings.some(w => w.riskLevel === '黄') ? '黄' : '绿')
      }
    }
  }

  /**
   * 产能预警（spec 6.1）
   */
  _calcCapacityWarning(plans, config) {
    const maxCapacity = config.lineCount * config.c30Efficiency
    const buckets = {} // "HH:00" → load

    for (const plan of plans) {
      const coeff = (config.mixCoefficients && config.mixCoefficients[plan.strengthGrade]) || 1.0
      const equivVolume = plan.volume * coeff
      const durationHours = plan.expectedDuration
      const hourlyLoad = equivVolume / durationHours

      const [sh, sm] = plan.plannedSendTime.split(':').map(Number)
      const startMinute = sh * 60 + sm
      const endMinute = startMinute + durationHours * 60

      // 分摊到小时桶
      for (let b = Math.floor(startMinute / 60); b <= Math.floor(endMinute / 60); b++) {
        const bucketStart = b * 60
        const bucketEnd = (b + 1) * 60
        const overlapStart = Math.max(startMinute, bucketStart)
        const overlapEnd = Math.min(endMinute, bucketEnd)
        const overlap = overlapEnd - overlapStart
        if (overlap > 0) {
          const bucketKey = `${String(b).padStart(2, '0')}:00`
          const fraction = overlap / 60
          buckets[bucketKey] = (buckets[bucketKey] || 0) + hourlyLoad * fraction
        }
      }
    }

    let peakHour = null
    let peakLoad = 0
    for (const [hour, load] of Object.entries(buckets)) {
      if (load > peakLoad) { peakLoad = load; peakHour = hour }
    }

    const overloadPercent = maxCapacity > 0 ? ((peakLoad - maxCapacity) / maxCapacity) * 100 : 0
    let riskLevel = '绿'
    if (overloadPercent > 20) riskLevel = '红'
    else if (overloadPercent > 5) riskLevel = '黄'

    return {
      branchId: config.id,
      branchName: config.branchName,
      peakHour, peakLoad, maxCapacity,
      overloadPercent: Math.round(overloadPercent * 10) / 10,
      riskLevel
    }
  }

  /**
   * 运力预警（spec 6.2 车辆调度模拟器）
   */
  async _calcTransportWarning(plans, config) {
    const pool = buildVehiclePool(config)
    const avgCapacity = calcAvgCapacity(config)
    const loadTime = config.loadTimeMin
    const unloadTime = config.unloadTimeMin

    const allTrips = []
    const skippedPlans = []

    for (const plan of plans) {
      const dist = await ProjectDistance.findOne({
        where: { projectName: plan.projectName, branchId: plan.branchId }
      })
      if (!dist) {
        skippedPlans.push({ planId: plan.id, projectName: plan.projectName, reason: '无距离记录' })
        continue
      }

      let transportMin = dist.baseTransportMin
      // 高峰判断
      const [ph, pm] = plan.plannedSendTime.split(':').map(Number)
      const sendMinute = ph * 60 + pm
      if (this._isPeak(sendMinute, dist)) {
        transportMin = Math.round(transportMin * dist.peakFactor)
      }
      const tripTotalMin = loadTime + transportMin * 2 + unloadTime

      const planTrips = calcPlanTrips(plan.volume, avgCapacity)
      const interval = calcTripInterval(plan.expectedDuration, planTrips)

      for (let i = 0; i < planTrips; i++) {
        const sendMinute = calcTripSendMinute(plan.plannedSendTime, i, interval)
        allTrips.push({ planId: plan.id, sendMinute, tripTotalMin })
      }
    }

    // 按发车时间排序
    allTrips.sort((a, b) => a.sendMinute - b.sendMinute)

    const delayedTrips = []
    let maxDelay = 0
    let totalDelay = 0

    for (const trip of allTrips) {
      // 找一辆 availableFrom <= sendMinute 的（按单价升序，pool已排序）
      let assigned = null
      for (const v of pool) {
        if (v.availableFrom <= trip.sendMinute) { assigned = v; break }
      }
      if (!assigned) {
        // 找最早可用的，延后分配
        assigned = pool.reduce((earliest, v) => v.availableFrom < earliest.availableFrom ? v : earliest, pool[0])
        const delay = assigned.availableFrom - trip.sendMinute
        if (delay > 0) {
          delayedTrips.push({ planId: trip.planId, delayMin: delay })
          totalDelay += delay
          if (delay > maxDelay) maxDelay = delay
        }
        assigned.availableFrom = assigned.availableFrom + trip.tripTotalMin
      } else {
        assigned.availableFrom = trip.sendMinute + trip.tripTotalMin
      }
    }

    let riskLevel = '绿'
    if (maxDelay > 30) riskLevel = '红'
    else if (maxDelay > 10) riskLevel = '黄'

    return {
      branchId: config.id,
      branchName: config.branchName,
      demandTrips: allTrips.length,
      assignedTrips: allTrips.length,
      totalDelayMin: totalDelay,
      maxDelayMin: maxDelay,
      delayedTrips,
      skippedPlans,
      riskLevel
    }
  }

  _isPeak(sendMinute, dist) {
    if (!dist.peakStart1) return false
    const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
    const p1s = toMin(dist.peakStart1), p1e = toMin(dist.peakEnd1)
    const p2s = toMin(dist.peakStart2), p2e = toMin(dist.peakEnd2)
    return (sendMinute >= p1s && sendMinute <= p1e) || (sendMinute >= p2s && sendMinute <= p2e)
  }

  /**
   * 单方总成本对比（spec 6.3，v0.8.1 修订）
   * v0.8.1：成本=材料成本+运输成本，统一用各分公司 C30 基准配合比方案
   * - 材料成本：CapacityConfig.c30BaselineMixDesignId → MixDesign.totalCost
   * - 运输成本：ProjectDistance.distanceKm × 该站最便宜车型单价
   * 跳过条件：未绑C30基准配合比 / 无距离记录 / 产能运力红色
   */
  async _calcCostOptimizations(plans, configsMap, capWarnings, transWarnings) {
    // 批量预查各分公司 C30 基准配合比的 totalCost，避免重复查询
    const mixDesignIds = new Set()
    for (const cfg of Object.values(configsMap)) {
      if (cfg.c30BaselineMixDesignId) mixDesignIds.add(cfg.c30BaselineMixDesignId)
    }
    const mixCostMap = {} // mixDesignId → totalCost
    if (mixDesignIds.size > 0) {
      const mixRows = await MixDesign.findAll({
        where: { id: Array.from(mixDesignIds) },
        attributes: ['id', 'totalCost', 'strength']
      })
      for (const m of mixRows) {
        mixCostMap[m.id] = { totalCost: m.totalCost || 0, strength: m.strength }
      }
    }

    const results = []
    for (const plan of plans) {
      const config = configsMap[plan.branchId]
      if (!config) continue

      // 当前站成本
      const curDist = await ProjectDistance.findOne({
        where: { projectName: plan.projectName, branchId: plan.branchId }
      })
      if (!curDist) continue

      const curMaterialCost = this._getC30MaterialCost(config, mixCostMap)
      if (curMaterialCost === null) {
        // 当前站未绑C30基准配合比，该计划不参与成本对比
        results.push({
          planId: plan.id,
          projectName: plan.projectName,
          strengthGrade: plan.strengthGrade,
          volume: plan.volume,
          currentBranch: config.branchName,
          currentMaterialCostPerM3: null,
          currentTransportCostPerM3: null,
          currentTotalCostPerM3: null,
          alternatives: [],
          skippedBranches: [{ branchId: plan.branchId, reason: '当前站未绑定C30基准配合比' }]
        })
        continue
      }

      const curPool = buildVehiclePool(config)
      const curPrice = curPool.length > 0 ? curPool[0].price : 0
      const curTransportCost = curDist.distanceKm * curPrice
      const curTotalCost = curMaterialCost + curTransportCost

      const alternatives = []
      const skippedBranches = []

      for (const [bid, altConfig] of Object.entries(configsMap)) {
        const altBid = Number(bid)
        if (altBid === plan.branchId) continue

        const altDist = await ProjectDistance.findOne({
          where: { projectName: plan.projectName, branchId: altBid }
        })
        if (!altDist) {
          skippedBranches.push({ branchId: altBid, reason: '无距离记录' })
          continue
        }

        const altMaterialCost = this._getC30MaterialCost(altConfig, mixCostMap)
        if (altMaterialCost === null) {
          skippedBranches.push({ branchId: altBid, reason: '未绑定C30基准配合比' })
          continue
        }

        const altPool = buildVehiclePool(altConfig)
        const altPrice = altPool.length > 0 ? altPool[0].price : 0
        const altTransportCost = altDist.distanceKm * altPrice
        const altTotalCost = altMaterialCost + altTransportCost
        const savingPerM3 = curTotalCost - altTotalCost

        if (savingPerM3 > 0) {
          // 检查目标站产能/运力
          const capOk = this._isCapacityAvailable(altBid, capWarnings)
          const transOk = this._isTransportAvailable(altBid, transWarnings)
          if (capOk && transOk) {
            alternatives.push({
              branchId: altBid,
              branchName: altConfig.branchName,
              materialCostPerM3: Math.round(altMaterialCost * 100) / 100,
              transportCostPerM3: Math.round(altTransportCost * 100) / 100,
              totalCostPerM3: Math.round(altTotalCost * 100) / 100,
              savingPerM3: Math.round(savingPerM3 * 100) / 100
            })
          } else {
            skippedBranches.push({ branchId: altBid, reason: '产能/运力不足' })
          }
        }
      }

      alternatives.sort((a, b) => b.savingPerM3 - a.savingPerM3)
      results.push({
        planId: plan.id,
        projectName: plan.projectName,
        strengthGrade: plan.strengthGrade,
        volume: plan.volume,
        currentBranch: config.branchName,
        currentMaterialCostPerM3: Math.round(curMaterialCost * 100) / 100,
        currentTransportCostPerM3: Math.round(curTransportCost * 100) / 100,
        currentTotalCostPerM3: Math.round(curTotalCost * 100) / 100,
        alternatives,
        skippedBranches
      })
    }
    return results
  }

  /**
   * 从配置中取 C30 基准配合比的材料成本（每方）
   * @returns {number|null} null 表示未绑定或配合比已删除
   */
  _getC30MaterialCost(config, mixCostMap) {
    if (!config.c30BaselineMixDesignId) return null
    const mix = mixCostMap[config.c30BaselineMixDesignId]
    if (!mix) return null
    // 防御性检查：配合比标号被改后保险（理论上服务层已校验）
    if (mix.strength !== 'C30') return null
    return mix.totalCost
  }

  _isCapacityAvailable(branchId, capWarnings) {
    const w = capWarnings.find(w => w.branchId === branchId)
    return !w || w.riskLevel === '绿'
  }

  _isTransportAvailable(branchId, transWarnings) {
    const w = transWarnings.find(w => w.branchId === branchId)
    return !w || w.riskLevel === '绿'
  }

  /**
   * 综合建议（spec 6.4）
   */
  _calcComprehensiveSuggestions(plans, capWarnings, transWarnings, costOpts) {
    const suggestions = []
    for (const plan of plans) {
      const planSuggestions = []
      const capW = capWarnings.find(w => w.branchId === plan.branchId)
      const transW = transWarnings.find(w => w.branchId === plan.branchId)
      const costOpt = costOpts.find(c => c.planId === plan.id)

      if (capW && capW.riskLevel === '红') {
        const alt = costOpt && costOpt.alternatives.find(a =>
          this._isCapacityAvailable(a.branchId, capWarnings)
        )
        if (alt) {
          planSuggestions.push({
            type: 'change_branch',
            from: plan.branchId,
            to: alt.branchId,
            reason: `当前站产能超载${capW.overloadPercent}%，建议改派到${alt.branchName}`,
            priority: 'high'
          })
        }
      }

      if (transW && transW.maxDelayMin > 30) {
        planSuggestions.push({
          type: 'adjust_time',
          from: plan.plannedSendTime,
          to: '错峰发料',
          reason: `当前站运力延误最高${transW.maxDelayMin}分钟，建议错峰发料或改派`,
          priority: 'medium'
        })
      }

      if (costOpt && costOpt.alternatives.length > 0 && costOpt.alternatives[0].savingPerM3 > 5) {
        const alt = costOpt.alternatives[0]
        if (this._isCapacityAvailable(alt.branchId, capWarnings) &&
            this._isTransportAvailable(alt.branchId, transWarnings)) {
          planSuggestions.push({
            type: 'change_branch',
            from: plan.branchId,
            to: alt.branchId,
            reason: `改派到${alt.branchName}每方可省${alt.savingPerM3}元`,
            priority: 'low'
          })
        }
      }

      if (planSuggestions.length > 0) {
        suggestions.push({ planId: plan.id, projectName: plan.projectName, suggestions: planSuggestions })
      }
    }
    return suggestions
  }

  async _getPlans(date, branchId) {
    const where = { planDate: date }
    if (branchId) where.branchId = branchId
    const rows = await DailyPlan.findAll({ where, order: [['plannedSendTime', 'ASC']] })
    return rows.map(r => r.toJSON())
  }
}

module.exports = new ProductionPlanEvaluator()

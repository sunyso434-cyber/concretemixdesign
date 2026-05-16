const MaterialService = require('./MaterialService')

class AnalysisPreprocessor {
  async preprocess(classification, mixDesigns, materialMapping) {
    const result = {}
    if (classification.modes.includes('param_trend')) {
      result.trend = this._preprocessTrend(mixDesigns, classification.param_trend)
    }
    if (classification.modes.includes('material_contrast')) {
      result.contrast = await this._preprocessContrast(mixDesigns, materialMapping, classification.material_contrast)
    }
    return result
  }

  _linearRegression(xValues, yValues) {
    const n = xValues.length
    if (n < 2) return null

    const sumX = xValues.reduce((s, v) => s + v, 0)
    const sumY = yValues.reduce((s, v) => s + v, 0)
    const sumXY = xValues.reduce((s, x, i) => s + x * yValues[i], 0)
    const sumX2 = xValues.reduce((s, v) => s + v * v, 0)

    const denominator = n * sumX2 - sumX * sumX
    if (Math.abs(denominator) < 1e-10) return null

    const a = (n * sumXY - sumX * sumY) / denominator
    const b = (sumY - a * sumX) / n

    const meanY = sumY / n
    const ssRes = yValues.reduce((s, yi, i) => {
      const pred = a * xValues[i] + b
      return s + (yi - pred) * (yi - pred)
    }, 0)
    const ssTot = yValues.reduce((s, yi) => s + (yi - meanY) * (yi - meanY), 0)
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1

    return { a, b, r2 }
  }

  _preprocessTrend(mixDesigns, paramTrend) {
    const varyingParams = paramTrend.varying_params
    const performanceFields = [
      'strengthR3', 'strengthR7', 'strengthR28', 'strengthR60',
      'initialSlump', 'initialSlumpFlow', 'initialT500',
      'slump1h', 'slumpFlow1h', 't5001h',
      'slump2h', 'slumpFlow2h', 't5002h',
      'apparentDensity'
    ]

    const regressions = []
    const chartData = {}

    for (const param of varyingParams) {
      const paramValues = mixDesigns.map(m => this._getParamValue(m, param))

      for (const perf of performanceFields) {
        const perfValues = mixDesigns.map(m => this._getPerformanceValue(m, perf))

        const pairs = []
        for (let i = 0; i < paramValues.length; i++) {
          if (paramValues[i] !== null && perfValues[i] !== null) {
            pairs.push({ x: paramValues[i], y: perfValues[i] })
          }
        }

        if (pairs.length < 2) continue

        const xVals = pairs.map(p => p.x)
        const yVals = pairs.map(p => p.y)
        const reg = this._linearRegression(xVals, yVals)

        if (reg) {
          regressions.push({
            param,
            performance: perf,
            equation: `y = ${reg.a.toFixed(4)}x + ${reg.b.toFixed(2)}`,
            slope: reg.a,
            intercept: reg.b,
            r2: reg.r2
          })
        }

        const key = `${param}__${perf}`
        chartData[key] = pairs
      }
    }

    const sensitivityMap = {}
    for (const reg of regressions) {
      if (!sensitivityMap[reg.param]) {
        sensitivityMap[reg.param] = { totalR2: 0, count: 0 }
      }
      sensitivityMap[reg.param].totalR2 += reg.r2
      sensitivityMap[reg.param].count++
    }

    const sensitivity = Object.entries(sensitivityMap)
      .map(([param, stats]) => ({
        param,
        influence: stats.totalR2 / stats.count
      }))
      .sort((a, b) => b.influence - a.influence)

    return { regressions, sensitivity, chartData }
  }

  async _preprocessContrast(mixDesigns, materialMapping, materialContrast) {
    const changedMaterials = materialContrast.changed_materials
    const materialService = new MaterialService()

    const materialParamsDiff = []

    for (const matType of changedMaterials) {
      const ids = new Set()
      for (const mix of mixDesigns) {
        const mapping = materialMapping[mix.id] || {}
        if (mapping[matType]) ids.add(mapping[matType])
      }

      const idArr = [...ids]
      if (idArr.length < 2) continue

      const matA = await materialService.getMaterialById(idArr[0])
      const matB = await materialService.getMaterialById(idArr[1])

      if (!matA || !matB) continue

      const fields = Object.keys({ ...matA, ...matB }).filter(
        k => !['id', 'createdAt', 'updatedAt'].includes(k)
      )

      const diffRows = []
      for (const field of fields) {
        const valA = matA[field]
        const valB = matB[field]
        if (typeof valA === 'number' && typeof valB === 'number') {
          const diff = valB - valA
          const pct = valA !== 0 ? (diff / valA * 100).toFixed(1) : 'N/A'
          diffRows.push({ field, valueA: valA, valueB: valB, difference: diff, percent: pct })
        } else if (valA !== valB) {
          diffRows.push({ field, valueA: String(valA), valueB: String(valB), difference: '不同', percent: '-' })
        }
      }

      materialParamsDiff.push({
        materialType: matType,
        materialNameA: matA.name,
        materialNameB: matB.name,
        fullParamsA: matA,
        fullParamsB: matB,
        rows: diffRows
      })
    }

    const performanceDiff = this._calcPerformanceDiff(mixDesigns, materialMapping, changedMaterials)
    const admixtureImpact = this._calcAdmixtureImpact(mixDesigns, materialMapping, changedMaterials)

    return { materialParamsDiff, performanceDiff, admixtureImpact }
  }

  _getParamValue(mix, param) {
    const fields = {
      waterBinderRatio: ['waterBinderRatio'],
      cement: ['cement'],
      flyAsh: ['flyAsh'],
      slag: ['slag'],
      lithiumSlag: ['lithiumSlag'],
      compositePowder: ['compositePowder'],
      sandRate: ['sandRate'],
      waterReducerDosage: ['waterReducerDosage'],
      fineAggregate1: ['fineAggregate1']
    }

    const candidates = fields[param] || [param]
    for (const key of candidates) {
      if (mix[key] !== undefined && mix[key] !== null) return Number(mix[key])
      if (mix.mixDesign?.[key] !== undefined && mix.mixDesign?.[key] !== null) return Number(mix.mixDesign[key])
    }
    return null
  }

  _getPerformanceValue(mix, perf) {
    const results = mix.testResults || {}
    if (results[perf] !== undefined && results[perf] !== null) return Number(results[perf])
    return null
  }

  _calcPerformanceDiff(mixDesigns, materialMapping, changedMaterials) {
    const groups = {}
    for (const mix of mixDesigns) {
      const mapping = materialMapping[mix.id] || {}
      const groupKey = changedMaterials.map(t => mapping[t] || 'unknown').join('|')
      if (!groups[groupKey]) groups[groupKey] = []
      groups[groupKey].push(mix)
    }

    const diffs = []
    const perfFields = ['strengthR28', 'strengthR7', 'initialSlump', 'initialSlumpFlow']
    const groupNames = Object.keys(groups)

    for (const perf of perfFields) {
      const meanValues = {}
      for (const [key, mixes] of Object.entries(groups)) {
        const values = mixes.map(m => this._getPerformanceValue(m, perf)).filter(v => v !== null)
        meanValues[key] = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null
      }

      if (groupNames.length >= 2 && meanValues[groupNames[0]] !== null && meanValues[groupNames[1]] !== null) {
        const diff = meanValues[groupNames[1]] - meanValues[groupNames[0]]
        diffs.push({
          metric: perf,
          groupA: meanValues[groupNames[0]],
          groupB: meanValues[groupNames[1]],
          difference: diff,
          percent: meanValues[groupNames[0]] !== 0
            ? (diff / meanValues[groupNames[0]] * 100).toFixed(1)
            : 'N/A'
        })
      }
    }

    return diffs
  }

  _calcAdmixtureImpact(mixDesigns, materialMapping, changedMaterials) {
    const groups = {}
    for (const mix of mixDesigns) {
      const mapping = materialMapping[mix.id] || {}
      const groupKey = changedMaterials.map(t => mapping[t] || 'unknown').join('|')
      if (!groups[groupKey]) groups[groupKey] = []
      groups[groupKey].push(mix)
    }

    const groupNames = Object.keys(groups)
    const result = {}

    for (const [key, mixes] of Object.entries(groups)) {
      const dosages = mixes.map(m => {
        const v = this._getParamValue(m, 'waterReducerDosage')
        return v !== null ? v : null
      }).filter(v => v !== null)

      result[key] = {
        meanDosage: dosages.length > 0 ? dosages.reduce((s, v) => s + v, 0) / dosages.length : null,
        minDosage: dosages.length > 0 ? Math.min(...dosages) : null,
        maxDosage: dosages.length > 0 ? Math.max(...dosages) : null
      }
    }

    let difference = null
    if (groupNames.length >= 2) {
      const a = result[groupNames[0]]?.meanDosage
      const b = result[groupNames[1]]?.meanDosage
      if (a !== null && b !== null) {
        difference = {
          value: b - a,
          description: `外加剂掺量差 ${(b - a).toFixed(2)} 个百分点`
        }
      }
    }

    return { groups: result, difference }
  }
}

module.exports = AnalysisPreprocessor

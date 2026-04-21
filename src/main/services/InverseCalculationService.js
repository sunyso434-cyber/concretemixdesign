/**
 * 原材料参数反算服务
 *
 * 通过多组配合比和实测强度数据，采用有约束回归算法反算：
 * - 水泥28天胶砂强度 f_ce (MPa)
 * - 粉煤灰影响系数 γ_f
 * - 矿渣粉影响系数 γ_s
 *
 * 算法核心：
 * 1. 外层循环：使用黄金分割法在 [48, 55] 范围内搜索最优 f_ce
 * 2. 内层循环：固定当前 f_ce，通过二维搜索找最优 γ_f 和 γ_s
 * 3. 目标函数：最小化 RSS = Σ(实测强度 - 预测强度)²
 *
 * 复用 MixDesignService 的水胶比公式：
 * W/B = (α_a × f_b) / (f_cu,0 + α_a × α_b × f_b)
 * 其中 f_b = f_ce × γ，γ = γ_f × γ_s
 */

class InverseCalculationService {
  /**
   * 数据预处理：同组平均
   * @param {Array} samples - 原始样本列表，每个样本包含 name, cement, flyAshPercent, slagPercent, waterAmount, strength
   * @returns {Array} 处理后的样本列表
   */
  preprocessSamples(samples) {
    // 1. 按 name 分组
    const grouped = {}
    for (const sample of samples) {
      if (!grouped[sample.name]) {
        grouped[sample.name] = []
      }
      grouped[sample.name].push(sample)
    }

    // 2. 同 name 下有多条时取强度平均值
    const result = []
    for (const [name, items] of Object.entries(grouped)) {
      if (items.length === 1) {
        result.push({
          name: items[0].name,
          cement: items[0].cement,
          flyAshPercent: items[0].flyAshPercent,
          slagPercent: items[0].slagPercent,
          waterAmount: items[0].waterAmount,
          strength: items[0].strength
        })
      } else {
        // 多条记录，取强度平均值，材料用量取第一条
        const avgStrength = items.reduce((sum, item) => sum + item.strength, 0) / items.length
        result.push({
          name: items[0].name,
          cement: items[0].cement,
          flyAshPercent: items[0].flyAshPercent,
          slagPercent: items[0].slagPercent,
          waterAmount: items[0].waterAmount,
          strength: avgStrength
        })
      }
    }

    return result
  }

  /**
   * 预测强度计算
   * 复用 MixDesignService 的水胶比公式，反推配置强度对应的28天强度
   *
   * 公式推导：
   * W/B = (α_a × f_b) / (f_cu,0 + α_a × α_b × f_b)
   * 其中 f_b = f_ce × combinedFactor (combinedFactor = γ_f × γ_s)
   *
   * 求解 f_cu,0:
   * f_cu,0 = (α_a × f_b) / (W/B) - α_a × α_b × f_b
   *        = α_a × f_b × (1/(W/B) - α_b)
   *
   * @param {Object} sample - 样本数据，包含 cement, flyAshPercent, slagPercent, waterAmount
   * @param {number} fce - 水泥28天胶砂强度 (MPa)
   * @param {number} combinedFactor - 组合影响系数 γ = γ_f × γ_s
   * @param {number} alphaA - 回归系数 α_a
   * @param {number} alphaB - 回归系数 α_b
   * @returns {number} 预测的28天强度 (MPa)
   */
  calculatePredictedStrength(sample, fce, combinedFactor, alphaA, alphaB) {
    const { cement, flyAshPercent, slagPercent, waterAmount } = sample

    // 计算胶凝材料总量
    const flyAshDosage = (flyAshPercent || 0) / 100
    const slagDosage = (slagPercent || 0) / 100
    const cementPercentage = 1 - flyAshDosage - slagDosage

    const cementAmount = cement * cementPercentage
    const flyAshAmount = cement * flyAshDosage
    const slagAmount = cement * slagDosage
    const binderAmount = cementAmount + flyAshAmount + slagAmount

    // 水胶比 W/B
    const waterBinderRatio = waterAmount / binderAmount

    // f_b = f_ce × combinedFactor
    const fb = fce * combinedFactor

    // f_cu,0 = α_a × f_b × (1/(W/B) - α_b)
    const predictedStrength = alphaA * fb * (1 / waterBinderRatio - alphaB)

    return predictedStrength
  }

  /**
   * 计算残差标准差（样本数 > 10 时）
   * @param {Array} samples - 处理后的样本列表
   * @param {Object} params - 当前参数 { fce, flyAshFactor, slagFactor, combinedFactor, alphaA, alphaB }
   * @returns {number} 残差标准差，如果样本数 <= 10 则返回 null
   */
  calculateResidualStdDev(samples, params) {
    if (samples.length <= 10) {
      return null
    }

    const residuals = []
    for (const sample of samples) {
      const predicted = this.calculatePredictedStrength(
        sample,
        params.fce,
        params.combinedFactor,
        params.alphaA,
        params.alphaB
      )
      residuals.push(sample.strength - predicted)
    }

    // 计算标准差
    const mean = residuals.reduce((sum, r) => sum + r, 0) / residuals.length
    const variance = residuals.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (residuals.length - 1)
    return Math.sqrt(variance)
  }

  /**
   * 计算 RSS（残差平方和）
   * @param {Array} samples - 样本列表
   * @param {number} fce - 水泥28天强度
   * @param {number} combinedFactor - 组合影响系数
   * @param {number} alphaA - 回归系数 α_a
   * @param {number} alphaB - 回归系数 α_b
   * @returns {number} RSS 值
   */
  calculateRSS(samples, fce, combinedFactor, alphaA, alphaB) {
    let rss = 0
    for (const sample of samples) {
      const predicted = this.calculatePredictedStrength(
        sample,
        fce,
        combinedFactor,
        alphaA,
        alphaB
      )
      const residual = sample.strength - predicted
      rss += residual * residual
    }
    return rss
  }

  /**
   * 黄金分割法一维搜索（固定γ，求最优fce）
   * @param {Array} samples - 样本列表
   * @param {number} combinedFactor - 组合影响系数 γ = γ_f × γ_s
   * @param {Object} constraints - 约束条件 { fceMin, fceMax }
   * @param {Object} options - 选项 { alphaA, alphaB, tol, maxIter }
   * @returns {Object} { optimalFce, rss }
   */
  goldenSectionSearchFce(samples, combinedFactor, constraints, options) {
    const { fceMin, fceMax } = constraints
    const { alphaA, alphaB } = options
    const tol = options.tol || 1e-6
    const maxIter = options.maxIter || 100

    // 黄金分割比例：0.618033988749895
    const phi = (Math.sqrt(5) - 1) / 2

    let a = fceMin
    let b = fceMax

    // 初始两点
    let c = b - phi * (b - a)
    let d = a + phi * (b - a)

    // 计算初始 RSS 值
    let rssC = this.calculateRSS(samples, c, combinedFactor, alphaA, alphaB)
    let rssD = this.calculateRSS(samples, d, combinedFactor, alphaA, alphaB)

    let iterations = 0
    while (Math.abs(b - a) > tol && iterations < maxIter) {
      if (rssC < rssD) {
        b = d
        d = c
        rssD = rssC
        c = b - phi * (b - a)
        rssC = this.calculateRSS(samples, c, combinedFactor, alphaA, alphaB)
      } else {
        a = c
        c = d
        rssC = rssD
        d = a + phi * (b - a)
        rssD = this.calculateRSS(samples, d, combinedFactor, alphaA, alphaB)
      }
      iterations++
    }

    // 返回最优解（取 a 和 b 的中点，或较好的那个）
    const optimalFce = (a + b) / 2
    const optimalRss = this.calculateRSS(samples, optimalFce, combinedFactor, alphaA, alphaB)

    return { optimalFce, rss: optimalRss, iterations }
  }

  /**
   * 二维搜索（固定fce，求最优γ_f和γ_s）
   * 使用网格搜索 + 黄金分割精修
   * @param {Array} samples - 样本列表
   * @param {number} fce - 水泥28天强度
   * @param {Object} constraints - 约束条件 { flyAshFactorMin, flyAshFactorMax, slagFactorMin, slagFactorMax }
   * @param {Object} options - 选项 { alphaA, alphaB, gridSteps, tol, maxIter }
   * @returns {Object} { flyAshFactor, slagFactor, combinedFactor, rss }
   */
  searchOptimalGamma(samples, fce, constraints, options) {
    const {
      flyAshFactorMin,
      flyAshFactorMax,
      slagFactorMin,
      slagFactorMax
    } = constraints
    const { alphaA, alphaB } = options
    const gridSteps = options.gridSteps || 20
    const tol = options.tol || 1e-6
    const maxIter = options.maxIter || 100

    // 阶段1：粗略网格搜索
    let bestRss = Infinity
    let bestFlyAshFactor = 1.0
    let bestSlagFactor = 1.0

    const flyAshStep = (flyAshFactorMax - flyAshFactorMin) / gridSteps
    const slagStep = (slagFactorMax - slagFactorMin) / gridSteps

    for (let i = 0; i <= gridSteps; i++) {
      const flyAshFactor = flyAshFactorMin + i * flyAshStep
      for (let j = 0; j <= gridSteps; j++) {
        const slagFactor = slagFactorMin + j * slagStep
        const combinedFactor = flyAshFactor * slagFactor
        const rss = this.calculateRSS(samples, fce, combinedFactor, alphaA, alphaB)

        if (rss < bestRss) {
          bestRss = rss
          bestFlyAshFactor = flyAshFactor
          bestSlagFactor = slagFactor
        }
      }
    }

    // 阶段2：黄金分割精修（针对 flyAshFactor）
    const refineFlyAsh = (slagFactor) => {
      const combinedFactorAtSlag = (flyAshF) => flyAshF * slagFactor

      // 在 [flyAshFactorMin, flyAshFactorMax] 范围内搜索最优 flyAshFactor
      let a = flyAshFactorMin
      let b = flyAshFactorMax
      const phi = (Math.sqrt(5) - 1) / 2

      let c = b - phi * (b - a)
      let d = a + phi * (b - a)

      let rssC = this.calculateRSS(samples, fce, c * slagFactor, alphaA, alphaB)
      let rssD = this.calculateRSS(samples, fce, d * slagFactor, alphaA, alphaB)

      let iter = 0
      while (Math.abs(b - a) > tol && iter < maxIter) {
        if (rssC < rssD) {
          b = d
          rssD = rssC
          d = c
          c = b - phi * (b - a)
          rssC = this.calculateRSS(samples, fce, c * slagFactor, alphaA, alphaB)
        } else {
          a = c
          rssC = rssD
          c = d
          d = a + phi * (b - a)
          rssD = this.calculateRSS(samples, fce, d * slagFactor, alphaA, alphaB)
        }
        iter++
      }

      return { optimalFlyAshFactor: (a + b) / 2, rss: Math.min(rssC, rssD) }
    }

    // 阶段2：黄金分割精修（针对 slagFactor）
    const refineSlag = (flyAshFactor) => {
      let a = slagFactorMin
      let b = slagFactorMax
      const phi = (Math.sqrt(5) - 1) / 2

      let c = b - phi * (b - a)
      let d = a + phi * (b - a)

      let rssC = this.calculateRSS(samples, fce, flyAshFactor * c, alphaA, alphaB)
      let rssD = this.calculateRSS(samples, fce, flyAshFactor * d, alphaA, alphaB)

      let iter = 0
      while (Math.abs(b - a) > tol && iter < maxIter) {
        if (rssC < rssD) {
          b = d
          rssD = rssC
          d = c
          c = b - phi * (b - a)
          rssC = this.calculateRSS(samples, fce, flyAshFactor * c, alphaA, alphaB)
        } else {
          a = c
          rssC = rssD
          c = d
          d = a + phi * (b - a)
          rssD = this.calculateRSS(samples, fce, flyAshFactor * d, alphaA, alphaB)
        }
        iter++
      }

      return { optimalSlagFactor: (a + b) / 2, rss: Math.min(rssC, rssD) }
    }

    // 交替精修：先精修 flyAshFactor，再精修 slagFactor
    const refinedFlyAsh = refineFlyAsh(bestSlagFactor)
    bestFlyAshFactor = refinedFlyAsh.optimalFlyAshFactor
    bestRss = refinedFlyAsh.rss

    const refinedSlag = refineSlag(bestFlyAshFactor)
    bestSlagFactor = refinedSlag.optimalSlagFactor
    bestRss = refinedSlag.rss

    // 再精修一次 flyAshFactor
    const refinedFlyAsh2 = refineFlyAsh(bestSlagFactor)
    bestFlyAshFactor = refinedFlyAsh2.optimalFlyAshFactor
    bestRss = refinedFlyAsh2.rss

    return {
      flyAshFactor: bestFlyAshFactor,
      slagFactor: bestSlagFactor,
      combinedFactor: bestFlyAshFactor * bestSlagFactor,
      rss: bestRss
    }
  }

  /**
   * 主回归函数
   * @param {Object} params - 输入参数 { samples, constraints, alphaA, alphaB }
   * @param {Array} params.samples - 样本列表，每个样本包含 name, cement, flyAshPercent, slagPercent, waterAmount, strength
   * @param {Object} params.constraints - 约束条件
   * @param {number} params.constraints.fceMin - fce 最小值（默认 48）
   * @param {number} params.constraints.fceMax - fce 最大值（默认 55）
   * @param {number} params.constraints.flyAshFactorMin - 粉煤灰影响系数最小值（默认 0.5）
   * @param {number} params.constraints.flyAshFactorMax - 粉煤灰影响系数最大值（默认 1.0）
   * @param {number} params.constraints.slagFactorMin - 矿渣粉影响系数最小值（默认 0.5）
   * @param {number} params.constraints.slagFactorMax - 矿渣粉影响系数最大值（默认 1.2）
   * @param {number} params.alphaA - 回归系数 α_a（默认 0.53）
   * @param {number} params.alphaB - 回归系数 α_b（默认 0.20）
   * @returns {Object} 回归结果
   */
  async calculate(params) {
    const {
      samples,
      constraints = {},
      alphaA = 0.53,
      alphaB = 0.20
    } = params

    // 默认约束条件
    const defaultConstraints = {
      fceMin: 48,
      fceMax: 55,
      flyAshFactorMin: 0.5,
      flyAshFactorMax: 1.0,
      slagFactorMin: 0.5,
      slagFactorMax: 1.2
    }

    const finalConstraints = { ...defaultConstraints, ...constraints }

    // 1. 数据预处理
    const processedSamples = this.preprocessSamples(samples)
    const sampleCount = processedSamples.length

    console.log(`[InverseCalculation] 预处理后样本数: ${sampleCount}`)

    // 初始化参数
    let currentFce = (finalConstraints.fceMin + finalConstraints.fceMax) / 2
    let currentFlyAshFactor = 1.0
    let currentSlagFactor = 1.0
    let currentCombinedFactor = currentFlyAshFactor * currentSlagFactor

    const options = {
      alphaA,
      alphaB,
      tol: 1e-6,
      maxIter: 100
    }

    // 2. 外层循环：迭代 fce
    let outerIterations = 0
    const maxOuterIter = 50
    let prevFce = 0
    let convergence = false

    while (outerIterations < maxOuterIter) {
      prevFce = currentFce

      // 3. 内层循环：固定 fce，求最优 γ
      const gammaResult = this.searchOptimalGamma(
        processedSamples,
        currentFce,
        finalConstraints,
        options
      )

      currentFlyAshFactor = gammaResult.flyAshFactor
      currentSlagFactor = gammaResult.slagFactor
      currentCombinedFactor = gammaResult.combinedFactor

      // 4. 外层：固定 γ，求最优 fce
      const fceResult = this.goldenSectionSearchFce(
        processedSamples,
        currentCombinedFactor,
        finalConstraints,
        options
      )

      currentFce = fceResult.optimalFce

      outerIterations++

      // 检查收敛
      if (Math.abs(currentFce - prevFce) < 1e-6) {
        convergence = true
        break
      }
    }

    // 计算最终 RSS
    const finalRss = this.calculateRSS(
      processedSamples,
      currentFce,
      currentCombinedFactor,
      alphaA,
      alphaB
    )

    // 计算 R²
    const meanStrength = processedSamples.reduce((sum, s) => sum + s.strength, 0) / sampleCount
    const totalSS = processedSamples.reduce((sum, s) => sum + (s.strength - meanStrength) ** 2, 0)
    const rSquared = totalSS > 0 ? 1 - finalRss / totalSS : 0

    // 计算残差标准差（样本数 > 10 时）
    const residualStdDev = this.calculateResidualStdDev(processedSamples, {
      fce: currentFce,
      flyAshFactor: currentFlyAshFactor,
      slagFactor: currentSlagFactor,
      combinedFactor: currentCombinedFactor,
      alphaA,
      alphaB
    })

    // 计算各样本残差
    const residuals = processedSamples.map(sample => {
      const predicted = this.calculatePredictedStrength(
        sample,
        currentFce,
        currentCombinedFactor,
        alphaA,
        alphaB
      )
      return {
        name: sample.name,
        actual: sample.strength,
        predicted,
        residual: sample.strength - predicted
      }
    })

    return {
      cementStrength28d: currentFce,
      flyAshFactor: currentFlyAshFactor,
      slagFactor: currentSlagFactor,
      combinedFactor: currentCombinedFactor,
      rSquared,
      residualStdDev,
      sampleCount,
      iterations: outerIterations,
      convergence,
      residuals,
      rss: finalRss
    }
  }
}

module.exports = new InverseCalculationService()

/**
 * GeneticOptimizer — 通用混合整数标准遗传算法
 *
 * 支持连续基因（SBX交叉 + 高斯变异）和离散基因（均匀交叉 + 整数变异），
 * 包含精英保留、锦标赛选择、早停、重启和全淘汰快速失败机制。
 */
class GeneticOptimizer {
  /**
   * @param {Object} config
   * @param {number} [config.populationSize=50]  - 种群规模
   * @param {number} [config.generations=100]    - 最大迭代代数
   * @param {number} [config.elitismCount=2]     - 精英保留个数
   * @param {number} [config.tournamentSize=3]   - 锦标赛选择规模
   * @param {number} [config.crossoverProb=0.9]  - 交叉概率
   * @param {number} [config.sbxEta=20]          - SBX 分布指数 η
   * @param {number|null} [config.mutationProb=null] - 变异概率（null=自动 1/N_genes）
   * @param {number} [config.topN=10]            - 返回 Top-N 结果
   * @param {number} [config.patience=20]        - 早停耐心值
   * @param {number} [config.stallGenerations=30] - 重启停滞代数阈值
   * @param {number} [config.restartRatio=0.3]   - 重启时重置比例
   */
  constructor(config = {}) {
    this.config = {
      populationSize: 50,
      generations: 100,
      elitismCount: 2,
      tournamentSize: 3,
      crossoverProb: 0.9,
      sbxEta: 20,
      mutationProb: null,
      topN: 10,
      patience: 20,
      stallGenerations: 30,
      restartRatio: 0.3,
      ...config
    }
  }

  /**
   * 执行遗传算法优化
   * @param {Function} fitnessFn - 适应度函数，接收 genes 对象，返回 { fitness: number, ... }
   * @param {Object} geneSpec   - 基因编码规范
   * @param {Array}  geneSpec.continuous - 连续基因定义 [{ name, min, max }]
   * @param {Array}  geneSpec.discrete   - 离散基因定义 [{ name, candidates }]
   * @returns {Promise<{bestSolutions: Array, stats: Object}>}
   */
  async run(fitnessFn, geneSpec) {
    const startTime = Date.now()
    const cfg = this.config
    const totalGenes = (geneSpec.continuous || []).length + (geneSpec.discrete || []).length
    const mutationProb = cfg.mutationProb !== null ? cfg.mutationProb : (totalGenes > 0 ? 1 / totalGenes : 0)

    // 初始化种群
    let population = this._initializePopulation(geneSpec, cfg.populationSize)

    let bestFitness = Infinity
    let bestGenes = null
    let noImproveCount = 0
    let stallCount = 0
    let generationsRun = 0
    let converged = false
    let allInvalid = false

    for (let gen = 0; gen < cfg.generations; gen++) {
      generationsRun = gen + 1

      // 异步批量评估（fitnessFn 返回完整对象，GA 引擎只取 .fitness 字段）
      const results = await Promise.all(population.map(ind => fitnessFn(ind.genes)))
      const evaluated = population.map((ind, i) => ({
        genes: ind.genes,
        ...results[i]
      }))

      // 全淘汰快速失败：所有个体 fitness=MAX_VALUE
      const everyInvalid = evaluated.every(r => r.fitness === Number.MAX_VALUE)
      if (everyInvalid) {
        allInvalid = true
        break
      }

      // 按适应度升序（最小化问题）
      evaluated.sort((a, b) => a.fitness - b.fitness)

      // 更新历史最优
      const currentBest = evaluated[0]
      if (currentBest.fitness < bestFitness) {
        bestFitness = currentBest.fitness
        bestGenes = { ...currentBest.genes }
        noImproveCount = 0
        stallCount = 0
      } else {
        noImproveCount++
        stallCount++
      }

      // 早停判断
      if (noImproveCount >= cfg.patience) {
        converged = true
        break
      }

      // --- 构建下一代 ---
      const nextPopulation = []

      // 精英保留：前 N 个直接进入下一代
      for (let i = 0; i < Math.min(cfg.elitismCount, evaluated.length); i++) {
        nextPopulation.push({ genes: { ...evaluated[i].genes } })
      }

      // 重启机制：停滞 stallGenerations 代后重置部分种群
      if (stallCount >= cfg.stallGenerations) {
        const restartCount = Math.min(
          Math.floor(cfg.populationSize * cfg.restartRatio),
          cfg.populationSize - nextPopulation.length
        )
        for (let i = 0; i < restartCount; i++) {
          nextPopulation.push({ genes: this._randomIndividual(geneSpec) })
        }
        stallCount = 0
      }

      // 通过选择 + 交叉 + 变异填充剩余个体
      while (nextPopulation.length < cfg.populationSize) {
        // 锦标赛选择
        const p1 = this._tournamentSelect(evaluated, cfg.tournamentSize)
        const p2 = this._tournamentSelect(evaluated, cfg.tournamentSize)

        // 深拷贝父母基因
        let child1Genes = { ...p1.genes }
        let child2Genes = { ...p2.genes }

        // --- 连续基因：SBX 交叉 ---
        if (geneSpec.continuous) {
          for (const cont of geneSpec.continuous) {
            if (Math.random() < cfg.crossoverProb) {
              const [c1, c2] = this._sbxCrossover(
                p1.genes[cont.name],
                p2.genes[cont.name],
                cont.min,
                cont.max,
                cfg.sbxEta
              )
              child1Genes[cont.name] = c1
              child2Genes[cont.name] = c2
            }
          }
        }

        // --- 离散基因：均匀交叉 ---
        if (geneSpec.discrete) {
          for (const disc of geneSpec.discrete) {
            if (Math.random() < cfg.crossoverProb) {
              child1Genes[disc.name] = Math.random() < 0.5
                ? p1.genes[disc.name]
                : p2.genes[disc.name]
              child2Genes[disc.name] = Math.random() < 0.5
                ? p1.genes[disc.name]
                : p2.genes[disc.name]
            }
          }
        }

        // --- 变异 ---
        this._mutateIndividual(child1Genes, geneSpec, mutationProb)
        this._mutateIndividual(child2Genes, geneSpec, mutationProb)

        nextPopulation.push({ genes: child1Genes })
        if (nextPopulation.length < cfg.populationSize) {
          nextPopulation.push({ genes: child2Genes })
        }
      }

      population = nextPopulation
    }

    // --- 最终评估，获取 Top-N 结果 ---
    const finalResults = await Promise.all(population.map(ind => fitnessFn(ind.genes)))
    const finalEvaluated = population.map((ind, i) => ({
      genes: ind.genes,
      ...finalResults[i]
    }))
    finalEvaluated.sort((a, b) => a.fitness - b.fitness)

    const validSolutions = finalEvaluated.filter(s => s.fitness < Number.MAX_VALUE)
    const bestSolutions = validSolutions.slice(0, cfg.topN)

    const stats = {
      generationsRun,
      converged,
      time: Date.now() - startTime,
      allInvalid
    }

    return { bestSolutions, stats }
  }

  // ========================
  //  种群初始化
  // ========================

  /**
   * 初始化种群
   */
  _initializePopulation(geneSpec, size) {
    const pop = []
    for (let i = 0; i < size; i++) {
      pop.push({ genes: this._randomIndividual(geneSpec) })
    }
    return pop
  }

  /**
   * 生成随机个体
   */
  _randomIndividual(geneSpec) {
    const genes = {}
    if (geneSpec.continuous) {
      for (const cont of geneSpec.continuous) {
        genes[cont.name] = cont.min + Math.random() * (cont.max - cont.min)
      }
    }
    if (geneSpec.discrete) {
      for (const disc of geneSpec.discrete) {
        const idx = Math.floor(Math.random() * disc.candidates.length)
        genes[disc.name] = disc.candidates[idx]
      }
    }
    return genes
  }

  // ========================
  //  选择
  // ========================

  /**
   * 锦标赛选择：从 k 个随机个体中选出最优
   */
  _tournamentSelect(evaluated, k) {
    let best = null
    let bestFitness = Infinity
    for (let i = 0; i < k; i++) {
      const idx = Math.floor(Math.random() * evaluated.length)
      const candidate = evaluated[idx]
      if (candidate.fitness < bestFitness) {
        bestFitness = candidate.fitness
        best = candidate
      }
    }
    return best
  }

  // ========================
  //  交叉算子
  // ========================

  /**
   * SBX（Simulated Binary Crossover）— 连续基因
   * @param {number} p1   - 父本基因值
   * @param {number} p2   - 母本基因值
   * @param {number} min  - 下界
   * @param {number} max  - 上界
   * @param {number} eta  - 分布指数
   * @returns {[number, number]} [child1, child2]
   */
  _sbxCrossover(p1, p2, min, max, eta) {
    let c1, c2
    if (Math.abs(p1 - p2) < 1e-10) {
      c1 = p1
      c2 = p2
    } else {
      const u = Math.random()
      let beta
      if (u <= 0.5) {
        beta = Math.pow(2 * u, 1 / (eta + 1))
      } else {
        beta = Math.pow(1 / (2 * (1 - u)), 1 / (eta + 1))
      }
      c1 = 0.5 * ((1 + beta) * p1 + (1 - beta) * p2)
      c2 = 0.5 * ((1 - beta) * p1 + (1 + beta) * p2)
    }
    return [this._clamp(c1, min, max), this._clamp(c2, min, max)]
  }

  // ========================
  //  变异算子
  // ========================

  /**
   * 对个体的所有基因执行变异
   */
  _mutateIndividual(genes, geneSpec, mutationProb) {
    // 连续基因：高斯变异
    if (geneSpec.continuous) {
      for (const cont of geneSpec.continuous) {
        if (Math.random() < mutationProb) {
          const range = cont.max - cont.min
          const sigma = 0.1 * range
          genes[cont.name] = this._clamp(
            genes[cont.name] + this._gaussianRandom() * sigma,
            cont.min,
            cont.max
          )
        }
      }
    }

    // 离散基因：整数变异（随机重选候选）
    if (geneSpec.discrete) {
      for (const disc of geneSpec.discrete) {
        if (Math.random() < mutationProb) {
          const idx = Math.floor(Math.random() * disc.candidates.length)
          genes[disc.name] = disc.candidates[idx]
        }
      }
    }
  }

  // ========================
  //  工具函数
  // ========================

  /**
   * 将值钳制到 [min, max]
   */
  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  /**
   * Box-Muller 变换生成标准正态分布随机数 N(0,1)
   */
  _gaussianRandom() {
    let u = 0, v = 0
    while (u === 0) u = Math.random()
    while (v === 0) v = Math.random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

module.exports = GeneticOptimizer

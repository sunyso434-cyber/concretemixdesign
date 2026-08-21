// GeneticOptimizer 核心路径单元测试（优化项 6）
// 覆盖：基础算子（SBX/钳制/锦标赛选择）、run 主流程（收敛/早停/全淘汰/Top-N/离散基因守界）
const GeneticOptimizer = require('../GeneticOptimizer')

describe('GeneticOptimizer 基础算子', () => {
  test('_clamp 将越界值钳制到 [min, max]', () => {
    const opt = new GeneticOptimizer()
    expect(opt._clamp(5, 0, 10)).toBe(5)
    expect(opt._clamp(-3, 0, 10)).toBe(0)
    expect(opt._clamp(15, 0, 10)).toBe(10)
    expect(opt._clamp(0, 0, 10)).toBe(0)
    expect(opt._clamp(10, 0, 10)).toBe(10)
  })

  test('_sbxCrossover 子代始终落在 [min, max] 内', () => {
    const opt = new GeneticOptimizer()
    // 固定随机数，验证确定性输出与边界
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.3)
    try {
      const [c1, c2] = opt._sbxCrossover(5, 9, 0, 10, 20)
      expect(c1).toBeGreaterThanOrEqual(0)
      expect(c1).toBeLessThanOrEqual(10)
      expect(c2).toBeGreaterThanOrEqual(0)
      expect(c2).toBeLessThanOrEqual(10)
    } finally {
      spy.mockRestore()
    }
  })

  test('_sbxCrossover 父母相同值时子代不变（退化路径）', () => {
    const opt = new GeneticOptimizer()
    const [c1, c2] = opt._sbxCrossover(4, 4, 0, 10, 20)
    expect(c1).toBe(4)
    expect(c2).toBe(4)
  })

  test('_tournamentSelect 从有效个体中选最优（固定随机）', () => {
    const opt = new GeneticOptimizer()
    const evaluated = [
      { genes: { x: 1 }, fitness: 10 },
      { genes: { x: 2 }, fitness: 2 },
      { genes: { x: 3 }, fitness: 7 },
    ]
    // Math.random=0.99 → 每次采样 index 2（fitness 7），k 轮中 fitness 最小者胜出
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.99)
    try {
      const best = opt._tournamentSelect(evaluated, 3)
      expect(best.fitness).toBe(7)
      expect(best.genes.x).toBe(3)
    } finally {
      spy.mockRestore()
    }
  })

  test('_randomIndividual 离散基因严格来自候选集', () => {
    const opt = new GeneticOptimizer()
    const genes = opt._randomIndividual({
      discrete: [{ name: 'kind', candidates: ['水泥', '粉煤灰', '矿渣'] }],
    })
    expect(['水泥', '粉煤灰', '矿渣']).toContain(genes.kind)
  })
})

describe('GeneticOptimizer.run 主流程', () => {
  test('凸函数收敛：最优解接近解析最优点 (3, -1)', async () => {
    const opt = new GeneticOptimizer({ populationSize: 40, generations: 60, patience: 15 })
    const fitness = (g) => ({ fitness: Math.pow(g.x - 3, 2) + Math.pow(g.y + 1, 2) })
    const { bestSolutions, stats } = await opt.run(fitness, {
      continuous: [
        { name: 'x', min: -10, max: 10 },
        { name: 'y', min: -10, max: 10 },
      ],
    })
    expect(bestSolutions.length).toBeGreaterThan(0)
    expect(bestSolutions[0].fitness).toBeLessThan(0.01)
    expect(bestSolutions[0].genes.x).toBeCloseTo(3, 1)
    expect(bestSolutions[0].genes.y).toBeCloseTo(-1, 1)
    expect(stats.allInvalid).toBe(false)
  })

  test('返回 Top-N 且按 fitness 升序排列', async () => {
    const opt = new GeneticOptimizer({ populationSize: 30, generations: 30, patience: 20, topN: 5 })
    const fitness = (g) => ({ fitness: Math.abs(g.x) })
    const { bestSolutions } = await opt.run(fitness, {
      continuous: [{ name: 'x', min: -5, max: 5 }],
    })
    expect(bestSolutions.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < bestSolutions.length; i++) {
      expect(bestSolutions[i].fitness).toBeGreaterThanOrEqual(bestSolutions[i - 1].fitness)
    }
  })

  test('早停：无改进达到 patience 后 converged=true 且代数受限', async () => {
    const opt = new GeneticOptimizer({ populationSize: 20, generations: 200, patience: 3, mutationProb: 0 })
    // 恒定适应度：任何个体 fitness 都相同 → 第一代后不再改进
    const fitness = () => ({ fitness: 42 })
    const { bestSolutions, stats } = await opt.run(fitness, {
      continuous: [{ name: 'x', min: 0, max: 10 }],
    })
    expect(stats.converged).toBe(true)
    expect(stats.generationsRun).toBeLessThan(50) // 远小于 generations=200
    // 恒定适应度下所有个体都"有效"，bestSolutions 非空
    expect(bestSolutions.length).toBeGreaterThan(0)
    expect(bestSolutions[0].fitness).toBe(42)
  })

  test('全淘汰快速失败：所有个体 fitness=MAX_VALUE → allInvalid=true 且无有效解', async () => {
    const opt = new GeneticOptimizer({ populationSize: 20, generations: 100 })
    const fitness = () => ({ fitness: Number.MAX_VALUE })
    const { bestSolutions, stats } = await opt.run(fitness, {
      continuous: [{ name: 'x', min: 0, max: 10 }],
    })
    expect(stats.allInvalid).toBe(true)
    expect(bestSolutions).toHaveLength(0)
  })

  test('离散基因优化：结果值始终来自候选集', async () => {
    const opt = new GeneticOptimizer({ populationSize: 20, generations: 20, patience: 10 })
    const candidates = ['A', 'B', 'C', 'D']
    const fitness = (g) => ({ fitness: g.pick === 'D' ? 0.1 : 1.0 }) // 目标选择 D
    const { bestSolutions } = await opt.run(fitness, {
      discrete: [{ name: 'pick', candidates }],
    })
    expect(bestSolutions.length).toBeGreaterThan(0)
    // 全部解的值都来自候选集
    for (const s of bestSolutions) {
      expect(candidates).toContain(s.genes.pick)
    }
    // 最优应收敛到目标值 D
    expect(bestSolutions[0].genes.pick).toBe('D')
  })

  test('混合基因（连续+离散）正常执行并返回统计信息', async () => {
    const opt = new GeneticOptimizer({ populationSize: 20, generations: 10, patience: 5 })
    const fitness = (g) => ({ fitness: Math.abs(g.ratio - 0.5) + (g.mode === 'fast' ? 0 : 1) })
    const { bestSolutions, stats } = await opt.run(fitness, {
      continuous: [{ name: 'ratio', min: 0, max: 1 }],
      discrete: [{ name: 'mode', candidates: ['fast', 'slow'] }],
    })
    expect(stats).toHaveProperty('generationsRun')
    expect(stats).toHaveProperty('time')
    expect(Array.isArray(bestSolutions)).toBe(true)
  })
})
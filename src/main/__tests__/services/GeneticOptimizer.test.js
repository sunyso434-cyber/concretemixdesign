const GeneticOptimizer = require('../../services/GeneticOptimizer')

describe('GeneticOptimizer', () => {
  test('Sphere 函数收敛到全局最优', async () => {
    const geneSpec = {
      continuous: [
        { name: 'x1', min: -5, max: 5 },
        { name: 'x2', min: -5, max: 5 }
      ],
      discrete: []
    }
    const fitnessFn = (genes) => ({ fitness: genes.x1 ** 2 + genes.x2 ** 2 })
    const ga = new GeneticOptimizer({ populationSize: 50, generations: 100 })
    const result = await ga.run(fitnessFn, geneSpec)
    expect(result.bestSolutions[0].fitness).toBeLessThan(0.1)
    expect(result.stats.converged).toBe(true)
  })

  test('Rastrigin 函数收敛（多峰，验证重启机制）', async () => {
    const geneSpec = {
      continuous: [
        { name: 'x1', min: -5.12, max: 5.12 },
        { name: 'x2', min: -5.12, max: 5.12 }
      ],
      discrete: []
    }
    const fitnessFn = (genes) => {
      const A = 10
      const f = 2 * A + (genes.x1 ** 2 - A * Math.cos(2 * Math.PI * genes.x1))
        + (genes.x2 ** 2 - A * Math.cos(2 * Math.PI * genes.x2))
      return { fitness: f }
    }
    const ga = new GeneticOptimizer({ populationSize: 50, generations: 150 })
    const result = await ga.run(fitnessFn, geneSpec)
    expect(result.bestSolutions[0].fitness).toBeLessThan(1.0)
  })

  test('离散+连续混合编码', async () => {
    const geneSpec = {
      continuous: [{ name: 'x', min: 0, max: 10 }],
      discrete: [{ name: 'choice', candidates: [0, 1, 2] }]
    }
    const fitnessFn = (genes) => {
      const base = (genes.x - 5) ** 2
      return { fitness: genes.choice === 1 ? base : base + 100 }
    }
    const ga = new GeneticOptimizer({ populationSize: 30, generations: 50 })
    const result = await ga.run(fitnessFn, geneSpec)
    expect(result.bestSolutions[0].genes.choice).toBe(1)
    expect(Math.abs(result.bestSolutions[0].genes.x - 5)).toBeLessThan(0.5)
  })

  test('硬约束淘汰（适应度=MAX_VALUE）', async () => {
    const geneSpec = { continuous: [{ name: 'x', min: 0, max: 10 }], discrete: [] }
    const fitnessFn = (genes) => ({ fitness: genes.x < 3 ? Number.MAX_VALUE : genes.x })
    const ga = new GeneticOptimizer({ populationSize: 20, generations: 30 })
    const result = await ga.run(fitnessFn, geneSpec)
    expect(result.bestSolutions[0].genes.x).toBeGreaterThanOrEqual(3)
  })

  test('全淘汰快速失败', async () => {
    const geneSpec = { continuous: [{ name: 'x', min: 0, max: 10 }], discrete: [] }
    const fitnessFn = (genes) => ({ fitness: Number.MAX_VALUE })
    const ga = new GeneticOptimizer({ populationSize: 20, generations: 30 })
    const result = await ga.run(fitnessFn, geneSpec)
    expect(result.bestSolutions).toHaveLength(0)
    expect(result.stats.allInvalid).toBe(true)
  })

  test('精英保留：最优解不被破坏', async () => {
    const geneSpec = { continuous: [{ name: 'x', min: 0, max: 10 }], discrete: [] }
    const fitnessFn = (genes) => ({ fitness: genes.x })
    const ga = new GeneticOptimizer({ populationSize: 30, generations: 50 })
    const result = await ga.run(fitnessFn, geneSpec)
    expect(result.bestSolutions[0].fitness).toBeLessThan(1.0)
  })

  test('重启后恢复收敛（trap 函数验证重启机制）', async () => {
    const geneSpec = { continuous: [{ name: 'x', min: 0, max: 10 }], discrete: [] }
    const fitnessFn = (genes) => {
      const x = genes.x
      if (x >= 4 && x <= 6) return { fitness: 10 + (x - 5) ** 2 }
      return { fitness: x ** 2 }
    }
    const ga = new GeneticOptimizer({ populationSize: 30, generations: 100 })
    const result = await ga.run(fitnessFn, geneSpec)
    expect(result.bestSolutions[0].fitness).toBeLessThan(2.0)
    expect(result.bestSolutions[0].genes.x).toBeLessThan(2.0)
  })
})

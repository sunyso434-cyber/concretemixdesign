// analyze 模块测试
// - dataLoader/aggregator：纯 JS，真实代码测试
// - chartRenderer/analyze 完整流程：mock vega-lite 和 vega（ESM-only，jest 默认不 transform）
const path = require('path')
const fs = require('fs').promises
const os = require('os')

const { dataLoader, aggregator, analyze } = require('../../../workspace/analyze')

// Mock vega-lite 和 vega（jest 默认不 transform node_modules 的 ESM）
jest.mock('vega-lite', () => ({
  compile: jest.fn().mockReturnValue({
    spec: { $schema: 'http://fake-vega-spec', marks: [] }
  })
}), { virtual: true })

jest.mock('vega', () => {
  class MockView {
    constructor() {}
    async toSVG() {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'
    }
  }
  return {
    View: MockView,
    parse: jest.fn().mockReturnValue({})
  }
}, { virtual: true })

// 延迟加载 chartRenderer，让上面的 mock 先生效
const chartRenderer = require('../../../workspace/analyze/chartRenderer')

// 临时工作区
let tmpDir

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analyze-test-'))
  const csvContent = `材料,强度,用量
水泥,42.5,300
水泥,52.5,350
粉煤灰,32.5,120
矿渣,42.5,180
水泥,42.5,310
`
  await fs.writeFile(path.join(tmpDir, 'test.csv'), csvContent, 'utf-8')

  const mdContent = `# 测试报告

| 月份 | 销售额 |
|------|--------|
| 1月  | 120    |
| 2月  | 185    |
| 3月  | 210    |
`
  await fs.writeFile(path.join(tmpDir, 'test.md'), mdContent, 'utf-8')
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('dataLoader', () => {
  test('loadCsv 正常加载', async () => {
    const result = await dataLoader.load(tmpDir, { type: 'csv', filePath: 'test.csv' })
    expect(result.columns).toEqual(['材料', '强度', '用量'])
    expect(result.rows.length).toBe(5)
    expect(result.source).toBe('csv')
    expect(typeof result.rows[0][1]).toBe('number')
    expect(result.rows[0][1]).toBe(42.5)
  })

  test('loadWikiTable 正常加载', async () => {
    const md = await fs.readFile(path.join(tmpDir, 'test.md'), 'utf-8')
    const result = dataLoader.loadWikiTable(md)
    expect(result.columns).toEqual(['月份', '销售额'])
    expect(result.rows.length).toBe(3)
    expect(result.source).toBe('wiki')
    expect(result.rows[0][0]).toBe('1月')
    expect(result.rows[0][1]).toBe(120)
  })

  test('loadWikiTable 多表格 + tableIndex', () => {
    const md = `
| A | B |
|---|---|
| 1 | 2 |

| C | D |
|---|---|
| 3 | 4 |
`
    const tables = dataLoader.extractMarkdownTables(md)
    expect(tables.length).toBe(2)
    const r0 = dataLoader.loadWikiTable(md, { tableIndex: 0 })
    expect(r0.columns).toEqual(['A', 'B'])
    const r1 = dataLoader.loadWikiTable(md, { tableIndex: 1 })
    expect(r1.columns).toEqual(['C', 'D'])
  })

  test('不支持的文件格式报错', async () => {
    await expect(dataLoader.load(tmpDir, { type: 'xlsx', filePath: 'a.txt' }))
      .rejects.toThrow(/不支持|UNSUPPORTED_FORMAT/)
  })

  test('参数缺失报错', async () => {
    await expect(dataLoader.load(tmpDir, {})).rejects.toThrow(/必填|PARAM_INVALID/)
  })
})

describe('aggregator', () => {
  const data = {
    columns: ['材料', '强度', '用量'],
    rows: [
      ['水泥', 42.5, 300],
      ['水泥', 52.5, 350],
      ['粉煤灰', 32.5, 120],
      ['矿渣', 42.5, 180],
      ['水泥', 42.5, 310],
    ],
  }

  test('aggregate sum', () => {
    const r = aggregator.aggregate(data, { column: '用量', operation: 'sum' })
    expect(r.rows[0][2]).toBe(1260)
    expect(r.metadata.count).toBe(5)
  })

  test('aggregate avg', () => {
    const r = aggregator.aggregate(data, { column: '强度', operation: 'avg' })
    expect(r.rows[0][2]).toBe(42.5)
  })

  test('aggregate count（非数字也算）', () => {
    const r = aggregator.aggregate(data, { column: '材料', operation: 'count' })
    expect(r.rows[0][2]).toBe(5)
  })

  test('aggregate min/max', () => {
    expect(aggregator.aggregate(data, { column: '强度', operation: 'min' }).rows[0][2]).toBe(32.5)
    expect(aggregator.aggregate(data, { column: '强度', operation: 'max' }).rows[0][2]).toBe(52.5)
  })

  test('aggregate stddev', () => {
    const r = aggregator.aggregate(data, { column: '强度', operation: 'stddev' })
    expect(r.rows[0][2]).toBeGreaterThan(0)
  })

  test('groupBy 分组聚合', () => {
    const r = aggregator.groupBy(data, { groupBy: '材料', column: '用量', operation: 'sum' })
    const rows = r.rows.sort((a, b) => b[1] - a[1])
    expect(rows[0][0]).toBe('水泥')
    expect(rows[0][1]).toBe(960)
    expect(rows[1][0]).toBe('矿渣')
    expect(rows[1][1]).toBe(180)
    expect(rows[2][0]).toBe('粉煤灰')
    expect(rows[2][1]).toBe(120)
  })

  test('groupBy avg', () => {
    const r = aggregator.groupBy(data, { groupBy: '材料', column: '强度', operation: 'avg' })
    const cementRow = r.rows.find(row => row[0] === '水泥')
    expect(cementRow[1]).toBeCloseTo(45.8333, 3)
  })

  test('列不存在报错', () => {
    expect(() => aggregator.aggregate(data, { column: '不存在', operation: 'sum' }))
      .toThrow(/列不存在/)
  })

  test('空值跳过', () => {
    const dataWithEmpty = {
      columns: ['x', 'y'],
      rows: [['a', 1], ['b', ''], ['c', 3]],
    }
    const r = aggregator.aggregate(dataWithEmpty, { column: 'y', operation: 'avg' })
    expect(r.metadata.count).toBe(2)
    expect(r.rows[0][2]).toBe(2)
    expect(r.metadata.skipped).toBe(1)
  })

  test('toNumber 处理百分号', () => {
    expect(aggregator.toNumber('50%')).toBe(0.5)
    expect(aggregator.toNumber('100')).toBe(100)
    expect(aggregator.toNumber('')).toBeNull()
    expect(aggregator.toNumber('abc')).toBeNull()
  })
})

describe('chartRenderer（mock vega）', () => {
  test('渲染柱状图 SVG', async () => {
    const data = {
      columns: ['材料', '用量'],
      rows: [['水泥', 960], ['矿渣', 180], ['粉煤灰', 120]],
    }
    const { svg, spec } = await chartRenderer.render(data, {
      chartType: 'bar',
      title: '材料用量统计',
    })
    expect(svg).toContain('<svg')
    expect(svg.length).toBeGreaterThan(50)
    expect(spec.mark.type).toBe('bar')
  })

  test('渲染折线图 SVG', async () => {
    const data = {
      columns: ['月份', '销售额'],
      rows: [['1月', 120], ['2月', 185], ['3月', 210]],
    }
    const { svg } = await chartRenderer.render(data, { chartType: 'line' })
    expect(svg).toContain('<svg')
  })

  test('渲染饼图 SVG', async () => {
    const data = {
      columns: ['材料', '占比'],
      rows: [['水泥', 76], ['矿渣', 14], ['粉煤灰', 10]],
    }
    const { svg } = await chartRenderer.render(data, { chartType: 'pie' })
    expect(svg).toContain('<svg')
  })

  test('renderAndSave 保存到文件', async () => {
    const data = { columns: ['x', 'y'], rows: [['a', 1], ['b', 2], ['c', 3]] }
    const result = await chartRenderer.renderAndSave(data, { chartType: 'bar' }, tmpDir)
    expect(result.svgRelPath).toMatch(/^reports\/_images\/chart_.*\.svg$/)
    const exists = await fs.access(path.join(tmpDir, result.svgRelPath)).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  test('字段类型推断', () => {
    expect(chartRenderer.inferFieldType([1, 2, 3])).toBe('quantitative')
    expect(chartRenderer.inferFieldType(['a', 'b', 'c'])).toBe('nominal')
    expect(chartRenderer.inferFieldType(['2026-01-01', '2026-02-01'])).toBe('temporal')
  })

  test('不支持的图表类型报错', async () => {
    const data = { columns: ['x', 'y'], rows: [['a', 1]] }
    await expect(chartRenderer.render(data, { chartType: 'unknown' })).rejects.toThrow(/不支持|PARAM_INVALID/)
  })
})

describe('analyze 完整流程', () => {
  test('统计 + 画图 + 保存', async () => {
    const result = await analyze(tmpDir, {
      source: { type: 'csv', filePath: 'test.csv' },
      stats: { type: 'groupBy', groupBy: '材料', column: '用量', operation: 'sum' },
      chart: { chartType: 'bar' },
    })
    expect(result.data.columns).toEqual(['材料', '强度', '用量'])
    expect(result.data.rows.length).toBe(5)
    expect(result.stats.rows.length).toBe(3)
    const cementRow = result.stats.rows.find(r => r[0] === '水泥')
    expect(cementRow[1]).toBe(960)
    expect(result.chart.svgRelPath).toMatch(/^reports\/_images\/chart_.*\.svg$/)
    const exists = await fs.access(path.join(tmpDir, result.chart.svgRelPath)).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  test('只统计不画图', async () => {
    const result = await analyze(tmpDir, {
      source: { type: 'csv', filePath: 'test.csv' },
      stats: { type: 'aggregate', column: '用量', operation: 'sum' },
    })
    expect(result.stats.rows[0][2]).toBe(1260)
    expect(result.chart).toBeUndefined()
  })

  test('只画图不统计', async () => {
    const result = await analyze(tmpDir, {
      source: { type: 'csv', filePath: 'test.csv' },
      chart: { chartType: 'scatter', xField: '强度', yField: '用量' },
    })
    expect(result.stats).toBeUndefined()
    expect(result.chart.svgRelPath).toMatch(/^reports\/_images\/chart_.*\.svg$/)
  })
})

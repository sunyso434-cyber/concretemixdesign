// analyze 入口模块：把 dataLoader + aggregator + chartRenderer 串起来
//
// 提供统一接口 analyze()，方便 workspaceTools.js 调用
const dataLoader = require('./dataLoader')
const aggregator = require('./aggregator')
const chartRenderer = require('./chartRenderer')
const { WorkspaceError } = require('../WorkspaceError')

/**
 * 完整分析流程：加载数据 → 统计 → 渲染图表 → 保存
 *
 * @param {string} workspacePath - 工作区根目录
 * @param {Object} opts
 * @param {Object} opts.source - 数据源
 *   - { type: 'xlsx'|'csv', filePath: '相对路径' }
 *   - { type: 'wiki', markdown: 'markdown 全文' }
 * @param {Object} [opts.stats] - 统计配置
 *   - { type: 'aggregate', column: '销售额', operation: 'sum' }
 *   - { type: 'groupBy', groupBy: '材料', column: '强度', operation: 'avg' }
 * @param {Object} [opts.chart] - 图表配置
 *   - { chartType: 'bar', xField: '材料', yField: 'avg(强度)', title: '...' }
 *   - 不传 → 不画图，只返回统计结果
 * @returns {Promise<{
 *   data: {columns, rows, source},
 *   stats?: {columns, rows, metadata},
 *   chart?: {svgPath, svgRelPath, spec}
 * }>}
 */
async function analyze(workspacePath, opts) {
  if (!opts || !opts.source) {
    throw new WorkspaceError('PARAM_INVALID', 'opts.source 必填', false)
  }

  // ① 加载数据
  const data = await dataLoader.load(workspacePath, opts.source)

  let result = { data }

  // ② 统计（可选）
  if (opts.stats) {
    if (opts.stats.type === 'aggregate') {
      result.stats = aggregator.aggregate(data, opts.stats)
    } else if (opts.stats.type === 'groupBy') {
      result.stats = aggregator.groupBy(data, opts.stats)
    } else {
      throw new WorkspaceError('PARAM_INVALID', `不支持的 stats.type: ${opts.stats.type}（可用: aggregate / groupBy）`, false)
    }

    // 如果有统计结果且要画图，用统计结果作为图表数据源
    if (opts.chart && result.stats.rows.length > 0) {
      // 智能补全 chart 字段（如果用户没指定）
      const statsCols = result.stats.columns
      const chart = { ...opts.chart }
      if (!chart.xField && statsCols.length >= 1) chart.xField = statsCols[0]
      if (!chart.yField && statsCols.length >= 2) chart.yField = statsCols[1]
      if (!chart.title && opts.stats.type === 'groupBy') {
        chart.title = `${opts.stats.operation}(${opts.stats.column}) by ${opts.stats.groupBy}`
      }

      result.chart = await chartRenderer.renderAndSave(result.stats, chart, workspacePath)
    }
  } else if (opts.chart && data.rows.length > 0) {
    // 直接对原始数据画图
    const chart = { ...opts.chart }
    if (!chart.xField && data.columns.length >= 1) chart.xField = data.columns[0]
    if (!chart.yField && data.columns.length >= 2) chart.yField = data.columns[1]
    if (!chart.title) chart.title = `${chart.yField} by ${chart.xField}`

    result.chart = await chartRenderer.renderAndSave(data, chart, workspacePath)
  }

  return result
}

module.exports = {
  analyze,
  dataLoader,
  aggregator,
  chartRenderer,
}

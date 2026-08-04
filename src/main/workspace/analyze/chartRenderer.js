// 图表渲染器：把数据 + 图表配置渲染成 SVG 图片
//
// 设计：
//   - vega-lite v6.x 是 ESM 模块，项目是 CommonJS → 用动态 import()
//   - 两个模块只 import 一次，缓存复用
//   - 输出 SVG 字符串 + 文件落盘到 reports/_images/
//
// 图表类型映射：
//   bar       柱状图（分类 vs 数值）
//   line      折线图（趋势）
//   area      面积图
//   pie       饼图（占比）— vega-lite 用 arc mark
//   scatter   散点图（两个数值维度）
//   histogram 直方图（自动 bin）
//
// 配色方案（符合老板要求：语义色 + 信息层级清晰）：
//   - 默认用 vega-lite 内置的 category10 配色
//   - 数值型用 sequential 蓝色渐变
//   - 强调色用 #FA8C16（antd 橙色）

const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { WorkspaceError } = require('../WorkspaceError')

// 缓存 ESM 模块（避免每次 import 的开销）
let _vegaLite = null
let _vega = null

async function loadModules() {
  if (!_vegaLite) _vegaLite = await import('vega-lite')
  if (!_vega) _vega = await import('vega')
  return { vegaLite: _vegaLite, vega: _vega }
}

/**
 * 字段类型推断
 * - 全数字 → quantitative
 * - 看着像日期 → temporal
 * - 其他 → nominal
 */
function inferFieldType(values) {
  if (!values || values.length === 0) return 'nominal'
  let numCount = 0
  let dateCount = 0
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== '')) {
      numCount++
    } else if (v instanceof Date || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(v))) {
      dateCount++
    }
  }
  const total = numCount + dateCount
  if (numCount / values.length > 0.7) return 'quantitative'
  if (dateCount > 0 && dateCount / values.length > 0.5) return 'temporal'
  return 'nominal'
}

/**
 * 根据 chartType + encoding 生成 vega-lite spec
 */
function buildVegaLiteSpec(data, opts) {
  const { columns, rows } = data
  const chartType = opts.chartType || 'bar'

  // 把二维数组转成 vega-lite 要的对象数组
  const values = rows.map(row => {
    const obj = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })
    return obj
  })

  const xField = opts.xField || columns[0]
  const yField = opts.yField || columns[1]
  if (!xField || !yField) {
    throw new WorkspaceError('PARAM_INVALID', '图表至少需要 2 列（xField 和 yField）', false)
  }

  // 字段类型
  const xColIdx = columns.indexOf(xField)
  const yColIdx = columns.indexOf(yField)
  const xValues = values.map(v => v[xField])
  const yValues = values.map(v => v[yField])

  const encoding = {
    x: { field: xField, type: opts.xType || inferFieldType(xValues) },
    y: { field: yField, type: opts.yType || inferFieldType(yValues) },
  }

  // 颜色编码（可选）
  if (opts.colorField) {
    const colorColIdx = columns.indexOf(opts.colorField)
    if (colorColIdx >= 0) {
      const colorValues = values.map(v => v[opts.colorField])
      encoding.color = {
        field: opts.colorField,
        type: opts.colorType || inferFieldType(colorValues),
        scheme: opts.colorType === 'quantitative' ? 'blues' : undefined,
      }
    }
  }

  // 标题
  const title = opts.title || `${yField} by ${xField}`

  // 通用 spec
  const spec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: opts.width || 500,
    height: opts.height || 300,
    title: { text: title, anchor: 'middle', fontSize: 14 },
    data: { values },
    encoding,
    config: {
      // 微信风格背景色 + 字体
      background: '#ffffff',
      font: 'sans-serif',
      view: { stroke: 'transparent' },
      axis: {
        labelFontSize: 11,
        titleFontSize: 12,
        titleColor: '#333',
        labelColor: '#666',
        domainColor: '#d9d9d9',
        tickColor: '#d9d9d9',
        gridColor: '#f0f0f0',
      },
      legend: {
        labelFontSize: 11,
        titleFontSize: 12,
      },
      // 强调色（鼠标悬停时）
      mark: { opacity: 0.85 },
    },
  }

  // 根据图表类型调整 mark
  switch (chartType) {
    case 'bar':
      spec.mark = { type: 'bar', cornerRadiusEnd: 2 }
      break
    case 'bar-horizontal':
      spec.mark = { type: 'bar', cornerRadiusEnd: 2 }
      // 水平柱状图：交换 x 和 y
      const tmpX = encoding.x
      encoding.x = encoding.y
      encoding.y = tmpX
      break
    case 'line':
      spec.mark = { type: 'line', strokeWidth: 2, point: true }
      // 折线图 X 轴通常是时间或有序类别
      if (encoding.x.type === 'quantitative') encoding.x.type = 'ordinal'
      break
    case 'area':
      spec.mark = { type: 'area', opacity: 0.6 }
      if (encoding.x.type === 'quantitative') encoding.x.type = 'ordinal'
      break
    case 'scatter':
      spec.mark = { type: 'circle', size: 60, opacity: 0.7 }
      break
    case 'histogram':
      spec.mark = { type: 'bar', cornerRadiusEnd: 2 }
      // 直方图：对 yField 做 bin
      spec.encoding = {
        x: { field: yField, bin: true, type: 'quantitative' },
        y: { aggregate: 'count', type: 'quantitative', title: '频次' },
      }
      break
    case 'pie':
      spec.mark = { type: 'arc', innerRadius: 50 }
      spec.encoding = {
        theta: { field: yField, type: 'quantitative' },
        color: { field: xField, type: 'nominal', legend: true },
      }
      break
    default:
      throw new WorkspaceError('PARAM_INVALID', `不支持的图表类型: ${chartType}（可用: bar/bar-horizontal/line/area/scatter/histogram/pie）`, false)
  }

  // 用户自定义配置覆盖
  if (opts.spec) {
    return { ...spec, ...opts.spec }
  }
  return spec
}

/**
 * 渲染 SVG
 * @param {{columns: string[], rows: Array[]}} data
 * @param {Object} opts
 * @param {string} [opts.chartType='bar'] - 图表类型
 * @param {string} [opts.xField]
 * @param {string} [opts.yField]
 * @param {string} [opts.colorField]
 * @param {string} [opts.title]
 * @param {number} [opts.width=500]
 * @param {number} [opts.height=300]
 * @returns {Promise<{svg: string, spec: Object}>}
 */
async function render(data, opts = {}) {
  const { vegaLite, vega } = await loadModules()

  let vlSpec
  try {
    vlSpec = buildVegaLiteSpec(data, opts)
  } catch (err) {
    if (err instanceof WorkspaceError) throw err
    throw new WorkspaceError('SPEC_BUILD_FAIL', `生成图表配置失败: ${err.message}`, false, err)
  }

  try {
    // vega-lite → vega spec
    const vgSpec = vegaLite.compile(vlSpec).spec
    // vega spec → SVG
    const view = new vega.View(vega.parse(vgSpec), { renderer: 'none' })
    const svg = await view.toSVG()

    if (!svg || !svg.includes('<svg')) {
      throw new Error('SVG 输出为空或格式错误')
    }

    return { svg, spec: vlSpec }
  } catch (err) {
    throw new WorkspaceError('RENDER_FAIL', `图表渲染失败: ${err.message}`, false, err)
  }
}

/**
 * 渲染并保存到文件
 * @param {{columns: string[], rows: Array[]}} data
 * @param {Object} opts - 同 render
 * @param {string} workspacePath - 工作区根目录
 * @param {string} [outputDir='reports/_images'] - 图片存放子目录
 * @returns {Promise<{svgPath: string, svgRelPath: string, svg: string, spec: Object}>}
 *   svgRelPath 是相对工作区的路径，用于 markdown 引用
 */
async function renderAndSave(data, opts, workspacePath, outputDir = 'reports/_images') {
  const { svg, spec } = await render(data, opts)

  const imgDir = path.posix.join(workspacePath, outputDir)
  await fs.mkdir(imgDir, { recursive: true })

  // 文件名：用 spec 的 hash 避免重复 + 短前缀
  const hash = crypto.createHash('md5').update(JSON.stringify(spec)).digest('hex').slice(0, 8)
  const fileName = `chart_${Date.now()}_${hash}.svg`
  const absPath = path.join(imgDir, fileName)

  await fs.writeFile(absPath, svg, 'utf-8')

  return {
    svgPath: absPath,
    svgRelPath: path.posix.join(outputDir, fileName),
    svg,
    spec,
  }
}

module.exports = {
  render,
  renderAndSave,
  buildVegaLiteSpec,
  inferFieldType,
}

/**
 * OfficeCLI 桥接层
 * 职责：管理二进制路径、封装子进程调用、统一错误处理
 *
 * 路径策略：
 *   开发环境（NODE_ENV=development）：resources/officecli/<platform>/
 *   生产环境（打包后）：process.resourcesPath/officecli/
 *
 * OfficeCLI 命令格式（v1.0.x）：
 *   officecli <command> <file> [options]
 *   例如：officecli view <file> text
 *         officecli set <file> <path> <value>
 *
 * 调用策略：
 *   所有命令使用 execFileSync（数组参数，不过 cmd.exe，避免中文/空格转义问题）
 */

const path = require('path')
const { execFile, execFileSync } = require('child_process')

const PLATFORM_MAP = {
  win32: { dir: 'win', binary: 'officecli.exe' },
  darwin: { dir: 'mac', binary: 'officecli' },
  linux: { dir: 'linux', binary: 'officecli' },
}

/**
 * 获取 OfficeCLI 二进制路径
 * @returns {string} 二进制绝对路径
 * @throws {Error} 当平台不支持或二进制不存在时
 */
function getBinaryPath() {
  const platformCfg = PLATFORM_MAP[process.platform]
  if (!platformCfg) {
    throw new Error(`OfficeCLI 不支持当前平台: ${process.platform}`)
  }

  let baseDir
  if (process.env.NODE_ENV === 'development' || !process.resourcesPath) {
    // 开发环境：从项目目录加载（目录名与 electron-builder ${os} 一致：win/mac/linux）
    baseDir = path.join(__dirname, '..', '..', '..', 'resources', 'officecli', platformCfg.dir)
  } else {
    // 生产环境：从 Electron resources 加载
    // extraResources 配置把二进制平铺到 resources/officecli/<binary>（与历史打包结构一致）
    baseDir = path.join(process.resourcesPath, 'officecli')
  }

  return path.join(baseDir, platformCfg.binary)
}

/**
 * 验证 OfficeCLI 是否可用
 * @returns {{ available: boolean, version?: string, path?: string, error?: string }}
 */
function checkAvailability() {
  try {
    const binaryPath = getBinaryPath()
    const result = execFileSync(binaryPath, ['--version'], { timeout: 5000, encoding: 'utf-8' })
    return {
      available: true,
      version: result.trim(),
      path: binaryPath,
    }
  } catch (err) {
    return {
      available: false,
      error: err.message,
    }
  }
}

/**
 * 同步执行 OfficeCLI 命令（使用 execFileSync 避免 shell 转义问题）
 * @param {string[]} args - 命令参数数组，如 ['view', '"path/to/file.docx"', 'text']
 * @param {Object} [options]
 * @param {number} [options.timeout=30000] - 超时毫秒
 * @param {string} [options.input] - 标准输入内容（用于 batch 模式）
 * @returns {{ stdout: string, stderr: string }}
 * @throws {Error} 二进制不存在或命令执行失败
 */
function execOfficeCliSync(args, options = {}) {
  const binaryPath = getBinaryPath()

  try {
    const stdout = execFileSync(binaryPath, args, {
      timeout: options.timeout || 30000,
      encoding: 'utf-8',
      input: options.input,
      maxBuffer: 50 * 1024 * 1024, // 50MB，大文档用
    })
    return { stdout: stdout.trim(), stderr: '' }
  } catch (err) {
    // execFileSync 在非零退出码时抛错，stderr 在 err.stderr 中
    const errMsg = err.stderr || err.message || 'OfficeCLI 执行失败'
    throw new Error(`OfficeCLI 错误: ${errMsg}`)
  }
}

/**
 * 异步执行 OfficeCLI 命令（使用 execFile 避免 shell 转义问题）
 * @param {string[]} args - 命令参数数组
 * @param {Object} [options]
 * @param {number} [options.timeout=60000]
 * @param {string} [options.input]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function execOfficeCliAsync(args, options = {}) {
  const binaryPath = getBinaryPath()

  return new Promise((resolve, reject) => {
    const proc = execFile(binaryPath, args, {
      timeout: options.timeout || 60000,
      encoding: 'utf-8',
      input: options.input,
      maxBuffer: 50 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message || 'OfficeCLI 执行失败'))
        return
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

/**
 * 读取 Office 文件的结构化大纲（JSON）
 * 对应 CLI: view <file> outline --json
 * @param {string} filePath - 文件绝对路径
 * @returns {Object} { paragraphs, tables, images, headings, ... }
 */
function readFileStructure(filePath) {
  const result = execOfficeCliSync(['view', filePath, 'outline', '--json'])
  return JSON.parse(result.stdout)
}

/**
 * 读取 Office 文件的统计信息（JSON）
 * 对应 CLI: view <file> stats --json
 * @param {string} filePath
 * @returns {Object}
 */
function readFileStats(filePath) {
  const result = execOfficeCliSync(['view', filePath, 'stats', '--json'])
  return JSON.parse(result.stdout)
}

/**
 * 读取 Office 文件的文本内容
 * @param {string} filePath
 * @returns {string} 纯文本
 */
function readFileAsText(filePath) {
  const result = execOfficeCliSync(['view', filePath, 'text'])
  return result.stdout
}

/**
 * 读取 Office 文件的带路径标注的内容（JSON 包裹）
 * 对应 CLI: view <file> annotated --json
 * 返回 { success, data: { view, content } }，content 中每行带路径前缀如 [/body/p[...]]
 * @param {string} filePath
 * @returns {Object}
 */
function readFileAsAnnotated(filePath) {
  const result = execOfficeCliSync(['view', filePath, 'annotated', '--json'])
  return JSON.parse(result.stdout)
}

/**
 * 编辑 Office 文件：设置指定元素的文本内容+格式属性
 * 对应 CLI: set <file> <path> --prop key1=val1 --prop key2=val2 ...
 *
 * 常用格式属性（v11.7.0 完整列表）：
 *   段落：align, style, indent, firstLineIndent, hangingIndent, rightIndent,
 *         lineSpacing, lineRule, spaceBefore, spaceAfter, spaceBeforeAuto, spaceAfterAuto,
 *         keepNext, keepLines, pageBreakBefore, widowControl, wordWrap, contextualSpacing,
 *         numId, numLevel, listStyle, start
 *   字体（run/paragraph 继承）：bold, italic, underline, strike, dstrike,
 *         color, highlight, size, caps, smallcaps, vanish, charSpacing, vertAlign
 *   字体槽：font.latin（西文=新罗马 Times New Roman）、font.ea（东亚=仿宋/黑体）、
 *         font.cs（复杂脚本）、font.hint（hint 提示）
 *   text effect：outline, shadow, emboss, imprint
 *
 * 错误码：UNSUPPORTED_PROP（属性名拼错或 officecli 不支持）
 *
 * @param {string} filePath
 * @param {string} elementPath - OfficeCLI 路径表达式，如 "/body/p[4]" 或 "/body/p[4]/r[1]"
 * @param {string} value - 新文本（传空字符串则不修改文本）
 * @param {Object} [props] - 格式属性键值对
 * @returns {{ stdout: string }}
 */
function setElementText(filePath, elementPath, value, props = {}) {
  const args = ['set', filePath, elementPath]
  // 如果传了 value 就加 text 属性
  if (value !== undefined && value !== null) {
    args.push('--prop', `text=${value}`)
  }
  // 添加格式属性
  for (const [key, val] of Object.entries(props)) {
    args.push('--prop', `${key}=${val}`)
  }
  // ponytail: 走 module.exports 让测试能 spyOn(bridge, 'execOfficeCliSync') 截到内部调用
  return module.exports.execOfficeCliSync(args)
}

/**
 * 编辑 Office 文件：在元素内查找替换文本
 * 对应 CLI: set <file> <path> --find <find> --replace <replace>
 * @param {string} filePath
 * @param {string} elementPath - OfficeCLI 路径表达式
 * @param {string} find - 要查找的文本
 * @param {string} replace - 替换文本
 * @returns {{ stdout: string }}
 */
function replaceText(filePath, elementPath, find, replace) {
  return execOfficeCliSync(['set', filePath, elementPath, '--find', find, '--replace', replace])
}

/**
 * 编辑 Office 文件：批量执行操作（batch 模式）
 * @param {string} filePath
 * @param {Array<{ action: string, path?: string, value?: string }>} operations
 * @returns {{ stdout: string }}
 */
function batchEdit(filePath, operations) {
  const batchJson = JSON.stringify({ file: filePath, operations })
  return execOfficeCliSync(['batch', filePath], { input: batchJson })
}

/**
 * 批量执行 officecli batch 命令（v11.7.0 新增）
 * 对应 CLI: batch <file> --commands '[{...}, ...]'
 * 操作数组按 officecli 真实 schema 写：{command, parent, path, selector, type, props, to, after, before, path2}
 * @param {string} filePath
 * @param {Array<Object>} commands - officecli 批命令数组
 * @param {Object} [options]
 * @param {string} [options.input] - 若 commands 太大，改用 stdin 传 JSON
 * @returns {{ stdout: string }}
 */
function batchExecute(filePath, commands, options = {}) {
  const json = JSON.stringify(commands)
  // ponytail: < 50KB 走 --commands 参数，否则 stdin，避免命令行长度超限
  if (json.length < 50_000 && !options.input) {
    // ponytail: 走 module.exports 让测试能 spyOn(bridge, 'execOfficeCliSync') 截到内部调用
    return module.exports.execOfficeCliSync(['batch', filePath, '--commands', json])
  }
  return module.exports.execOfficeCliSync(['batch', filePath], { input: json })
}

/**
 * 在指定父容器下添加表格（v11.7.0 新增）
 * 对应 CLI: add <file> <parent-path> --type table --prop rows=N --prop cols=N --prop colWidths=...
 * 列宽用 OOXML twentieths-of-a-point 单位（1cm≈567，1英寸=1440），半角逗号分隔
 *
 * @param {string} filePath
 * @param {string} parentPath - 父容器路径，如 "/body"（追加到末尾）
 * @param {Object} opts
 * @param {number} opts.rows - 行数（≥1）
 * @param {number} opts.cols - 列数（≥1）
 * @param {string[]} [opts.colWidths] - 每列宽度（OOXML 单位）
 * @param {Array} [opts.rowsData] - 二维数组，每行每个单元格是字符串 或 {text, props}
 * @param {Object} [opts.props] - 表格级属性：align/indent/cellSpacing/padding/layout/caption/description
 * @param {string} [opts.after] - 在此元素之后插入
 * @param {string} [opts.before] - 在此元素之前插入
 * @returns {{ stdout: string }}
 */
function addTable(filePath, parentPath, opts) {
  if (!opts || !opts.rows || !opts.cols) {
    throw new Error('addTable 需要 opts.rows 和 opts.cols（正整数）')
  }
  const args = ['add', filePath, parentPath, '--type', 'table']
  if (opts.after) args.push('--after', opts.after)
  if (opts.before) args.push('--before', opts.before)
  args.push('--prop', `rows=${opts.rows}`)
  args.push('--prop', `cols=${opts.cols}`)
  if (opts.colWidths && opts.colWidths.length) {
    args.push('--prop', `colWidths=${opts.colWidths.join(',')}`)
  }
  if (opts.props) {
    for (const [k, v] of Object.entries(opts.props)) {
      args.push('--prop', `${k}=${v}`)
    }
  }
  // ponytail: 走 module.exports 让测试能 spyOn(bridge, 'execOfficeCliSync') 截到内部调用
  const result = module.exports.execOfficeCliSync(args)

  // ponytail: rowsData 走 setElementText 二次写入，避免 officecli 不支持的 --prop rows=JSON 形式
  if (opts.rowsData && result.stdout) {
    const newPath = result.stdout.match(/\/body\/tbl\[\d+\]/)?.[0]
    if (newPath) {
      for (let r = 0; r < opts.rowsData.length; r++) {
        for (let c = 0; c < opts.rowsData[r].length; c++) {
          const cell = opts.rowsData[r][c]
          const text = typeof cell === 'string' ? cell : (cell.text || '')
          const props = typeof cell === 'string' ? null : (cell.props || null)
          setElementText(filePath, `${newPath}/tr[${r + 1}]/tc[${c + 1}]`, text, props || {})
        }
      }
    }
  }
  return result
}

/**
 * 移动元素到新位置（v11.7.0 新增）
 * 对应 CLI: move <file> <path> --after <target> 或 --to <parent>
 * @param {string} filePath
 * @param {string} sourcePath - 源元素路径
 * @param {string} targetAfter - 目标路径（移到其后）
 * @returns {{ stdout: string }}
 */
function moveElement(filePath, sourcePath, targetAfter) {
  return module.exports.execOfficeCliSync(['move', filePath, sourcePath, '--after', targetAfter])
}

/**
 * 交换两个元素位置（v11.7.0 新增）
 * 对应 CLI: swap <file> <path1> <path2>
 * @param {string} filePath
 * @param {string} path1
 * @param {string} path2
 * @returns {{ stdout: string }}
 */
function swapElements(filePath, path1, path2) {
  return module.exports.execOfficeCliSync(['swap', filePath, path1, path2])
}

/**
 * 用 CSS-like selector 查询文档元素（v11.7.0 新增；v0.3.2 修 bug+加 options）
 * 对应 CLI: query <file> <selector> [--json] [--find <text>] [--compact] [--fields x,y]
 * @param {string} filePath
 * @param {Object|string} selector - 如 {element:'p'} 或 'paragraph[style=Normal] > run[font!=Arial]'
 * @param {Object} [opts]
 * @param {string} [opts.find] - 按文本大小写不敏感子串过滤
 * @param {boolean} [opts.compact] - 紧凑模式：每元素一行 path<TAB>[label]<TAB>"text"
 * @param {string} [opts.fields] - 追加额外列，如 'x,y,width'
 * @returns {Object|string} 默认返回 JSON 对象；compact 模式返回文本
 */
function queryElements(filePath, selector, opts = {}) {
  const selStr = typeof selector === 'string' ? selector : JSON.stringify(selector)
  const args = ['query', filePath, selStr]
  if (opts.compact) {
    // compact 模式输出文本表格，不加 --json
    if (opts.find) args.push('--find', opts.find)
    args.push('--compact')
    if (opts.fields) args.push('--fields', opts.fields)
    const result = module.exports.execOfficeCliSync(args)
    return result.stdout
  }
  args.push('--json')
  if (opts.find) args.push('--find', opts.find)
  if (opts.fields) args.push('--fields', opts.fields)
  const result = module.exports.execOfficeCliSync(args)
  return JSON.parse(result.stdout)
}

/**
 * 校验文档 OpenXML schema 合法性（v11.7.0 新增）
 * 对应 CLI: validate <file>
 * @param {string} filePath
 * @returns {{ stdout: string }}
 */
function validateDocument(filePath) {
  return module.exports.execOfficeCliSync(['validate', filePath])
}

/**
 * 刷新目录/页码/交叉引用（v11.7.0 新增；v0.3.2 加 --json）
 * 对应 CLI: refresh <file> [--json]
 * 重算范围：TOC 页码、PAGE/NUMPAGES 域、交叉引用
 * 限制：仅 .docx + Windows + Word 环境可用
 * @param {string} filePath
 * @returns {Object} 刷新结果 JSON
 */
function refreshDocument(filePath) {
  const result = module.exports.execOfficeCliSync(['refresh', filePath, '--json'])
  try {
    return JSON.parse(result.stdout)
  } catch {
    // 某些环境下 refresh 可能不支持 --json，回退原始输出
    return { success: true, message: result.stdout }
  }
}

/**
 * 导入 CSV/TSV 到 Excel sheet（v11.7.0 新增）
 * 对应 CLI: import <target> <parent> <source> [--sheet name] [--startCell A1] [--delimiter ,]
 * @param {string} targetFile - 目标 xlsx 文件
 * @param {string} parentPath - 父容器路径，如 "/"
 * @param {string} sourceFile - CSV/TSV 源文件绝对路径
 * @param {Object} [opts]
 * @param {string} [opts.sheet] - sheet 名称
 * @param {string} [opts.startCell] - 起始单元格，如 "A1"
 * @param {string} [opts.delimiter] - 分隔符，默认 ","
 * @returns {{ stdout: string }}
 */
function importCsv(targetFile, parentPath, sourceFile, opts = {}) {
  const args = ['import', targetFile, parentPath, sourceFile]
  if (opts.sheet) args.push('--sheet', opts.sheet)
  if (opts.startCell) args.push('--startCell', opts.startCell)
  if (opts.delimiter) args.push('--delimiter', opts.delimiter)
  return module.exports.execOfficeCliSync(args)
}

/**
 * 启动驻留进程（v11.7.0 新增，加速后续操作）
 * 对应 CLI: open <file>
 * @param {string} filePath
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function openDocumentResident(filePath) {
  return module.exports.execOfficeCliAsync(['open', filePath])
}

/**
 * 落盘保存（驻留模式保持运行，v11.7.0 新增）
 * 对应 CLI: save <file>
 * @param {string} filePath
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function saveDocumentResident(filePath) {
  return module.exports.execOfficeCliAsync(['save', filePath])
}

/**
 * 落盘并停止驻留进程（v11.7.0 新增）
 * 对应 CLI: close <file>
 * @param {string} filePath
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function closeDocumentResident(filePath) {
  return module.exports.execOfficeCliAsync(['close', filePath])
}

/**
 * 生成子树重放 batch 脚本（v11.7.0 新增，P2）
 * 对应 CLI: dump <file> <path>
 * @param {string} filePath
 * @param {string} [subtreePath='/'] - 子树路径
 * @returns {string} 可重放的 batch 脚本
 */
function dumpSubtree(filePath, subtreePath = '/') {
  return module.exports.execOfficeCliSync(['dump', filePath, subtreePath]).stdout
}

/**
 * 读取 XML part 原始内容（v11.7.0 新增，P2 逃生口）
 * 对应 CLI: raw <file> <part>
 * @param {string} filePath
 * @param {string} [part='/document']
 * @returns {string} XML 内容
 */
function rawPart(filePath, part = '/document') {
  return module.exports.execOfficeCliSync(['raw', filePath, part]).stdout
}

/**
 * 写入 XML part（v11.7.0 新增，P2 逃生口，会损坏文件请先备份）
 * 对应 CLI: raw-set <file> <part>
 * @param {string} filePath
 * @param {string} part - "/document" 等
 * @param {string} content - XML 内容
 * @returns {{ stdout: string }}
 */
function rawSetPart(filePath, part, content) {
  return module.exports.execOfficeCliSync(['raw-set', filePath, part], { input: content })
}

/**
 * 创建新 document part（v11.7.0 新增，P2 逃生口）
 * 对应 CLI: add-part <file> <parent>
 * @param {string} filePath
 * @param {string} parent
 * @param {string} content
 * @returns {{ stdout: string }}
 */
function addPart(filePath, parent, content) {
  return module.exports.execOfficeCliSync(['add-part', filePath, parent], { input: content })
}

/**
 * 查询 officecli 的 schema-driven 帮助信息（v11.7.0 新增）
 * 对应 CLI: help <format> [verb] [element] [--json]
 * @param {Object} opts
 * @param {string} opts.format - docx / xlsx / pptx / all
 * @param {string} [opts.verb] - add / set / get / query / remove / any
 * @param {string} [opts.element] - 元素名如 paragraph / table / run / body
 * @param {boolean} [opts.json=false] - 输出 JSON 格式
 * @returns {string|Object} 帮助文本 或 JSON 对象
 */
function officecliHelp(opts = {}) {
  const args = ['help', opts.format || 'all']
  if (opts.verb && opts.verb !== 'any') args.push(opts.verb)
  if (opts.element) args.push(opts.element)
  if (opts.json) args.push('--json')
  const result = module.exports.execOfficeCliSync(args)
  if (opts.json) {
    try { return JSON.parse(result.stdout) } catch { return result.stdout }
  }
  return result.stdout
}

/**
 * 将 Office 文件渲染为 HTML
 * @param {string} filePath
 * @returns {string} HTML 内容
 */
function renderAsHtml(filePath) {
  const result = execOfficeCliSync(['view', filePath, 'html'])
  return result.stdout
}

/**
 * 创建空白 Office 文档
 * 对应 CLI: create <file> --type <type> --force
 * @param {string} filePath - 输出文件路径
 * @param {string} [type] - 文档类型 docx/xlsx/pptx（默认从扩展名推断）
 * @returns {{ stdout: string }}
 */
function createDocument(filePath, type) {
  const args = ['create', filePath, '--force']
  if (type) args.push('--type', type)
  return execOfficeCliSync(args)
}

/**
 * 模板合并：用 JSON 数据填充模板中的 {{key}} 占位符
 * 对应 CLI: merge <template> <output> --data <json>
 *
 * 如果 data 是对象，序列化为 JSON 字符串传参。
 * 数据较大时建议先存为 .json 文件传文件路径。
 * @param {string} templatePath - 模板文件路径 (.docx/.xlsx/.pptx)
 * @param {string} outputPath - 输出文件路径
 * @param {Object|string} data - JSON 数据对象，或 .json 文件路径
 * @param {Object} [options]
 * @param {boolean} [options.force=true] - 覆盖已有文件
 * @returns {{ stdout: string }}
 */
function mergeTemplate(templatePath, outputPath, data, options = {}) {
  const dataArg = typeof data === 'string' ? data : JSON.stringify(data)
  const args = ['merge', templatePath, outputPath, '--data', dataArg]
  if (options.force !== false) args.push('--force')
  return execOfficeCliSync(args)
}

module.exports = {
  getBinaryPath,
  checkAvailability,
  execOfficeCliSync,
  execOfficeCliAsync,
  readFileStructure,
  readFileStats,
  readFileAsText,
  readFileAsAnnotated,
  setElementText,
  replaceText,
  batchEdit,
  batchExecute,
  addTable,
  moveElement,          // v11.7.0 P1
  swapElements,         // v11.7.0 P1
  queryElements,        // v11.7.0 P1
  validateDocument,     // v11.7.0 P1
  refreshDocument,      // v11.7.0 P1
  importCsv,            // v11.7.0 P1
  openDocumentResident, // v11.7.0 P1
  saveDocumentResident, // v11.7.0 P1
  closeDocumentResident,// v11.7.0 P1
  dumpSubtree,          // v11.7.0 P2
  rawPart,              // v11.7.0 P2
  rawSetPart,           // v11.7.0 P2
  addPart,              // v11.7.0 P2
  officecliHelp,        // v11.7.0
  renderAsHtml,
  createDocument,
  mergeTemplate,
}

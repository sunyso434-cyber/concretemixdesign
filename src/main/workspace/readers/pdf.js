// pdf reader：读取 .pdf 文件
// - 用 pdf-parse (v2.x, 基于 pdf.js) 提取文字层
// - 无文字层（扫描件）抛 PARSE_FAIL
// - 加密 / 损坏 / 解析异常抛 PARSE_FAIL
//
// 所有失败抛 WorkspaceError（带 code + retryable）。
// size 限制：200 MB（> 200MB 触发 SIZE_EXCEEDED，retryable=false）
const fs = require('fs').promises
// P1 补全 v4.8.5: pdf-parse v2 基于 pdf.js，依赖 DOMMatrix
//   - Node 16.13.2（Electron 18.18.2 内嵌）无 DOMMatrix → "DOMMatrix is not defined"
//   - Node 20+ 有原生，自动跳过
// 在 require('pdf-parse') 之前注入 polyfill
const { installDOMMatrix } = require('./domMatrixPolyfill')
installDOMMatrix()
const { PDFParse } = require('pdf-parse')
const { WorkspaceError } = require('../WorkspaceError')

const MAX_SIZE = 200 * 1024 * 1024 // 200 MB

async function read(filePath, options = {}) {
  let parser = null
  try {
    const stat = await fs.stat(filePath)
    if (stat.size > MAX_SIZE) {
      throw new WorkspaceError('SIZE_EXCEEDED', `${filePath} > 200MB`, false)
    }

    const buffer = await fs.readFile(filePath)
    let parsedText = null
    let pageCount = 0
    let info = {}
    try {
      // useWorker: false — 关掉 worker，避免 jest sandbox / 部分 Node 环境的
      // dynamic import 限制。性能足够（小型 PDF < 1s），不阻塞主流程。
      parser = new PDFParse({ data: buffer, useWorker: false })
      const result = await parser.getText()
      parsedText = result && result.text ? result.text : ''
      pageCount = (result && typeof result.total === 'number') ? result.total : 0
      try {
        const infoResult = await parser.getInfo()
        info = (infoResult && infoResult.info) ? infoResult.info : {}
      } catch (_) {
        // info 失败不阻塞主流程，metadata.info 留空对象
      }
    } catch (err) {
      // 加密 / 损坏 / 解析异常 → PARSE_FAIL
      throw new WorkspaceError('PARSE_FAIL', `PDF 解析失败: ${err.message}`, false, err)
    }

    if (!parsedText || parsedText.trim().length === 0) {
      // 扫描件（无文字层）→ 提示用 mineru 高精度解析（v0.7.0）
      throw new WorkspaceError(
        'PARSE_FAIL',
        'PDF 无文字层（可能是扫描件）。可调用 mineru 高精度解析：在对话中说「用 mineru 解析 <文件名>」',
        false
      )
    }

    return {
      content: parsedText,
      metadata: {
        pageCount,
        info
      }
    }
  } catch (err) {
    if (err instanceof WorkspaceError) throw err
    throw new WorkspaceError('READ_FAIL', `读取 ${filePath} 失败: ${err.message}`, true, err)
  } finally {
    // PDFParse 内部持有 pdf.js 资源，必须 destroy 释放
    if (parser && typeof parser.destroy === 'function') {
      try { parser.destroy() } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { read }
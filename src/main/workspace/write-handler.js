// write-handler.js（Task 3.2 薄封装）
// 职责：调 writers dispatcher 生成 Buffer → 写盘到 <workspacePath>/reports/<filename>
// 输入：{ workspaceManager, type, filename, payload }
// 输出：{ path, size, savedAt }
//
// 错误处理：
//   - 工作区未打开（workspaceManager.current() === null）→ WorkspaceError(NOT_OPEN, retryable=false)
//   - dispatcher 抛错（未知 type 等） → 包 WorkspaceError(WRITE_FAIL, retryable=true, cause)
//   - fs.writeFile 失败 → 包 WorkspaceError(WRITE_FAIL, retryable=true, cause)
//
// 为什么是薄封装：
//   - IPC handler 只负责"接到请求 → 调本模块 → 包 IPC 错误格式"
//   - 本模块专注"业务逻辑"（路径拼接 + dispatcher + 写盘 + 业务错误码）
//   - 单元测试直接调本模块，不必 mock electron.ipcMain
const path = require('path')
const fs = require('fs').promises
const matter = require('gray-matter')
const writers = require('./writers')
const { WorkspaceError } = require('./WorkspaceError')

/**
 * 把 payload 生成 Buffer 并写到 <workspacePath>/reports/<filename>
 *
 * @param {Object} args
 * @param {Object} args.workspaceManager - WorkspaceManager 实例（需有 current() 方法）
 * @param {Object} [args.wikiEngine] - WikiEngine 实例；传入时会把报告同步 ingest 为 wiki 页面
 * @param {string} args.type - 'docx' | 'xlsx' | 'markdown' | 'md'
 * @param {string} args.filename - 落盘文件名（不含路径），如 'report.docx'
 * @param {Object} args.payload - writer payload（spec §4.4）
 * @param {Object} [args.style] - 报告样式（已合并好的最终 style 对象，由调用方 mergeStyle 后传入）。
 *   仅 docx writer 使用；xlsx/md writer 忽略。结构见 skills/report-styles.js DEFAULT_REPORT_STYLE。
 * @returns {Promise<{path: string, size: number, savedAt: string, wikiPage?: string}>}
 */
async function writeFile({ workspaceManager, wikiEngine = null, type, filename, payload, style = null }) {
  // 1) 工作区未开 → NOT_OPEN
  const current = workspaceManager.current()
  if (!current || !current.path) {
    throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
  }

  // 2) 调 dispatcher 生成 Buffer（未知 type 会抛错，下面 catch 包 WRITE_FAIL）
  //    style 透传给 writer：docx writer 用它设字体/字号/颜色/页面；其他 writer 忽略
  let buf
  try {
    buf = await writers.write(type, payload, style)
  } catch (err) {
    throw new WorkspaceError('WRITE_FAIL', `生成 ${type} 失败：${err.message}`, true, err)
  }

  // 3) 写盘到 <workspacePath>/reports/<filename>
  const targetPath = path.posix.join(current.path, 'reports', filename)
  try {
    await fs.writeFile(targetPath, buf)
  } catch (err) {
    throw new WorkspaceError('WRITE_FAIL', `写入文件失败：${err.message}`, true, err)
  }

  // 4) 同步生成 wiki 可搜索版本
  // - docx/xlsx：原文件不是文本，生成 md 内容后通过 ingestReport 直接写 wiki/sources/
  // - md/markdown：原文件可直接 ingest，走 wikiEngine.ingest(reports/<filename>)
  let wikiPage = null
  if (wikiEngine) {
    try {
      if (type === 'md' || type === 'markdown') {
        const ingestResult = await wikiEngine.ingest({ filename: `reports/${filename}` })
        wikiPage = ingestResult.pagesCreated?.[0] || null
      } else {
        const mdBuf = await writers.write('md', payload)
        const parsed = matter(mdBuf.toString('utf-8'))
        const ingestResult = await wikiEngine.ingestReport({
          filename: `reports/${filename}`,
          content: parsed.content,
          title: parsed.data.title || payload.title
        })
        wikiPage = ingestResult.wikiPage
      }
    } catch (err) {
      // wiki 同步失败不影响原文件写入，仅记录日志
      console.warn('[write-handler] 同步 wiki 版本失败:', err.message)
    }
  }

  return {
    path: targetPath,
    size: buf.length,
    savedAt: new Date().toISOString(),
    wikiPage
  }
}

module.exports = { writeFile }
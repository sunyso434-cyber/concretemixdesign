// write-handler.js（Task 3.2 薄封装）
// 职责：调 writers dispatcher 生成 Buffer → 写盘到 <workspacePath>/reports/
// 输入：{ workspaceManager, type, filename, payload }
// 输出：{ path, size, savedAt }
//
// v10.2.0：新增 patches 模式（仅 .md/.markdown 支持），局部修改已存在的报告文件
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
const fsSync = require('fs')
const writers = require('./writers')
const { WorkspaceError } = require('./WorkspaceError')

/**
 * agent 写盘成功后主动通知 md 阅读器刷新（场景：阅读器已打开该 md，agent 改了它）。
 * 单窗口应用，遍历 getAllWindows 广播；payload 带 stat 供渲染端去重（与 md:file-changed 同格式）。
 * fire-and-forget：通知失败不影响写盘主流程。测试环境 require('electron') 可能失败，被 catch 静默跳过。
 */
function _notifyReportWritten(filePath) {
  try {
    const { BrowserWindow } = require('electron')
    const stat = fsSync.statSync(filePath)
    const payload = { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('md:report-written', payload)
    }
  } catch (err) {
    console.warn('[write-handler] 通知 md 阅读器刷新失败:', err.message)
  }
}

/**
 * 校验并规范化 reports/ 下的归档文件夹相对路径（老板 2026-08-03：按自定义文件夹归档报告）。
 * - 支持多级（如 "项目A/2026"）；空/未传 → ''（reports 根目录）
 * - 拒绝：`.`/`..`/绝对路径/盘符/反斜杠/非法字符（<>:"|?*）
 * @param {*} folder 用户提供的文件夹名
 * @returns {string|null} 规范化 posix 相对路径；非法返回 null
 */
function normalizeReportFolder(folder) {
  if (folder == null || folder === '') return ''
  const f = String(folder).trim()
  if (!f || f === '.' || f === '..') return null
  if (f.includes('\\')) return null
  if (f.startsWith('/') || /^[a-zA-Z]:/.test(f)) return null
  const parts = f.split('/')
  for (const p of parts) {
    if (!p || p === '.' || p === '..' || /[<>:"|?*]/.test(p)) return null
  }
  return parts.join('/')
}

/**
 * 把 payload 生成 Buffer 并写到 <workspacePath>/reports/
 *
 * v10.2.0 方案 8：新增 patches 模式（仅 .md/.markdown 支持），局部修改已存在的报告
 *
 * @param {Object} args
 * @param {Object} args.workspaceManager - WorkspaceManager 实例（需有 current() 方法）
 * @param {Object} [args.wikiEngine] - WikiEngine 实例；传入时会把报告同步 ingest 为 wiki 页面
 * @param {string} args.type - 'markdown' | 'md'
 * @param {string} args.filename - 落盘文件名（不含路径），如 'report.docx'
 * @param {Object} args.payload - writer payload（spec §4.4）。patches 模式下忽略。
 * @param {Array} [args.patches] - v10.2.0 局部 patch 模式：[{ find, replace, replaceAll? }]。仅 .md/.markdown 支持。
 * @param {Object} [args.style] - 报告样式（已合并好的最终 style 对象，由调用方 mergeStyle 后传入）。
 *   仅 md writer 使用（docx/xlsx 已迁移到 officecli）。
 * @param {string} [args.folder] - 可选归档文件夹（如 "项目A" 或 "项目A/2026"，写入 reports/<folder>/；不传写 reports/ 根目录）。
 * @returns {Promise<{path: string, size: number, savedAt: string, wikiPage?: string, backupPath?: string, patchResults?: Array}>}
 */
async function writeFile({ workspaceManager, wikiEngine = null, type, filename, payload, patches, style = null, folder = null }) {
  // 归档文件夹校验（payload / patches 模式共用；非法路径直接拒绝）
  const folderRel = normalizeReportFolder(folder)
  if (folderRel === null) {
    throw new WorkspaceError('E-PARAM-INVALID', `归档文件夹名称非法：${folder}（不允许 ..、绝对路径、\\ 等）`, false)
  }
  // 1) 工作区未开 → NOT_OPEN
  const current = workspaceManager.current()
  if (!current || !current.path) {
    throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
  }

  // 基础参数校验（两种模式都需要 type + filename）
  if (!type || typeof type !== 'string') {
    throw new WorkspaceError(
      'E-PARAM-MISSING',
      '缺少必填参数: type（文件类型，仅支持 md）',
      false,
      { received: { type, hasFilename: !!filename, hasPayload: !!payload, hasPatches: Array.isArray(patches) } }
    )
  }
  if (!filename || typeof filename !== 'string') {
    throw new WorkspaceError(
      'E-PARAM-MISSING',
      '缺少必填参数: filename（如 "report.docx"）',
      false,
      { received: { type, filename, hasPayload: !!payload, hasPatches: Array.isArray(patches) } }
    )
  }
  // 安全（2026-08-22 审查）：filename 直接拼进 reports/ 路径，禁止分隔符与 ".." 逃逸
  try {
    const { assertSafeFileName } = require('../utils/pathGuard')
    assertSafeFileName(filename, '文件名')
  } catch (e) {
    throw new WorkspaceError('E-PARAM-INVALID', e.message, false, { received: { filename } })
  }

  // v10.2.0 方案 8：patches 模式分流
  if (patches !== undefined) {
    return await _writePatches({ current, type, filename, patches, wikiEngine, folderRel })
  }

  // ---- Payload 模式（原逻辑）----
  if (!payload || typeof payload !== 'object') {
    throw new WorkspaceError(
      'E-PARAM-MISSING',
      '缺少必填参数: payload（报告内容对象，含 title 和 sections 数组）',
      false,
      { received: { type, filename, payloadType: typeof payload } }
    )
  }
  if (!Array.isArray(payload.sections)) {
    throw new WorkspaceError(
      'E-PARAM-INVALID-TYPE',
      `payload.sections 必须是数组（实际类型：${payload.sections === null ? 'null' : typeof payload.sections}）`,
      false,
      { received: { sectionsType: Array.isArray(payload.sections) ? 'array' : typeof payload.sections } }
    )
  }

  // 2) 调 dispatcher 生成 Buffer（未知 type 会抛错，下面 catch 包 WRITE_FAIL）
  //    style 透传给 writer：docx writer 用它设字体/字号/颜色/页面；其他 writer 忽略
  let buf
  try {
    buf = await writers.write(type, payload, style)
  } catch (err) {
    throw new WorkspaceError('WRITE_FAIL', `生成 ${type} 失败：${err.message}`, true, err)
  }

  // 3) 写盘到 <workspacePath>/reports[/<folder>]
  // v9.1.0 防御：mkdir -p reports/ 兜底（工作区 reports/ 被误删时不报错）
  // v2026-08-03：folder 归档子文件夹（自动建目录）
  const reportsDir = path.posix.join(current.path, 'reports', folderRel)
  try {
    await fs.mkdir(reportsDir, { recursive: true })
  } catch (err) {
    throw new WorkspaceError('WRITE_FAIL', `创建 reports/ 目录失败：${err.message}`, true, err)
  }
  const targetPath = path.posix.join(reportsDir, filename)
  try {
    await fs.writeFile(targetPath, buf)
  } catch (err) {
    throw new WorkspaceError('WRITE_FAIL', `写入文件失败：${err.message}`, true, err)
  }

  // 4) 同步生成 wiki 可搜索版本（md 文件直接 ingest）
  let wikiPage = null
  if (wikiEngine) {
    try {
      const ingestResult = await wikiEngine.ingest({ filename: folderRel ? `reports/${folderRel}/${filename}` : `reports/${filename}` })
      wikiPage = ingestResult.pagesCreated?.[0] || null
    } catch (err) {
      console.warn('[write-handler] 同步 wiki 版本失败:', err.message)
    }
  }

  // 主动通知 md 阅读器刷新（若该 md 已被打开）
  _notifyReportWritten(targetPath)

  return {
    path: targetPath,
    size: buf.length,
    savedAt: new Date().toISOString(),
    wikiPage
  }
}

/**
 * v10.2.0 方案 8：patches 模式（仅 .md/.markdown 文件支持局部修改）
 *
 * 流程：
 *   1. 校验 type 是 md/markdown（docx/xlsx 是 zip 二进制，不支持 patch）
 *   2. 读已有文件
 *   3. 应用所有 patch
 *   4. 备份 .<name>.bak.<timestamp>
 *   5. 写新内容
 *   6. 重新 wiki ingest
 */
async function _writePatches({ current, type, filename, patches, wikiEngine, folderRel = '' }) {
  // 仅 md/markdown 支持 patch
  if (type !== 'md' && type !== 'markdown') {
    throw new WorkspaceError(
      'UNSUPPORTED_PATCH_TYPE',
      `workspace_writeFile patches 模式仅支持 .md/.markdown 文件，${type} 是 zip 二进制不支持局部修改。请改用 payload 模式整文件覆盖`,
      false
    )
  }

  if (!Array.isArray(patches) || patches.length === 0) {
    throw new WorkspaceError('E-PARAM-INVALID-TYPE', 'patches 必须是非空数组', false)
  }

  const reportsDir = path.posix.join(current.path, 'reports', folderRel)
  const targetPath = path.posix.join(reportsDir, filename)

  // 1) 文件必须已存在
  let originalContent
  try {
    originalContent = await fs.readFile(targetPath, 'utf-8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new WorkspaceError(
        'FILE_NOT_FOUND',
        `patches 模式要求文件已存在: ${filename}（patches 模式不能创建新文件，请改用 payload 模式）`,
        false
      )
    }
    throw new WorkspaceError('WRITE_FAIL', `读取文件失败：${err.message}`, true, err)
  }

  // 2) 应用所有 patch
  let newContent = originalContent
  const patchResults = []
  for (const p of patches) {
    if (!p || typeof p.find !== 'string' || typeof p.replace !== 'string') {
      throw new WorkspaceError('E-PARAM-INVALID-TYPE', '每个 patch 必须有 find 和 replace 字符串字段', false)
    }
    const occurrences = newContent.split(p.find).length - 1
    if (occurrences === 0) {
      patchResults.push({ find: p.find.slice(0, 80), applied: false, reason: '未找到匹配文本' })
      continue
    }
    if (!p.replaceAll && occurrences > 1) {
      patchResults.push({
        find: p.find.slice(0, 80),
        applied: false,
        reason: `匹配到 ${occurrences} 处，需设置 replaceAll=true`
      })
      continue
    }
    newContent = p.replaceAll
      ? newContent.split(p.find).join(p.replace)
      : newContent.replace(p.find, p.replace)
    patchResults.push({ find: p.find.slice(0, 80), applied: true, occurrences })
  }

  // 3) 校验：至少一个 patch 成功
  const allFailed = patchResults.every(r => !r.applied)
  if (allFailed) {
    return {
      success: false,
      error: {
        code: 'PATCH_NOT_APPLIED',
        message: '所有 patch 都未匹配，请检查 find 文本是否准确（注意空格/标点/换行）',
        patchResults
      }
    }
  }

  // 4) 自动备份
  const backupPath = `${targetPath}.bak.${Date.now()}`
  try {
    await fs.copyFile(targetPath, backupPath)
  } catch (err) {
    throw new WorkspaceError('WRITE_FAIL', `备份失败：${err.message}`, true, err)
  }

  // 5) 写新内容
  try {
    await fs.writeFile(targetPath, newContent, 'utf-8')
  } catch (err) {
    throw new WorkspaceError('WRITE_FAIL', `写入文件失败：${err.message}`, true, err)
  }

  // 6) 重新 wiki ingest
  let wikiPage = null
  if (wikiEngine) {
    try {
      const ingestResult = await wikiEngine.ingest({ filename: folderRel ? `reports/${folderRel}/${filename}` : `reports/${filename}` })
      wikiPage = ingestResult.pagesCreated?.[0] || null
    } catch (err) {
      console.warn('[write-handler:patch] 同步 wiki 版本失败:', err.message)
    }
  }

  // 主动通知 md 阅读器刷新（若该 md 已被打开）
  _notifyReportWritten(targetPath)

  return {
    success: true,
    path: targetPath,
    size: Buffer.byteLength(newContent, 'utf-8'),
    savedAt: new Date().toISOString(),
    backupPath,
    patchResults,
    wikiPage
  }
}

module.exports = { writeFile, normalizeReportFolder }
/**
 * verify-v8.4.0-build.js
 *
 * 验证 dist-8.4.0/win-unpacked/resources/app.asar 包含 v8.4.0 新功能。
 *
 * 关键路径格式（Windows asar）：
 * - asar.listPackage() 返回的路径以单反斜杠开头（虚拟根标识符），且路径内用单反斜杠
 * - asar.extractFile() 必须去掉前导反斜杠：`src\main\services\DeepSeekService.js`
 *
 * 退出码：0 = 通过，1 = 失败
 */
const path = require('path')
const asar = require('@electron/asar')

const asarPath = path.join(__dirname, '..', 'dist-8.4.0', 'win-unpacked', 'resources', 'app.asar')

let totalChecks = 0
let failedChecks = 0
const failures = []

function checkFile(listPath, needles, label) {
  totalChecks++
  // listPackage 加了前导反斜杠（虚拟根），extractFile 必须去掉
  const extractPath = listPath.replace(/^\\/, '')
  try {
    const buf = asar.extractFile(asarPath, extractPath)
    const text = buf.toString('utf8')
    console.log(`\n[FILE] ${listPath}  (${buf.length} bytes)`)
    for (const n of needles) {
      const ok = text.includes(n)
      const tag = ok ? 'OK ' : 'NO '
      console.log(`  ${tag} ${label || 'contains'}: ${n}`)
      if (!ok) {
        failedChecks++
        failures.push(`${listPath} 缺少: ${n}`)
      }
    }
  } catch (e) {
    failedChecks++
    failures.push(`${listPath} 提取失败: ${e.message}`)
    console.log(`\n[ERR ] ${listPath} -> ${e.message}`)
  }
}

// 1. 后端：DeepSeekService 含 compressContext / _callSummaryAPI / selectTail / buildCompressUserPrompt
checkFile(
  '\\src\\main\\services\\DeepSeekService.js',
  ['compressContext', '_callSummaryAPI', 'selectTail', 'buildCompressUserPrompt'],
  'DeepSeekService 含压缩相关'
)

// 2. 后端：aiAnalysisHandler 含 aiAnalysis:compressContext + stream usage event
checkFile(
  '\\src\\main\\ipcHandlers\\aiAnalysisHandler.js',
  [`aiAnalysis:compressContext`, `type: 'usage'`],
  'aiAnalysisHandler 含 IPC + stream usage'
)

// 3. 共享：contextStats 纯函数（CJS 版本，供主进程 require）
checkFile(
  '\\src\\shared\\utils\\contextStats.js',
  ['DEFAULT_CONTEXT_LIMIT', 'getContextPercent', 'messagesToText'],
  'shared contextStats 工具'
)

// 4. 扫描所有 build/renderer/assets/*.js chunk，找含 ContextIndicator / compressContext 代码的 chunk
console.log(`\n[SCAN] build/renderer/assets/*.js chunks`)
const files = asar.listPackage(asarPath)
let chunkHits = []
for (const f of files) {
  if (!f.endsWith('.js')) continue
  if (!f.includes('build\\renderer\\assets')) continue
  // 去掉前导反斜杠再 extract
  const extractPath = f.replace(/^\\/, '')
  try {
    const buf = asar.extractFile(asarPath, extractPath)
    const text = buf.toString('utf8')
    const hasCI = text.includes('ContextIndicator')
    const hasCompress = text.includes('handleCompressContext')
    const hasPct = text.includes('getContextPercent')
    const hasLoading = text.includes('isCompressing')
    if (hasCI || hasCompress || hasPct || hasLoading) {
      chunkHits.push({
        file: f,
        size: buf.length,
        CI: hasCI,
        Compress: hasCompress,
        Pct: hasPct,
        Loading: hasLoading
      })
    }
  } catch (_) {}
}

totalChecks++
if (chunkHits.length === 0) {
  failedChecks++
  failures.push('没有任何 build/renderer/assets/*.js chunk 含 ContextIndicator / compressContext 代码')
  console.log('  NO  没有任何 chunk 含 v8.4.0 React 代码')
} else {
  console.log(`  OK  共 ${chunkHits.length} 个 chunk 含 v8.4.0 代码:`)
  for (const h of chunkHits) {
    console.log(`    ${h.size}B  CI=${h.CI} Compress=${h.Compress} Pct=${h.Pct} Loading=${h.Loading}  ${h.file}`)
  }
}

// 5. CSS 含 @keyframes context-spin
const cssFiles = files.filter(f => f.endsWith('.css') && f.includes('build\\renderer\\assets'))
let cssHit = null
for (const f of cssFiles) {
  const extractPath = f.replace(/^\\/, '')
  try {
    const buf = asar.extractFile(asarPath, extractPath)
    const text = buf.toString('utf8')
    if (text.includes('context-spin')) {
      cssHit = f
      break
    }
  } catch (_) {}
}
totalChecks++
if (cssHit) {
  console.log(`\n[OK ] CSS 含 context-spin: ${cssHit}`)
} else {
  failedChecks++
  failures.push('CSS 未含 @keyframes context-spin')
  console.log(`\n[NO ] CSS 未含 @keyframes context-spin`)
}

// ===== 总结 =====
console.log(`\n========== 验证总结 ==========`)
console.log(`总检查项: ${totalChecks}`)
console.log(`失败项:   ${failedChecks}`)
if (failedChecks > 0) {
  console.log(`\n失败清单:`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`\n❌ v8.4.0 打包验证未通过`)
  process.exit(1)
} else {
  console.log(`\n✅ v8.4.0 打包验证全部通过`)
  process.exit(0)
}

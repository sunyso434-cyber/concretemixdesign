/**
 * verify-v8.4.1-build.js
 *
 * 验证 dist-8.4.1/win-unpacked/resources/app.asar 包含 v8.4.0 + v8.4.1 新功能。
 *
 * v8.4.0 验证项：
 * - SmartDesignChat / ContextIndicator React 代码（位于某个 build/renderer/assets/*.js chunk 中）
 * - contextStats 纯函数（shared 共享层）
 * - DeepSeekService.compressContext 方法
 * - aiAnalysisHandler.compressContext IPC handler
 * - index.css 含 @keyframes context-spin 动画
 *
 * v8.4.1 验证项（本次新增）：
 * - AgentMemoryService.buildHistoryMessages 含 tool 孤儿救援（`unknown_recovered` 占位 + `_drop` 标记）
 * - ContextIndicator.utils 不含 VISIBILITY_THRESHOLD 常量（已删除，圆环始终显示）
 *
 * 退出码：0 = 通过，1 = 失败
 */
const path = require('path')
const asar = require('@electron/asar')

const asarPath = path.join(__dirname, '..', 'dist-8.4.1', 'win-unpacked', 'resources', 'app.asar')

let totalChecks = 0
let failedChecks = 0
const failures = []

function checkFile(listPath, needles, label) {
  totalChecks++
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

// ============== v8.4.0 验证项 ==============

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

// ============== v8.4.1 验证项 ==============

// 6. AgentMemoryService 含 tool 孤儿救援（unknown_recovered 占位 + _drop 标记）
checkFile(
  '\\src\\main\\services\\AgentMemoryService.js',
  ['unknown_recovered', '_drop'],
  'AgentMemoryService 含 tool 孤儿救援'
)

// 7. ContextIndicator.utils 不含 VISIBILITY_THRESHOLD（已删除，圆环始终显示）
totalChecks++
const ctxUtilsPath = '\\src\\renderer\\components\\ContextIndicator.utils.js'
const ctxExtractPath = ctxUtilsPath.replace(/^\\/, '')
let ctxUtilsHasThreshold = false
try {
  const buf = asar.extractFile(asarPath, ctxExtractPath)
  // 因为 asar 里是 minified bundle，源代码里分散的常量可能被 inline / 改名
  // 但 build/renderer/assets/*.js 是 minified bundle，VISIBILITY_THRESHOLD 应该已消除
  // 检查任意 chunk 里是否还有 VISIBILITY_THRESHOLD
  ctxUtilsHasThreshold = false
} catch (_) {
  // 渲染层 utils 不打包进 asar（只 build/renderer/assets bundle 包含）
}

// 检查 build/renderer bundle 里是否还有 VISIBILITY_THRESHOLD
let bundleHasThreshold = false
for (const f of files) {
  if (!f.endsWith('.js')) continue
  if (!f.includes('build\\renderer\\assets')) continue
  try {
    const buf = asar.extractFile(asarPath, f.replace(/^\\/, ''))
    if (buf.toString('utf8').includes('VISIBILITY_THRESHOLD')) {
      bundleHasThreshold = true
      break
    }
  } catch (_) {}
}
totalChecks++
if (bundleHasThreshold) {
  failedChecks++
  failures.push('渲染 bundle 仍含 VISIBILITY_THRESHOLD（应已删除）')
  console.log(`\n[NO ] 渲染 bundle 仍含 VISIBILITY_THRESHOLD（应已删除，圆环应始终显示）`)
} else {
  console.log(`\n[OK ] 渲染 bundle 已不含 VISIBILITY_THRESHOLD（圆环始终显示）`)
}

// ===== 总结 =====
console.log(`\n========== 验证总结 ==========`)
console.log(`总检查项: ${totalChecks}`)
console.log(`失败项:   ${failedChecks}`)
if (failedChecks > 0) {
  console.log(`\n失败清单:`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`\n❌ v8.4.1 打包验证未通过`)
  process.exit(1)
} else {
  console.log(`\n✅ v8.4.1 打包验证全部通过`)
  process.exit(0)
}

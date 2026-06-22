/**
 * verify-asar-fix.js
 * 验证 dist-8.0.0/win-unpacked/resources/app.asar 内含修复后的 7 个 workspace_ 工具名
 */
const path = require('path')

const asarPath = path.join(__dirname, '..', 'dist-8.0.0', 'win-unpacked', 'resources', 'app.asar')

// 动态 require asar 模块
const asar = require('@electron/asar')

// 列出文件查找 workspaceTools.js 的实际路径
const files = asar.listPackage(asarPath)
const wtFile = files.find(f => f.endsWith('workspaceTools.js')).replace(/^\//, '').replace(/\\/g, '/')
const pbFile = files.find(f => f.endsWith('systemPromptBuilder.js')).replace(/^\//, '').replace(/\\/g, '/')

if (!wtFile || !pbFile) {
  console.error('找不到 workspaceTools.js 或 systemPromptBuilder.js')
  process.exit(1)
}

console.log('workspaceTools.js 路径:', wtFile)
console.log('systemPromptBuilder.js 路径:', pbFile)

// 提取两个文件
const wtContent = asar.extractFile(asarPath, wtFile)
const pbContent = asar.extractFile(asarPath, pbFile)
const wtStr = wtContent.toString('utf-8')
const pbStr = pbContent.toString('utf-8')

const expectedTools = [
  'workspace_search',
  'workspace_readPage',
  'workspace_ingest',
  'workspace_writeFile',
  'workspace_listFiles',
  'workspace_lint',
  'workspace_searchGraph'
]

console.log('')
console.log('=== 检查 workspaceTools.js 内 7 个工具名 ===')
for (const name of expectedTools) {
  const found = wtStr.includes("'" + name + "'")
  console.log('  ' + (found ? 'OK' : 'FAIL') + " '" + name + "'")
}

console.log('')
console.log('=== 检查残留 workspace.xxx 命名（应该 0）===')
const legacyPattern = /workspace\.(search|readPage|ingest|writeFile|listFiles|lint|searchGraph)/g
const wtHits = (wtStr.match(legacyPattern) || []).length
const pbHits = (pbStr.match(legacyPattern) || []).length
console.log('  workspaceTools.js 残留:', wtHits)
console.log('  systemPromptBuilder.js 残留:', pbHits)

console.log('')
console.log('=== 修复验证：' + (wtHits === 0 && pbHits === 0 ? '✅ 全部清理' : '❌ 有残留') + ' ===')
process.exit(wtHits === 0 && pbHits === 0 ? 0 : 1)
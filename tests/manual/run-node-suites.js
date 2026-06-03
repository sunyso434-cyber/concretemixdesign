/**
 * 在项目根目录执行：node tests/manual/run-node-suites.js
 * 或由 npm test 调用。仅运行不依赖 Electron 窗口的脚本。
 */
const { spawnSync } = require('child_process')
const path = require('path')

const manualDir = __dirname
const repoRoot = path.join(manualDir, '..', '..')

const nodeOnlyScripts = [
  'test-calculations.js',
  'test-dup-cost.js',
  'test-fine-aggregate-combine.js',
  'test-fine-aggregate-ratio.js',
  'test-mixdesign.js',
  'test-costs.js',
  'test-fine-aggregate-service.js',
  'test-db.js',
  'test-add-schemes.js',
  'test-schemes.js',
  'test-scheme-details.js',
  'test-standard-scope-accuracy.js',
  'test-sales-quote.js',
  '../../scripts/test-agent-mock-llm.js'
]

let failed = 0
for (const name of nodeOnlyScripts) {
  const scriptPath = path.join(manualDir, name)
  console.log(`\n========== ${name} ==========\n`)
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  })
  if (r.status !== 0) {
    console.error(`\n[失败] ${name} 退出码: ${r.status ?? r.signal}\n`)
    failed++
  }
}

console.log(
  `\n说明: IPC/Electron 类脚本请使用 electron 单独运行，见 tests/manual/README.md\n` +
    `本次套件: ${nodeOnlyScripts.length} 个，失败: ${failed} 个\n`
)
process.exit(failed ? 1 : 0)

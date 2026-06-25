// scripts/clean-existing-sections.js
//
// 一次性回扫脚本：清理 wiki/sources/*.md 里 frontmatter.sections 中的"假标题"
//   - PDF 页眉（期刊名+卷期号）
//   - PDF 页脚（"-- X of Y --"、"Page X of Y"）
//   - XLSX Sheet 名（"Sheet: <name>"）
//   - XLSX 占位符（"_(空 sheet)_"）
//   - XLSX 合并单元格标题行（整行 markdown 表格）
//   - ScienceDirect 元信息（"Available online ..."、"Received ..."、"E-mail addresses:"）
//
// 用法：
//   node scripts/clean-existing-sections.js <workspace-path> [--apply]
//
// 参数：
//   <workspace-path>   workspace 根目录（包含 wiki/sources/ 的目录），默认 D:\C-c\newtest
//   --apply            实际写文件（默认 dry-run：只生成 .bak + 打印 diff，不覆盖）
//   --verbose          打印每条被丢弃的 heading（用于人工复核）
//
// 行为：
//   1. 读 frontmatter + body
//   2. 调用 WikiEngine.computeSections(body) 重新计算 sections
//   3. 对比旧 sections vs 新 sections，统计丢弃数量
//   4. 把原文件复制到 <file>.md.bak（每次运行覆盖 .bak，备份只保留 1 份）
//   5. dry-run 模式下不写原文件；--apply 模式下写入并刷 sections_version: 2

const fs = require('fs').promises
const path = require('path')
const matter = require('gray-matter')
const { WikiEngine } = require('../src/main/workspace/WikiEngine')

function parseArgs(argv) {
  const args = { workspace: 'D:\\C-c\\newtest', apply: false, verbose: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--verbose') args.verbose = true
    else if (!a.startsWith('--')) args.workspace = a
  }
  return args
}

async function listSources(sourcesDir) {
  const entries = await fs.readdir(sourcesDir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.bak'))
    .map(e => path.join(sourcesDir, e.name))
}

function diffSections(oldSections, newSections) {
  // sections 是按 startLine 排序的有序数组，id 可能不同（重新生成），按内容对比
  const oldByLine = new Map()
  for (const s of oldSections || []) {
    oldByLine.set(`${s.startLine}-${s.endLine}`, s)
  }
  const newByLine = new Map()
  for (const s of newSections) {
    newByLine.set(`${s.startLine}-${s.endLine}`, s)
  }

  const dropped = []
  const kept = []
  const added = []

  for (const [key, oldS] of oldByLine.entries()) {
    if (newByLine.has(key)) {
      // 同一行范围：新 heading 是否变化？
      const newS = newByLine.get(key)
      if (newS.heading === oldS.heading) {
        kept.push({ line: key, old: oldS.heading, new: newS.heading })
      } else {
        dropped.push({ line: key, old: oldS.heading, new: newS.heading })
      }
    } else {
      dropped.push({ line: key, old: oldS.heading, new: '' })
    }
  }
  for (const [key, newS] of newByLine.entries()) {
    if (!oldByLine.has(key)) {
      added.push({ line: key, new: newS.heading })
    }
  }
  return { dropped, kept, added }
}

async function processFile(filePath, engine, options) {
  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed = matter(raw)
  const fm = parsed.data || {}
  const body = parsed.content || ''

  const oldSections = fm.sections || []
  const newSections = engine.computeSections(body)

  const diff = diffSections(oldSections, newSections)

  const report = {
    file: path.basename(filePath),
    oldCount: oldSections.length,
    newCount: newSections.length,
    droppedCount: diff.dropped.length,
    keptCount: diff.kept.length,
    addedCount: diff.added.length,
    dropped: diff.dropped,
    added: diff.added
  }

  if (options.apply && (diff.dropped.length > 0 || diff.added.length > 0)) {
    // 1) 备份原文件
    const bakPath = filePath + '.bak'
    await fs.copyFile(filePath, bakPath)
    // 2) 写入新 frontmatter（body 不变，只刷 sections + sections_version）
    const newFm = { ...fm, sections: newSections, sections_version: 2 }
    const newRaw = matter.stringify(body, newFm)
    await fs.writeFile(filePath, newRaw.replace(/\r\n/g, '\n'), 'utf-8')
    report.action = 'applied'
    report.bakPath = bakPath
  } else {
    report.action = 'dry-run'
  }

  return report
}

function printReport(r, options) {
  const actionTag = r.action === 'applied' ? '✓ APPLIED' : '○ DRY-RUN'
  console.log(`\n[${actionTag}] ${r.file}`)
  console.log(`  sections: ${r.oldCount} → ${r.newCount}  (dropped=${r.droppedCount}, kept=${r.keptCount}, added=${r.addedCount})`)
  if (r.dropped.length > 0) {
    console.log(`  丢弃的 heading（${r.dropped.length}）:`)
    for (const d of r.dropped.slice(0, 20)) {
      const oldText = d.old ? `"${d.old.slice(0, 50)}${d.old.length > 50 ? '...' : ''}"` : '(空)'
      console.log(`    - line ${d.line}: ${oldText}`)
    }
    if (r.dropped.length > 20) console.log(`    ... 还有 ${r.dropped.length - 20} 条`)
  }
  if (r.added.length > 0 && options.verbose) {
    console.log(`  新增的 heading（${r.added.length}）:`)
    for (const a of r.added.slice(0, 10)) {
      console.log(`    + line ${a.line}: "${a.new.slice(0, 50)}${a.new.length > 50 ? '...' : ''}"`)
    }
  }
  if (r.action === 'applied') {
    console.log(`  备份：${r.bakPath}`)
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const sourcesDir = path.join(args.workspace, 'wiki', 'sources')

  console.log('========================================')
  console.log('Wiki Sections 清洗脚本')
  console.log('========================================')
  console.log(`workspace : ${args.workspace}`)
  console.log(`sources   : ${sourcesDir}`)
  console.log(`mode      : ${args.apply ? 'APPLY（会写文件）' : 'DRY-RUN（不写文件）'}`)
  console.log(`verbose   : ${args.verbose}`)
  console.log('')

  // 检查目录
  try {
    await fs.access(sourcesDir)
  } catch (err) {
    console.error(`[FATAL] sources 目录不存在: ${sourcesDir}`)
    process.exit(1)
  }

  const files = await listSources(sourcesDir)
  if (files.length === 0) {
    console.log('没有 .md 文件需要处理。')
    return
  }

  console.log(`找到 ${files.length} 个 .md 文件：`)
  for (const f of files) console.log(`  - ${path.basename(f)}`)
  console.log('')

  // 创建 WikiEngine 实例（需要 workspace 参数，但 computeSections 不依赖真实数据）
  const engine = new WikiEngine({ workspace: { current: () => null } })

  const reports = []
  for (const filePath of files) {
    try {
      const report = await processFile(filePath, engine, args)
      reports.push(report)
      printReport(report, args)
    } catch (err) {
      console.error(`[ERROR] ${path.basename(filePath)}: ${err.message}`)
      reports.push({ file: path.basename(filePath), error: err.message })
    }
  }

  // 汇总
  console.log('\n========================================')
  console.log('汇总')
  console.log('========================================')
  const totalDropped = reports.reduce((s, r) => s + (r.droppedCount || 0), 0)
  const totalKept = reports.reduce((s, r) => s + (r.keptCount || 0), 0)
  const totalAdded = reports.reduce((s, r) => s + (r.addedCount || 0), 0)
  const totalOld = reports.reduce((s, r) => s + (r.oldCount || 0), 0)
  const totalNew = reports.reduce((s, r) => s + (r.newCount || 0), 0)
  console.log(`  文件数：${reports.length}`)
  console.log(`  sections 总数：${totalOld} → ${totalNew}`)
  console.log(`  丢弃：${totalDropped}  保留：${totalKept}  新增：${totalAdded}`)
  if (!args.apply) {
    console.log('')
    console.log('当前是 DRY-RUN 模式，没有修改任何文件。')
    console.log('确认结果 OK 后，加 --apply 参数实际执行：')
    console.log(`  node scripts/clean-existing-sections.js "${args.workspace}" --apply`)
  } else {
    console.log('')
    console.log('✓ 已实际修改文件。每个被修改的文件都有 .bak 备份。')
    console.log('如需回滚：把 .bak 覆盖回原文件即可。')
  }
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
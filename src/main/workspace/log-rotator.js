// log-rotator (Task 6.6) - log.md 轮转归档
// - 触发条件：log.md > 10MB 或 > 1000 条
// - 归档到 wiki/log/log-YYYY-MM-DD-<ts>.md.gz
// - 保留近 30 天归档，更老的删
// - 归档后原 log.md 清空
// - log.md 不存在 / 未达阈值 → noop，不报错
//
// 设计：
// - 阈值常量按 spec §4.13 / §7.5（10MB / 1000 条 / 30 天）
// - 归档文件名带 Date.now() 后缀，避免同日多次轮转冲突
// - 30 天判断用 mtimeMs（utimes 也兼容）
// - 不引入新依赖（用 Node 内置 zlib + fs.promises）
const fs = require('fs').promises
const path = require('path')
const zlib = require('zlib')
const { promisify } = require('util')
const gzip = promisify(zlib.gzip)

const LOG_FILENAME = 'log.md'
const LOG_ARCHIVE_DIR = 'log'
const SIZE_THRESHOLD = 10 * 1024 * 1024  // 10MB
const LINE_THRESHOLD = 1000
const RETAIN_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

async function rotateLog(workspacePath) {
  const logPath = path.join(workspacePath, 'wiki', LOG_FILENAME)
  const archiveDir = path.join(workspacePath, 'wiki', LOG_ARCHIVE_DIR)

  // 1. 检 log.md 状态
  const stat = await fs.stat(logPath).catch(() => null)
  if (!stat) return { archivedFiles: [], totalBytesSaved: 0 }

  // 2. 检阈值
  const content = await fs.readFile(logPath, 'utf-8')
  const lineCount = content.split('\n').length
  if (stat.size < SIZE_THRESHOLD && lineCount < LINE_THRESHOLD) {
    return { archivedFiles: [], totalBytesSaved: 0 }
  }

  // 3. 归档：gzip → log/log-YYYY-MM-DD-<ts>.md.gz
  await fs.mkdir(archiveDir, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const archiveName = `log-${date}-${Date.now()}.md.gz`
  const archivePath = path.join(archiveDir, archiveName)
  const compressed = await gzip(content)
  await fs.writeFile(archivePath, compressed)

  // 4. 清空原 log.md
  await fs.writeFile(logPath, '')

  // 5. 清理 > 30 天的归档（用 mtimeMs 判定）
  const cutoff = Date.now() - RETAIN_DAYS * DAY_MS
  const archives = await fs.readdir(archiveDir).catch(() => [])
  for (const a of archives) {
    const ap = path.join(archiveDir, a)
    try {
      const aStat = await fs.stat(ap)
      if (aStat.mtimeMs < cutoff) await fs.rm(ap, { force: true })
    } catch {
      // 单个文件读取失败 → 跳过（不影响主流程）
    }
  }

  return {
    archivedFiles: [archiveName],
    totalBytesSaved: stat.size - compressed.length
  }
}

module.exports = { rotateLog }
const fs = require('fs').promises
const path = require('path')

const INDEX_FILENAME = '.workspace-index.json'

function defaultIndex(workspacePath) {
  const now = new Date().toISOString()
  const emptyBM25 = { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }
  return {
    version: 1,
    workspacePath: workspacePath.replace(/\\/g, '/'),
    createdAt: now,
    updatedAt: now,
    lastFullRebuild: now,
    files: {},
    bm25Index: emptyBM25,
    // Task 3.4 (P3)：chat-history 独立索引
    chatBM25Index: emptyBM25,
    // 知识库刷新：answers 独立索引
    answerBM25Index: emptyBM25
  }
}

async function loadIndex(workspacePath) {
  const fp = path.join(workspacePath, INDEX_FILENAME)
  try {
    const raw = await fs.readFile(fp, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return defaultIndex(workspacePath)
    // 损坏：抛 INDEX_CORRUPT（spec §4.11）
    const { WorkspaceError } = require('./WorkspaceError')
    throw new WorkspaceError('INDEX_CORRUPT', `index.json 损坏: ${err.message}`, false, err)
  }
}

async function saveIndex(workspacePath, index) {
  const fp = path.join(workspacePath, INDEX_FILENAME)
  // 原子写：先写 .tmp，再 rename
  const tmpFp = `${fp}.tmp.${Date.now()}`
  await fs.writeFile(tmpFp, JSON.stringify(index, null, 2), 'utf-8')
  await fs.rename(tmpFp, fp)
}

/**
 * 清理孤儿 .tmp 文件（saveIndex 中途崩溃会留下）
 * 每次 loadIndex 前调用一次，0 风险——tmp 都是没 rename 成功的半成品
 */
async function cleanupOrphanTmps(workspacePath) {
  let entries
  try {
    entries = await fs.readdir(workspacePath)
  } catch (err) {
    if (err.code === 'ENOENT') return 0  // 目录不存在 → 0 个清理
    throw err
  }
  const prefix = `${INDEX_FILENAME}.tmp.`
  let removed = 0
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue
    try {
      await fs.unlink(path.join(workspacePath, name))
      removed++
    } catch (err) {
      // 单个删失败不阻塞其他（可能被占用/权限问题），下次再试
      if (err.code !== 'ENOENT') {
        console.warn(`[index-store] cleanup tmp 失败: ${name} (${err.code})`)
      }
    }
  }
  return removed
}

module.exports = { loadIndex, saveIndex, cleanupOrphanTmps }

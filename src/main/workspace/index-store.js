const fs = require('fs').promises
const path = require('path')

const INDEX_FILENAME = '.workspace-index.json'

function defaultIndex(workspacePath) {
  const now = new Date().toISOString()
  return {
    version: 1,
    workspacePath: workspacePath.replace(/\\/g, '/'),
    createdAt: now,
    updatedAt: now,
    lastFullRebuild: now,
    files: {},
    bm25Index: { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }
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

module.exports = { loadIndex, saveIndex }

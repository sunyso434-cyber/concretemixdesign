// readers 调度器
// - 按文件扩展名分派给对应 reader
// - 未知扩展名抛普通 Error（不含 code，让上层 WikiEngine 包装为 WorkspaceError）
//
// Task 1.10 设计：
// - 不在调度层重复 throw WorkspaceError（避免双重包装）
// - WikiEngine.ingest 接到普通 Error 时会包装为 READ_FAIL
const path = require('path')

const readers = {
  '.txt': () => require('./text'),
  '.csv': () => require('./text'),
  '.md': () => require('./markdown'),
  '.pdf': () => require('./pdf'),
  '.docx': () => require('./docx'),
  '.xlsx': () => require('./xlsx'),
  '.xls': () => require('./xlsx')
}

async function read(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const loader = readers[ext]
  if (!loader) {
    throw new Error(`Unsupported file type: ${ext}`)
  }
  const { read } = loader()
  return await read(filePath)
}

module.exports = { read }
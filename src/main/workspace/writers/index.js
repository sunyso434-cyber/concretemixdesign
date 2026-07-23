// writers 调度器：仅支持 markdown（docx/xlsx 已迁移到 officecli）
// - type: 'markdown' | 'md'
// - 未知 type 抛错
//
// 用法：
//   const buf = await write('md', { title, sections }, style)
const markdownWriter = require('./markdown')

const writers = {
  markdown: markdownWriter,
  md: markdownWriter
}

function listTypes() {
  return Object.keys(writers)
}

async function write(type, payload, style = null) {
  const writer = writers[type]
  if (!writer) {
    throw new Error(`unknown writer type: ${type} (supported: ${listTypes().join(', ')})`)
  }
  return await writer.write(payload, style)
}

module.exports = { write, listTypes }
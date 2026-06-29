// writers 调度器：按 type 选 writer
// - type: 'docx' | 'xlsx' | 'markdown' | 'md'
// - 未知 type 抛错（前端收到错误可提示老板）
// - style 可选：仅 docx writer 使用（字体/字号/颜色/页面），其他 writer 忽略
//
// 用法：
//   const buf = await write('docx', { title, sections }, style)
const docxWriter = require('./docx')
const xlsxWriter = require('./xlsx')
const markdownWriter = require('./markdown')

const writers = {
  docx: docxWriter,
  xlsx: xlsxWriter,
  markdown: markdownWriter,
  md: markdownWriter // 别名
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
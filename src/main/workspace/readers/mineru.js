// mineru reader：高精度云端解析（v0.7.0）
// - 调用 MineruService 精准 API（批量上传接口）解析文档
// - 适用于扫描件 PDF、复杂表格、公式、多栏版式、图片、PPT 等
// - 输出 Markdown（mineru zip 内 full.md）
//
// 不注册到 readers/index.js 默认分派表——仅由 parse-with-mineru skill 主动调用
// 接口与现有 reader 一致：返回 {content, metadata}
//
// 错误：透传 MineruService 抛的 WorkspaceError（与本地 reader 同构）
const MineruService = require('../../services/MineruService')
const service = new MineruService()

async function read(filePath, options = {}) {
  return await service.parseLocalFile(filePath, options)
}

module.exports = { read }

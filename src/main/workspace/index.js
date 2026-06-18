// src/main/workspace/index.js
// 真实模块导出（v2026-06-19 修订：替换 Task 1.2 占位）
const { WorkspaceManager } = require('./WorkspaceManager')
const { WikiEngine } = require('./WikiEngine')
const { ChatHistoryExporter } = require('./ChatHistoryExporter')
// TODO P2a 末: 加 ChatHistorySync（Task 2.12 引入，P2b 范围）
// const { ChatHistorySync } = require('./ChatHistorySync')
const { WorkspaceError } = require('./WorkspaceError')

module.exports = {
  WorkspaceManager,
  WikiEngine,
  ChatHistoryExporter,
  // ChatHistorySync,  // P2a 末补
  WorkspaceError
}
/**
 * ChatHistoryExporter — 聊天历史格式转换器（v1.5.3 拆为独立纯函数）
 *
 * 职责：消息数组 ↔ MD 字符串 / JSONL 字符串（纯转换，无 IO）
 * IO 编排由 ChatHistorySync.exportSession 负责。
 */

const path = require('path')
const fs = require('fs').promises
const matter = require('gray-matter')
const { buildBM25 } = require('./bm25')
const { loadIndex, saveIndex } = require('./index-store')

class ChatHistoryExporter {
  /** v1.5.3 拆细：构造器无依赖，便于单测 */
  constructor() {}

  /**
   * Task 3.4 (P3)：exportSession 成功后增量更新 chatBM25Index。
   * - 读 .workspace-index.json，把当前 session.md 单独 buildBM25 → 整体替换 chatBM25Index（P1 简化）
   * - P2 优化方案：增量合并旧 postings（暂不实现，P1 直接重建避免 postings 重复计数）
   * - 失败不抛出（已 export 成功，写索引失败不应阻塞主流程）
   * @param {string} sessionId
   * @param {string} workspacePath
   * @returns {Promise<{updated: boolean, sessionPath: string}>}
   */
  async updateChatBM25Index(sessionId, workspacePath) {
    const slug = sessionId.substring(0, 8)
    const relPath = `chat-history/${slug}/session.md`
    const mdPath = path.join(workspacePath, 'wiki', relPath)

    let content = ''
    try {
      content = await fs.readFile(mdPath, 'utf-8')
    } catch (err) {
      // session.md 读不到（理论上 exportSession 已成功写，这里不该失败）
      return { updated: false, sessionPath: relPath, reason: 'session.md 读取失败: ' + err.message }
    }

    try {
      const index = await loadIndex(workspacePath)
      // P1 简化：只把当前一个 session.md 加入 chatBM25Index（覆盖式）
      // 原因：buildBM25 是全量重建，无法增量加一个 doc；维护多个 doc 需要 postings 合并逻辑
      // 后续可扩展：扫所有 chat-history/*/session.md 全量 rebuild（更安全）
      index.chatBM25Index = buildBM25([{ path: relPath, content }])
      await saveIndex(workspacePath, index)
      return { updated: true, sessionPath: relPath }
    } catch (err) {
      // 写索引失败不阻塞主流程（已 export 成功）
      console.error('[ChatHistoryExporter.updateChatBM25Index] 索引更新失败:', err.message)
      return { updated: false, sessionPath: relPath, reason: err.message }
    }
  }

  /**
   * 把 ChatHistory 消息数组 → MD 字符串（不含 IO）
   * @param {string} sessionId
   * @param {Array} messages - ChatHistory.findAll() 返回的实例数组
   * @param {string} workspacePath
   * @returns {string} MD 内容（含 frontmatter）
   */
  formatMD(sessionId, messages, workspacePath) {
    const frontmatter = {
      sessionId,
      workspacePath: workspacePath.replace(/\\/g, '/'),
      messageCount: messages.length,
      firstActivity: messages[0]?.createdAt || new Date().toISOString(),
      lastActivity: messages[messages.length - 1]?.createdAt || new Date().toISOString(),
      exportedAt: new Date().toISOString()
    }

    const userMsgs = messages.filter(m => m.role === 'user')
    const asstMsgs = messages.filter(m => m.role === 'assistant')
    const summary = `> **会话摘要**：${messages.length} 条消息（用户 ${userMsgs.length} / 助手 ${asstMsgs.length}）
> 起始：${frontmatter.firstActivity}　　末次：${frontmatter.lastActivity}
> 工作区：\`${frontmatter.workspacePath}\`
`

    const bodyLines = []
    for (const m of messages) {
      const ts = m.createdAt || ''
      const roleLabel = m.role === 'user' ? '🧑 用户' : m.role === 'assistant' ? '🤖 助手' : `⚙️ ${m.role}`
      bodyLines.push(`### ${roleLabel}　\`${ts}\``)
      bodyLines.push('')
      bodyLines.push(m.content || '')
      bodyLines.push('')
      // 工具调用（折叠）
      if (m.toolCalls) {
        let calls = []
        try { calls = typeof m.toolCalls === 'string' ? JSON.parse(m.toolCalls) : m.toolCalls } catch {}
        for (const call of calls) {
          bodyLines.push('<details>')
          bodyLines.push(`<summary>🔧 工具调用：${call.name || 'unknown'}</summary>`)
          bodyLines.push('')
          bodyLines.push('```json')
          bodyLines.push(JSON.stringify(call.args || call, null, 2))
          bodyLines.push('```')
          bodyLines.push('</details>')
          bodyLines.push('')
        }
      }
      // 附件
      if (m.metadata?.attachments) {
        let atts = []
        try { atts = typeof m.metadata.attachments === 'string' ? JSON.parse(m.metadata.attachments) : m.metadata.attachments } catch {}
        for (const att of atts) {
          if (att.type?.startsWith('image/')) {
            bodyLines.push(`![${att.name || 'image'}](file://${att.path})`)
          } else {
            bodyLines.push(`📎 附件：\`${att.path}\``)
          }
          bodyLines.push('')
        }
      }
    }

    return matter.stringify(summary + '\n' + bodyLines.join('\n'), frontmatter)
  }

  /**
   * 把 ChatHistory 消息数组 → JSONL 字符串（每行一个 JSON）
   * @param {Array} messages
   * @returns {string}
   */
  formatJSONL(messages) {
    return messages.map(m => JSON.stringify(this._msgToJSON(m))).join('\n') + '\n'
  }

  /**
   * 反向：JSONL 字符串 → 消息数组
   * @param {string} jsonlStr
   * @returns {Array}
   */
  parseJSONL(jsonlStr) {
    if (!jsonlStr || !jsonlStr.trim()) return []
    return jsonlStr.trim().split('\n').map(l => JSON.parse(l))
  }

  /**
   * v1.5.3 关键：loadSession 只读文件，无 DB 依赖
   * @param {string} sessionId
   * @param {string} workspacePath
   * @returns {Promise<{messages: Array, renderedMd: string, summary: object}>}
   */
  async loadSession(sessionId, workspacePath) {
    const slug = sessionId.substring(0, 8)
    const jsonlPath = path.join(workspacePath, 'wiki', 'chat-history', slug, 'session.jsonl')
    const mdPath = path.join(workspacePath, 'wiki', 'chat-history', slug, 'session.md')
    const content = await fs.readFile(jsonlPath, 'utf-8')
    const messages = this.parseJSONL(content)
    const renderedMd = await fs.readFile(mdPath, 'utf-8')
    const { data: summary } = matter(renderedMd)
    return { messages, renderedMd, summary }
  }

  /**
   * 消息实例 → 纯 JSON 对象（用于 JSONL 行）
   * @param {object} m
   * @returns {object}
   */
  _msgToJSON(m) {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      toolCalls: m.toolCalls ? (typeof m.toolCalls === 'string' ? JSON.parse(m.toolCalls) : m.toolCalls) : null,
      attachments: m.metadata?.attachments || null
    }
  }
}

module.exports = { ChatHistoryExporter }

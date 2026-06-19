/**
 * ChatHistorySync — 聊天历史同步器（v1.5.3 拆为独立文件）
 *
 * 职责：markPending + 5s debounce 批量导出队列 + IO 编排。
 * 触发点：AgentMemoryService.saveMessage 调用 global.chatHistorySync.markPending(sessionId)。
 *
 * 依赖注入：
 *   - workspace: WorkspaceManager 实例
 *   - exporter:  ChatHistoryExporter 实例（格式转换器，P1 创建）
 */

const path = require('path')
const fs = require('fs').promises
const crypto = require('crypto')
const matter = require('gray-matter')
const { ChatHistory, ChatSession } = require('../db/database')
const { WorkspaceError } = require('./WorkspaceError')
const { Op } = require('sequelize')

class ChatHistorySync {
  constructor({ workspace, exporter }) {
    this.workspace = workspace
    // v1.5.3 关键：依赖注入 ChatHistoryExporter（格式转换器）
    this.exporter = exporter
    this.pendingQueue = new Set()
    this.debounceTimer = null
    this.DELAY_MS = 5000
  }

  /**
   * 标记 session 需要同步。幂等（Set 去重），自动 schedule 5s debounce。
   * @param {string} sessionId
   */
  markPending(sessionId) {
    this.pendingQueue.add(sessionId)
    this.scheduleExport()
  }

  /**
   * 5 秒 debounce：每次 markPending 重置计时器，5 秒无新标记后触发批量导出。
   */
  scheduleExport() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.exportAllPending().catch(err => console.error('[ChatHistorySync]', err))
    }, this.DELAY_MS)
  }

  /**
   * v1.5.3 关键：exportSession 是 IO 编排，调用 exporter 做格式转换
   * @param {string} sessionId
   * @param {string} workspacePath
   * @returns {Promise<{status: string, filesWritten: string[], messageCount: number, isFullExport: boolean}>}
   */
  async exportSession(sessionId, workspacePath) {
    // 1. 从 SQLite 读消息
    const messages = await ChatHistory.findAll({
      where: { sessionId },
      order: [['id', 'ASC']]
    })

    const slug = sessionId.substring(0, 8)
    const sessionDir = path.join(workspacePath, 'wiki', 'chat-history', slug)
    const jsonlPath = path.join(sessionDir, 'session.jsonl')
    const mdPath = path.join(sessionDir, 'session.md')
    const tmpUuid = crypto.randomUUID()
    const tmpJsonl = path.join(sessionDir, `.tmp.${tmpUuid}.jsonl`)

    try {
      await fs.mkdir(sessionDir, { recursive: true })

      // 2. 判断是否首次
      let isFullExport = true
      let existingLastId = 0
      try {
        const stat = await fs.stat(jsonlPath)
        if (stat.size > 0) {
          isFullExport = false
          const content = await fs.readFile(jsonlPath, 'utf-8')
          const lines = content.trim().split('\n')
          if (lines.length > 0) {
            const parsed = this.exporter.parseJSONL(content)
            const last = parsed[parsed.length - 1]
            existingLastId = last.id || 0
          }
        }
      } catch { /* 首次 */ }

      // 3. 写 JSONL（v1.5.3 关键：调 exporter.formatJSONL）
      const newMessages = isFullExport
        ? messages
        : messages.filter(m => m.id > existingLastId)

      if (isFullExport) {
        await fs.writeFile(tmpJsonl, this.exporter.formatJSONL(messages), 'utf-8')
      } else if (newMessages.length > 0) {
        // 增量：先复制已有内容，再追加新行
        const existingContent = await fs.readFile(jsonlPath, 'utf-8')
        await fs.writeFile(tmpJsonl, existingContent, 'utf-8')
        await fs.appendFile(tmpJsonl, this.exporter.formatJSONL(newMessages), 'utf-8')
      }

      // 4. 原子 rename
      if (newMessages.length > 0 || isFullExport) {
        await fs.rename(tmpJsonl, jsonlPath)
      }

      // 5. 重生成 MD（v1.5.3 关键：调 exporter.formatMD）
      const mdContent = this.exporter.formatMD(sessionId, messages, workspacePath)
      await fs.writeFile(mdPath, mdContent, 'utf-8')

      return { status: 'ok', filesWritten: [jsonlPath, mdPath], messageCount: messages.length, isFullExport }
    } catch (err) {
      await fs.rm(tmpJsonl, { force: true }).catch(() => {})
      throw new WorkspaceError('CHAT_HISTORY_EXPORT_FAIL', err.message, true, err)
    }
  }

  /**
   * 批量导出 pendingQueue 中所有 session。
   * @returns {Promise<{exported: string[], errors: Array<{sessionId: string, error: Error}>}>}
   */
  async exportAllPending() {
    const current = this.workspace.current()
    if (!current) return { exported: [], errors: [] }

    const exported = []
    const errors = []
    const toExport = [...this.pendingQueue]
    this.pendingQueue.clear()

    for (const sessionId of toExport) {
      try {
        await this.exportSession(sessionId, current.path)
        exported.push(sessionId)
      } catch (err) {
        errors.push({ sessionId, error: err })
      }
    }

    // 兜底：SQLite 查最近 60s 活跃的 ChatSession
    try {
      const cutoff = new Date(Date.now() - 60000)
      const recent = await ChatSession.findAll({
        where: { workspacePath: current.path, lastActivity: { [Op.gt]: cutoff } }
      })
      for (const sess of recent) {
        if (!exported.includes(sess.sessionId)) {
          try {
            await this.exportSession(sess.sessionId, current.path)
            exported.push(sess.sessionId)
          } catch (err) {
            errors.push({ sessionId: sess.sessionId, error: err })
          }
        }
      }
    } catch (err) {
      // ChatSession 表可能不存在（首次运行），忽略
    }

    return { exported, errors }
  }

  /**
   * 同步刷新：立即导出 pendingQueue 中所有 session，不等待 debounce。
   * @returns {Promise<{exported: string[], errors: Array<{sessionId: string, error: Error}>}>}
   */
  async flushPendingExports() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    return await this.exportAllPending()
  }

  /**
   * 列出 workspace 下所有聊天会话。
   * Task 2.14 实现。
   * @param {string} workspacePath
   * @returns {Promise<Array>}
   */
  async listSessions(workspacePath) {
    const fileSessions = []

    // 源 1: 文件系统 — 扫描 wiki/chat-history/*/session.md
    const chatHistoryDir = path.join(workspacePath, 'wiki', 'chat-history')
    let dirs = []
    try { dirs = await fs.readdir(chatHistoryDir) } catch { dirs = [] }

    for (const dir of dirs) {
      const mdPath = path.join(chatHistoryDir, dir, 'session.md')
      try {
        const raw = await fs.readFile(mdPath, 'utf-8')
        const { data: fm } = matter(raw)
        // 严格隔离：workspacePath 可能存为正斜杠，比较时统一归一化
        if (fm.workspacePath && fm.workspacePath.replace(/\\/g, '/') !== workspacePath.replace(/\\/g, '/')) continue
        fileSessions.push({ ...fm, source: 'file', pending: false })
      } catch { continue }
    }

    // 源 2: SQLite 60s 内的（双源合并补救 5 秒空窗）
    const cutoff = new Date(Date.now() - 60000)
    try {
      const recent = await ChatSession.findAll({
        where: { workspacePath, lastActivity: { [Op.gt]: cutoff } }
      })
      for (const r of recent) {
        if (!fileSessions.find(s => s.sessionId === r.sessionId)) {
          fileSessions.push({
            sessionId: r.sessionId,
            title: r.sessionName,
            createdAt: r.createdAt,
            lastActivity: r.lastActivity,
            messageCount: 0,
            workspacePath,
            source: 'sqlite',
            pending: true
          })
        }
      }
    } catch { /* ChatSession 表可能不存在（首次运行） */ }

    return fileSessions
  }

  /**
   * 加载指定 session 的消息列表（委托 ChatHistoryExporter.loadSession）。
   * @param {string} sessionId
   * @param {string} workspacePath
   * @returns {Promise<{messages: Array, renderedMd: string, summary: object}>}
   */
  async loadSession(sessionId, workspacePath) {
    return await this.exporter.loadSession(sessionId, workspacePath)
  }

  /**
   * 迁移 session 从一个 workspace 到另一个。
   * Task 2.15 实现。
   * @param {string} sessionId
   * @param {string} from - 源 workspace 路径
   * @param {string} to   - 目标 workspace 路径
   * @returns {Promise<{updated: boolean}>}
   */
  async migrateSession(sessionId, from, to) {
    // 1. 更新 SQLite（ChatHistory + ChatSession 的 workspacePath）
    await ChatHistory.update({ workspacePath: to }, { where: { sessionId } })
    await ChatSession.update({ workspacePath: to }, { where: { sessionId } })

    // 2. 旧文件加 supersededBy（不删）
    const slug = sessionId.substring(0, 8)
    const oldMd = path.join(from, 'wiki', 'chat-history', slug, 'session.md')

    let oldExists = false
    try { await fs.stat(oldMd); oldExists = true } catch { /* 文件不存在 */ }

    if (oldExists) {
      try {
        const raw = await fs.readFile(oldMd, 'utf-8')
        const { data: fm, content } = matter(raw)
        fm.supersededBy = to
        fm.supersededAt = new Date().toISOString()
        await fs.writeFile(oldMd, matter.stringify(content, fm))
      } catch (err) {
        // 文件操作失败不阻塞迁移（DB 已更新）
        console.error('[ChatHistorySync.migrateSession] 旧文件标记失败:', err.message)
      }
    }

    // 3. 触发 markPending 让 5 秒内自动 exportAllPending
    this.markPending(sessionId)

    return { updated: true }
  }

  /**
   * 工作区切换回调。Task 2.15 实现。
   * WorkspaceManager.open/close 自动调用，确保切工作区时：
   * - 旧工作区所有 pending 会话先 flush 导出
   * - 清空内存中的 pendingQueue
   * - 新工作区自动 scheduleExport
   * @param {string|null} from - 旧工作区路径（null 表示无旧工作区）
   * @param {string|null} to   - 新工作区路径（null 表示关闭）
   */
  async onWorkspaceChange(from, to) {
    if (from) {
      try { await this.flushPendingExports() } catch (err) {
        console.error('[ChatHistorySync.onWorkspaceChange] flush 失败:', err.message)
      }
    }
    this.pendingQueue.clear()
    if (to) this.scheduleExport()
  }
}

module.exports = { ChatHistorySync }

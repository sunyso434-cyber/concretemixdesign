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
    // listSessionsGrouped 缓存（避免切换会话时全表扫描）
    this._groupedCache = null
    this._groupedCacheAt = 0
    this._groupedCacheTTL = 30000 // 30 秒
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
   * 强制导出所有 pending 会话（用于 before-quit，不等待 debounce）
   */
  async flush() {
    const pendingIds = Array.from(this.pendingQueue || [])
    for (const sessionId of pendingIds) {
      try {
        await this.exportSession(sessionId)
      } catch (err) {
        console.warn(`[ChatHistorySync] flush ${sessionId} 失败: ${err.message}`)
      }
    }
    if (this.pendingQueue) this.pendingQueue.clear()
  }

  /**
   * v1.5.3 关键：exportSession 是 IO 编排，调用 exporter 做格式转换
   * @param {string} sessionId
   * @param {string} workspacePath
   * @returns {Promise<{status: string, filesWritten: string[], messageCount: number, isFullExport: boolean}>}
   */
  async exportSession(sessionId, workspacePath) {
    const targetWorkspacePath = await this._resolveWorkspacePath(sessionId, workspacePath)
    if (!targetWorkspacePath) {
      throw new WorkspaceError('CHAT_HISTORY_WORKSPACE_MISSING', `session ${sessionId} 缺少工作区路径`, true)
    }
    workspacePath = targetWorkspacePath

    // 1. 从 SQLite 读消息
    const messages = await ChatHistory.findAll({
      where: { sessionId },
      order: [['id', 'ASC']]
    })

    const slug = this._getSessionDirName(sessionId)
    const sessionDir = path.join(targetWorkspacePath, 'wiki', 'chat-history', slug)
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
let mdContent = this.exporter.formatMD(sessionId, messages, workspacePath)
      mdContent = this.exporter.formatMD(sessionId, messages, targetWorkspacePath)
      await fs.writeFile(mdPath, mdContent, 'utf-8')

      // 6. Task 3.4 (P3)：exportSession 成功后 → 增量更新 chatBM25Index
      // 失败不阻塞主流程（exporter 内部 catch + log）
      if (typeof this.exporter.updateChatBM25Index === 'function') {
        await this.exporter.updateChatBM25Index(sessionId, targetWorkspacePath)
      }

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
        const workspacePath = await this._resolveWorkspacePath(sessionId, current.path, true)
        await this.exportSession(sessionId, workspacePath)
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
            const workspacePath = await this._resolveWorkspacePath(sess.sessionId, current.path, true)
            await this.exportSession(sess.sessionId, workspacePath)
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
   * Task 2.15b：按工作区分组列出所有会话。
   * 查询 SQLite 中所有已知 workspacePath + 当前打开的工作区，
   * 对每个路径调 listSessions 合并文件+SQLite 双源。
   * @returns {Promise<{workspaces: Array<{path, basename, sessionCount, sessions}>, unclassified: Array}>}
   */
  async listSessionsGrouped() {
    // 自动修复默认标题：把"新会话-/新对话 /对话 MM-DD HH:mm/对话 YYYY-MM-DD HH:mm"
    // 等历史遗留标题替换为第一条用户消息前 15 字
    const isDefaultName = (name) =>
      !name ||
      name.startsWith('新会话-') ||
      name.startsWith('新对话 ') ||
      /^对话 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(name) ||
      /^对话 \d{2}-\d{2} \d{2}:\d{2}$/.test(name)

    // 缓存命中：30 秒内直接返回缓存（避免切换会话时全表扫描）
    // 但缓存中若仍包含默认标题，则跳过缓存继续执行修复
    const now = Date.now()
    if (this._groupedCache && (now - this._groupedCacheAt) < this._groupedCacheTTL) {
      const hasDefault = this._groupedCache.workspaces.some(ws =>
        ws.sessions.some(s => isDefaultName(s.sessionName))
      ) || this._groupedCache.unclassified.some(s => isDefaultName(s.sessionName))
      if (!hasDefault) {
        return this._groupedCache
      }
    }

    const { ChatSession, ChatHistory } = require('../db/database')
    const { fn, col } = require('sequelize')

    const unclassified = []

    // v8.1.0 hotfix-6: 直接从 ChatSession 表查询所有会话，不再依赖文件系统扫描
    // 之前的问题：listSessions 依赖文件系统扫描 + 60s 窗口，导致重命名后会话丢失
    try {
      // 1. 查询 ChatSession 记录（limit 100，避免全表扫描）
      const allSessions = await ChatSession.findAll({
        order: [['lastActivity', 'DESC']],
        limit: 100,
        raw: true
      })

      // 2. 批量查询每个 session 的最后消息时间（从 ChatHistory 表）
      const sessionIds = allSessions.map(s => s.sessionId)
      let activityMap = {}
      if (sessionIds.length > 0) {
        const activityRows = await ChatHistory.findAll({
          attributes: [
            'sessionId',
            [fn('MAX', col('createdAt')), 'lastActivity']
          ],
          where: { sessionId: sessionIds },
          group: ['sessionId'],
          raw: true
        })
        activityMap = Object.fromEntries(
          activityRows.map(r => [r.sessionId, r.lastActivity])
        )
      }

      for (const s of allSessions) {
        if (isDefaultName(s.sessionName)) {
          try {
            const firstUser = await ChatHistory.findOne({
              where: { sessionId: s.sessionId, role: 'user' },
              order: [['createdAt', 'ASC'], ['id', 'ASC']],
              raw: true
            })
            if (firstUser?.content) {
              const title = [...firstUser.content.trim()].slice(0, 15).join('')
              await ChatSession.update({ sessionName: title }, { where: { sessionId: s.sessionId } })
              s.sessionName = title
            }
          } catch (titleErr) {
            console.warn('[listSessionsGrouped] 自动生成标题失败:', s.sessionId, titleErr.message)
          }
        }
      }

      // 3. 按 workspacePath 分组
      const wsMap = new Map()
      for (const s of allSessions) {
        const wsPath = s.workspacePath
        if (wsPath) {
          const normalizedPath = wsPath.replace(/\\/g, '/')
          if (!wsMap.has(normalizedPath)) {
            wsMap.set(normalizedPath, [])
          }
          wsMap.get(normalizedPath).push({
            sessionId: s.sessionId,
            sessionName: s.sessionName,
            lastActivity: activityMap[s.sessionId] || s.lastActivity,
            workspacePath: s.workspacePath,
            source: 'sqlite',
            pending: false
          })
        } else {
          unclassified.push({
            sessionId: s.sessionId,
            sessionName: s.sessionName,
            lastActivity: activityMap[s.sessionId] || s.lastActivity,
            workspacePath: null,
            source: 'sqlite',
            pending: false
          })
        }
      }

      // 4. 构造 workspaces 数组
      const workspaces = []
      for (const [wsPath, sessions] of wsMap.entries()) {
        const basename = wsPath.split('/').filter(Boolean).pop() || wsPath
        workspaces.push({
          path: wsPath,
          basename,
          sessionCount: sessions.length,
          sessions
        })
      }

      // 按 basename 排序
      workspaces.sort((a, b) => a.basename.localeCompare(b.basename, 'zh-CN'))

      const result = { workspaces, unclassified }
      // 写入缓存
      this._groupedCache = result
      this._groupedCacheAt = Date.now()
      return result
    } catch (err) {
      console.error('[ChatHistorySync.listSessionsGrouped] 失败:', err.message)
      return { workspaces: [], unclassified: [] }
    }
  }

  /**
   * 失效 listSessionsGrouped 缓存（创建/删除/重命名会话时调用）
   */
  invalidateGroupedCache() {
    this._groupedCache = null
    this._groupedCacheAt = 0
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
    const slug = this._getSessionDirName(sessionId)
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
  _getSessionDirName(sessionId) {
    const raw = String(sessionId || '').trim()
    const safe = raw.replace(/[^A-Za-z0-9_-]/g, '_')
    return safe || 'unknown-session'
  }

  async _resolveWorkspacePath(sessionId, fallbackPath = null, preferDatabase = false) {
    const fromDatabase = async () => {
      if (typeof ChatSession.findOne !== 'function') return null
      const session = await ChatSession.findOne({
        where: { sessionId },
        raw: true
      })
      return session?.workspacePath || null
    }

    if (preferDatabase) {
      try {
        const workspacePath = await fromDatabase()
        if (workspacePath) return workspacePath
      } catch {}
    }

    if (fallbackPath) return fallbackPath

    try {
      const workspacePath = await fromDatabase()
      if (workspacePath) return workspacePath
    } catch {}

    const current = typeof this.workspace?.current === 'function' ? this.workspace.current() : null
    return current?.path || null
  }

  /**
   * 删除工作区里 session 的归档目录（wiki/chat-history/<safe-name>）
   * P1：会话删除/清空时同步清理 FTS 索引文件和 BM25 索引
   * @returns {Promise<{removed: boolean, sessionDir: string}>}
   */
  async removeSessionArchive(sessionId, workspacePath = null) {
    const targetWorkspacePath = await this._resolveWorkspacePath(sessionId, workspacePath)
    if (!targetWorkspacePath) return { removed: false, sessionDir: null }

    const slug = this._getSessionDirName(sessionId)
    const sessionDir = path.join(targetWorkspacePath, 'wiki', 'chat-history', slug)
    let removed = false
    try {
      await fs.rm(sessionDir, { recursive: true, force: true })
      removed = true
    } catch (err) {
      console.warn('[ChatHistorySync.removeSessionArchive] 删除失败:', err.message)
    }

    // 同步清掉 BM25 缓存里的对应 session.md
    try {
      if (typeof this.exporter?.updateChatBM25Index === 'function') {
        await this.exporter.updateChatBM25Index(sessionId, targetWorkspacePath)
      }
    } catch (err) {
      console.warn('[ChatHistorySync.removeSessionArchive] 重建 BM25 失败:', err.message)
    }

    return { removed, sessionDir }
  }

  /**
   * 删除工作区里整个 wiki/chat-history 目录（"清空全部对话"使用）
   * P1：清空数据库时同步清理所有 markdown/jsonl 归档 + BM25 索引
   * @param {string} [workspacePath] - 不传则用当前工作区
   * @returns {Promise<{removed: boolean, chatHistoryDir: string|null}>}
   */
  async removeAllArchives(workspacePath = null) {
    const target = workspacePath
      || (typeof this.workspace?.current === 'function' ? this.workspace.current()?.path : null)
    if (!target) return { removed: false, chatHistoryDir: null }

    const chatHistoryDir = path.join(target, 'wiki', 'chat-history')
    let removed = false
    try {
      await fs.rm(chatHistoryDir, { recursive: true, force: true })
      removed = true
    } catch (err) {
      console.warn('[ChatHistorySync.removeAllArchives] 删除失败:', err.message)
    }
    // 清空 index.json 里的 chatBM25Index，避免旧 session.md 路径残留
    try {
      const { loadIndex, saveIndex } = require('./index-store')
      const index = await loadIndex(target)
      index.chatBM25Index = { vocabulary: {}, postings: {}, docLengths: {}, avgDocLength: 0, totalDocs: 0 }
      await saveIndex(target, index)
    } catch (err) {
      console.warn('[ChatHistorySync.removeAllArchives] 清空 chatBM25Index 失败:', err.message)
    }
    return { removed, chatHistoryDir }
  }
}

module.exports = { ChatHistorySync }

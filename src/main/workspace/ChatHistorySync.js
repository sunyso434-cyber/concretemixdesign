/**
 * ChatHistorySync — 聊天历史同步器（v1.5.3 拆为独立文件）
 *
 * 职责：markPending + 5s debounce 批量导出队列。
 * 触发点：AgentMemoryService.saveMessage 调用 global.chatHistorySync.markPending(sessionId)。
 *
 * 依赖注入：
 *   - workspace: WorkspaceManager 实例
 *   - exporter:  ChatHistoryExporter 实例（格式转换器，P1 创建）
 */

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
   * 批量导出 pendingQueue 中所有 session。
   * Task 2.13 实现：遍历 pendingQueue，调 this.exporter.exportSession(sessionId)。
   * @returns {Promise<{exported: string[], errors: Array<{sessionId: string, error: Error}>}>}
   */
  async exportAllPending() {
    // TODO: Task 2.13 实现
  }

  /**
   * 同步刷新：立即导出 pendingQueue 中所有 session，不等待 debounce。
   * Task 2.13 实现。
   * @returns {Promise<{exported: string[], errors: Array<{sessionId: string, error: Error}>}>}
   */
  async flushPendingExports() {
    // TODO: Task 2.13 实现
  }

  /**
   * 列出 workspace 下所有聊天会话。
   * Task 2.14 实现。
   * @param {string} workspacePath
   * @returns {Promise<Array>}
   */
  async listSessions(workspacePath) {
    // TODO: Task 2.14 实现
  }

  /**
   * 加载指定 session 的消息列表。
   * Task 2.14 实现。
   * @param {string} sessionId
   * @param {string} workspacePath
   * @returns {Promise<Array>}
   */
  async loadSession(sessionId, workspacePath) {
    // TODO: Task 2.14 实现
  }

  /**
   * 迁移 session 从一个 workspace 到另一个。
   * Task 2.15 实现。
   * @param {string} sessionId
   * @param {string} from - 源 workspace 路径
   * @param {string} to   - 目标 workspace 路径
   * @returns {Promise<void>}
   */
  async migrateSession(sessionId, from, to) {
    // TODO: Task 2.15 实现
  }
}

module.exports = { ChatHistorySync }

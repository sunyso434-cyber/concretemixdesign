/**
 * SuggestionStore - 偏好建议内存存储（主进程单例）
 * 不持久化（老板重启后清空）
 */
class SuggestionStore {
  constructor() {
    this._items = []
    this._webContents = new Set()
  }

  registerWebContents(wc) {
    if (wc && !this._webContents.has(wc)) {
      this._webContents.add(wc)
    }
  }

  unregisterWebContents(wc) {
    this._webContents.delete(wc)
  }

  /**
   * 追加建议（去重 by id）
   * @param {Object} suggestion
   */
  add(suggestion) {
    if (!suggestion || !suggestion.id) return
    if (this._items.some(s => s.id === suggestion.id)) return
    this._items.push(suggestion)
    this._broadcast()
  }

  /**
   * @returns {Array<Object>} 当前所有 pending 建议
   */
  list() {
    return [...this._items]
  }

  /**
   * 采纳建议（从列表移除并返回）
   * @param {string} id
   * @returns {Object|null}
   */
  acceptById(id) {
    const idx = this._items.findIndex(s => s.id === id)
    if (idx === -1) return null
    const [sugg] = this._items.splice(idx, 1)
    this._broadcast()
    return sugg
  }

  /**
   * 忽略建议（从列表移除）
   * @param {string} id
   * @returns {boolean}
   */
  dismissById(id) {
    const idx = this._items.findIndex(s => s.id === id)
    if (idx === -1) return false
    this._items.splice(idx, 1)
    this._broadcast()
    return true
  }

  _broadcast() {
    const payload = { suggestions: this.list() }
    for (const wc of this._webContents) {
      try {
        if (wc && !wc.isDestroyed()) {
          wc.send('agent:suggestions:new', payload)
        }
      } catch (_) {
        // 渲染进程已断开，忽略
      }
    }
  }
}

module.exports = { SuggestionStore }

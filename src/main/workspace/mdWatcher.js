// md 阅读器文件监视：chokidar 监视已打开文件，变化时推送 md:file-changed 事件
// 配置抄 AgentMdService.js:168-171 已验证方案：
//   awaitWriteFinish 避免读到写一半的文件；ignoreInitial 不触发历史事件；回调 try/catch 防崩溃
const chokidar = require('chokidar')
const fs = require('fs').promises

class MdWatcher {
  constructor() {
    this._watcher = null
    this._paths = new Set()
    this._sender = null
  }

  setSender(sender) {
    this._sender = sender
  }

  // 变更推送：异步 stat 携带最新 mtimeMs/size，渲染端据此与 lastSeen 比对（自身写 vs 外部修改）
  async _handleChange(fp) {
    try {
      const stat = await fs.stat(fp)
      if (this._sender) this._sender.send('md:file-changed', { filePath: fp, mtimeMs: stat.mtimeMs, size: stat.size })
    } catch {
      // 文件可能被删除，以 0 值推送，渲染端会按"有变化"处理（重读 → 读失败 → 错误提示）
      if (this._sender) this._sender.send('md:file-changed', { filePath: fp, mtimeMs: 0, size: 0 })
    }
  }

  _ensure() {
    if (this._watcher) return this._watcher
    this._watcher = chokidar.watch([], {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignoreInitial: true,
      persistent: true,
      // Windows 降级：原生 fs 事件在原子替换/部分写入下不可靠，轮询兜底（简报 §4.4）
      usePolling: true,
      interval: 1000
    })
    this._watcher.on('change', (fp) => {
      this._handleChange(fp).catch((err) => console.error('[mdWatcher] 推送失败:', err.message))
    })
    // 文件被外部删除：清理句柄避免泄漏，并推送 0 值事件 → 渲染端按"有变化"重读 → 读失败 → 错误提示
    this._watcher.on('unlink', (fp) => {
      this._paths.delete(fp)
      this._handleChange(fp).catch((err) => console.error('[mdWatcher] unlink 推送失败:', err.message))
    })
    this._watcher.on('error', (err) => {
      console.error('[mdWatcher] watcher error:', err.message)
    })
    return this._watcher
  }

  watch(filePath) {
    this._paths.add(filePath)
    this._ensure().add(filePath)
  }

  unwatch(filePath) {
    this._paths.delete(filePath)
    if (this._paths.size === 0) {
      this.close()
      return
    }
    if (this._watcher) this._watcher.unwatch(filePath)
  }

  close() {
    if (this._watcher) {
      this._watcher.close().catch(() => {})
      this._watcher = null
    }
    this._paths.clear()
  }

  get watchingCount() {
    return this._paths.size
  }
}

// 全局单例（懒初始化；无监视项时 close 释放句柄）
module.exports = new MdWatcher()

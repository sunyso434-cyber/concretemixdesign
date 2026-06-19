const fs = require('fs').promises
const path = require('path')
const chokidar = require('chokidar')
const { WorkspaceError } = require('./WorkspaceError')

class WorkspaceManager {
  constructor() {
    this._state = { path: null, status: 'idle', lastError: null }
  }

  async open(p) {
    this._state.status = 'opening'
    // v4.10.0 (P2b final review fix I-1)：先捕获旧路径切出，再覆盖 _state
    const oldPath = this._state.path
    try {
      const stat = await fs.stat(p)
      if (!stat.isDirectory()) {
        throw new WorkspaceError('PATH_INVALID', `${p} 不是目录`, false)
      }
      await fs.access(p, fs.constants.W_OK)
      for (const sub of ['wiki', 'reports', 'chat-history']) {
        await fs.mkdir(path.join(p, sub), { recursive: true })
      }
      const newPath = p.replace(/\\/g, '/')
      // 先切出新工作区（flush pending exports）
      if (this._sync && oldPath) {
        await this._sync.onWorkspaceChange(oldPath, newPath).catch(err =>
          console.error('[WorkspaceManager.open] onWorkspaceChange(flush) 失败:', err.message)
        )
      }
      // 再覆盖 _state 切入新工作区
      this._state = { path: newPath, status: 'ready', lastError: null }
    } catch (err) {
      this._state.status = 'error'
      this._state.lastError = err.message
      if (err instanceof WorkspaceError) throw err
      throw new WorkspaceError('PATH_INVALID', err.message, false, err)
    }
  }

  async close() {
    const oldPath = this._state.path
    // v4.10.0 (P2b final review fix I-2)：await onWorkspaceChange 保证
    // exportAllPending 拿到旧路径，再重置状态
    if (this._sync && oldPath) {
      await this._sync.onWorkspaceChange(oldPath, null).catch(err =>
        console.error('[WorkspaceManager.close] onWorkspaceChange 失败:', err.message)
      )
    }
    this.unwatch()
    this._state = { path: null, status: 'idle', lastError: null }
  }

  /**
   * v1.5.3 Task 2.15：绑定 ChatHistorySync 实例
   * @param {Object} sync - ChatHistorySync 实例
   */
  attachSync(sync) { this._sync = sync }

  watch(wikiEngine) {
    if (this._watcher) this._watcher.close()
    const watchPath = this._state.path
    console.log('[WorkspaceManager.watch] starting chokidar on:', watchPath)
    this._watcher = chokidar.watch(watchPath, {
      ignored: [
        /(^|[\/\\])wiki\//, /(^|[\/\\])reports\//, /(^|[\/\\])chat-history\//,
        /(^|[\/\\])\.tmp\//, /^~\$/, /\.crdownload$/, /\.part$/,
        /(^|[\/\\])\.DS_Store$/, /(^|[\/\\])Thumbs\.db$/, /(^|[\/\\])desktop\.ini$/,
        /(^|[\/\\])\..+/  // 隐藏文件
      ],
      persistent: true,
      // v2026-06-19 hotfix (v4.9.2)：Windows 上用 polling 而非 ReadDirectoryChangesW
      // 老板报告"v4.9.1 仍不自动 ingest"：chokidar 默认 ReadDirectoryChangesW
      // 对资源管理器拖入 / 其他进程创建的文件可能不触发 add 事件
      // 改 polling（1 秒轮询）虽然耗 CPU 但 100% 触发
      usePolling: true,
      interval: 1000,
      binaryInterval: 2000,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }  // 1 秒去抖
    })
    this._watcher.on('ready', () => {
      console.log('[chokidar] ready, watching:', watchPath)
    })
    this._watcher.on('add', async (fp) => {
      // v2026-06-19 hotfix (v4.9.1)：Windows 路径修正
      const rel = path.relative(watchPath, fp).replace(/\\/g, '/')
      console.log('[chokidar] add:', rel)
      if (/\.(pdf|md|docx|xlsx|xls|txt|csv)$/i.test(rel)) {
        try {
          const result = await wikiEngine.ingest({ filename: rel })
          console.log('[chokidar] ingest OK:', rel, '→', result.pagesCreated)
        } catch (err) {
          console.error('[chokidar] Auto-ingest failed:', rel, err.message)
        }
      }
    })
    this._watcher.on('error', (err) => {
      console.error('[chokidar] error:', err.message)
    })
  }

  unwatch() {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  }

  current() {
    if (this._state.status === 'idle') return null
    return { path: this._state.path, status: this._state.status }
  }

  async listFiles(subdir) {
    if (this._state.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    const targetPath = subdir === 'root'
      ? this._state.path
      : path.posix.join(this._state.path, subdir)
    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true })
      return entries
        .filter(e => e.isFile() && !e.name.startsWith('.'))  // 排除隐藏
        .map(e => ({
          name: e.name,
          path: path.posix.join(subdir, e.name),
          size: 0  // 可选：调 fs.stat 补
        }))
    } catch (err) {
      throw new WorkspaceError('READ_FAIL', err.message, true, err)
    }
  }
}

module.exports = { WorkspaceManager }
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
    try {
      // 1. 校验路径
      const stat = await fs.stat(p)
      if (!stat.isDirectory()) {
        throw new WorkspaceError('PATH_INVALID', `${p} 不是目录`, false)
      }
      // 2. 校验可写
      await fs.access(p, fs.constants.W_OK)
      // 3. 建子目录
      for (const sub of ['wiki', 'reports', 'chat-history']) {
        await fs.mkdir(path.join(p, sub), { recursive: true })
      }
      // 4. 切状态
      this._state = {
        path: p.replace(/\\/g, '/'),  // 统一正斜杠
        status: 'ready',
        lastError: null
      }

      // 5. v1.5.3 Task 2.15：通知 Sync 切入了新工作区
      if (this._sync) {
        await this._sync.onWorkspaceChange(null, this._state.path).catch(err =>
          console.error('[WorkspaceManager.open] onWorkspaceChange 失败:', err.message)
        )
      }
    } catch (err) {
      this._state.status = 'error'
      this._state.lastError = err.message
      if (err instanceof WorkspaceError) throw err
      throw new WorkspaceError('PATH_INVALID', err.message, false, err)
    }
  }

  close() {
    // v1.5.3 Task 2.15：调 Sync.onWorkspaceChange 通知切出工作区
    if (this._sync) {
      this._sync.onWorkspaceChange(this._state.path, null).catch(err =>
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
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
    } catch (err) {
      this._state.status = 'error'
      this._state.lastError = err.message
      if (err instanceof WorkspaceError) throw err
      throw new WorkspaceError('PATH_INVALID', err.message, false, err)
    }
  }

  close() {
    this.unwatch()
    this._state = { path: null, status: 'idle', lastError: null }
  }

  watch(wikiEngine) {
    if (this._watcher) this._watcher.close()
    const watchPath = this._state.path
    this._watcher = chokidar.watch(watchPath, {
      ignored: [
        /(^|[\/\\])wiki\//, /(^|[\/\\])reports\//, /(^|[\/\\])chat-history\//,
        /(^|[\/\\])\.tmp\//, /^~\$/, /\.crdownload$/, /\.part$/,
        /(^|[\/\\])\.DS_Store$/, /(^|[\/\\])Thumbs\.db$/, /(^|[\/\\])desktop\.ini$/,
        /(^|[\/\\])\..+/  // 隐藏文件
      ],
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }  // 1 秒去抖
    })
    this._watcher.on('add', async (fp) => {
      // v2026-06-19 hotfix (v4.9.1)：Windows 路径修正
      // 老板报告"chokidar 拖入文件不自动 ingest"，根因：path.posix.relative()
      // 在 Windows 上对含 drive letter 的路径（如 C:\Users\...）算错，POSIX
      // 算法不识别 `C:`，会输出 `../C:\...\test.md` 这种错误相对路径，
      // WikiEngine 找不到文件 → FILE_NOT_FOUND → 静默 catch
      // 修复：先 path.relative() 算平台原生相对路径，再 replace 反斜杠
      const rel = path.relative(watchPath, fp).replace(/\\/g, '/')
      if (/\.(pdf|md|docx|xlsx|xls|txt|csv)$/i.test(rel)) {
        try { await wikiEngine.ingest({ filename: rel }) }
        catch (err) { console.error('Auto-ingest failed:', err.message) }
      }
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
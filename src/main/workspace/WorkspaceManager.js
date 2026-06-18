const fs = require('fs').promises
const path = require('path')
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
    this._state = { path: null, status: 'idle', lastError: null }
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
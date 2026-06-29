const EventEmitter = require('events')
const fs = require('fs').promises
const path = require('path')
const chokidar = require('chokidar')
const { WorkspaceError } = require('./WorkspaceError')
const lastWorkspaceStore = require('./lastWorkspaceStore')

class WorkspaceManager extends EventEmitter {
  constructor() {
    super()
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
      // v2026-06-23：清理上次崩溃留下的孤儿 .workspace-index.json.tmp.* 文件
      // saveIndex 是原子写（先写 tmp 再 rename），但中途崩溃会让 tmp 留下
      try {
        const { cleanupOrphanTmps } = require('./index-store')
        const removed = await cleanupOrphanTmps(p)
        if (removed > 0) console.log(`[WorkspaceManager.open] 清理了 ${removed} 个孤儿 tmp 文件`)
      } catch (err) {
        // 清理失败不阻塞打开流程
        console.warn('[WorkspaceManager.open] cleanupOrphanTmps 失败:', err.message)
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
      // v9.0.0 补充21：open 成功 → 持久化"上次工作区"路径，启动时自动恢复
      try { lastWorkspaceStore.set(newPath) } catch (_) { /* store 未 init 时静默 */ }
      // emit 'opened' 事件（供 main.js batchUpgrade 监听）
      this.emit('opened', newPath)
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
    await this.unwatch()
    this._state = { path: null, status: 'idle', lastError: null }
    // v9.0.0 补充21：close → 清除持久化的"上次工作区"（用户主动关闭，下次启动显示欢迎页）
    try { lastWorkspaceStore.clear() } catch (_) { /* store 未 init 时静默 */ }
  }

  /**
   * v1.5.3 Task 2.15：绑定 ChatHistorySync 实例
   * @param {Object} sync - ChatHistorySync 实例
   */
  attachSync(sync) { this._sync = sync }

  watch(wikiEngine) {
    // 先清理旧 watcher（await close 避免新旧 watcher 并存导致重复 ingest）
    // 注意：这里用同步清理只是兜底，正式清理应通过 close() 走 await unwatch()
    if (this._watcher) {
      this._watcher.close().catch(() => {})
    }
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
      // ignoreInitial: 打开工作区时不触发历史文件的 'add' 事件
      // 历史文件已通过 ingest 导入并生成元数据，无需重新 ingest
      // 避免 N 个并发 ingest 全量重建 BM25 导致内存爆炸
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }  // 1 秒去抖
    })
    this._watcher.on('ready', () => {
      console.log('[chokidar] ready, watching:', watchPath)
    })
    // 串行队列：前一个 ingest 完成才处理下一个，避免并发 ingest 全量 rebuild BM25 导致 N² readFile
    this._ingestQueue = Promise.resolve()
    this._watcher.on('add', (fp) => {
      // v2026-06-19 hotfix (v4.9.1)：Windows 路径修正
      const rel = path.relative(watchPath, fp).replace(/\\/g, '/')
      console.log('[chokidar] add:', rel)
      if (/\.(pdf|md|docx|xlsx|xls|txt|csv)$/i.test(rel)) {
        this._ingestQueue = this._ingestQueue
          .then(async () => {
            try {
              const result = await wikiEngine.ingest({ filename: rel })
              console.log('[chokidar] ingest OK:', rel, '→', result.pagesCreated)
            } catch (err) {
              console.error('[chokidar] Auto-ingest failed:', rel, err.message)
            }
          })
          .catch((err) => {
            // 队列内错误已被 then 内 try/catch 吞掉，这里兜底防止队列断裂
            console.error('[chokidar] ingest queue error:', err.message)
          })
      }
    })
    this._watcher.on('error', (err) => {
      console.error('[chokidar] error:', err.message)
    })
  }

  async unwatch() {
    if (this._watcher) {
      await this._watcher.close()
      this._watcher = null
    }
    // 等待队列内剩余 ingest 完成（不阻塞过久，最多等 30s）
    if (this._ingestQueue) {
      await Promise.race([
        this._ingestQueue,
        new Promise((resolve) => setTimeout(resolve, 30000))
      ]).catch(() => {})
      this._ingestQueue = Promise.resolve()
    }
  }

  current() {
    if (this._state.status === 'idle') return null
    return { path: this._state.path, status: this._state.status }
  }

  /**
   * 列出工作区指定子目录下的条目
   *
   * @param {string} subdir - 子目录（'root' 或相对路径，如 'wiki/sources'）
   * @param {Object} [options]
   * @param {boolean} [options.recursive=false] - 是否递归子目录
   * @param {boolean} [options.includeDirs=false] - 是否包含目录条目（默认仅文件）
   * @param {boolean} [options.withIngestStatus=false] - 是否附加 ingested/wikiPage/lastIngestAt/quality
   *   （从 .workspace-index.json 读，root 目录有意义；wiki 子目录直接返回文件本身的 frontmatter）
   * @returns {Promise<Array<{name, path, size, type, ingested?, wikiPage?, lastIngestAt?, quality?}>>}
   *
   * v2026-06-22：扩展 listFiles 让 LLM 能判断文件是否已摄入
   *   - 加 recursive 选项（LLM 看 wiki 树）
   *   - 加 includeDirs 选项（LLM 看 wiki 顶层目录）
   *   - 加 withIngestStatus 选项（LLM 一眼判断 root 文件是否摄入）
   *   - 默认行为不变，兼容 WorkspaceFilePopover 等现有调用方
   */
  async listFiles(subdir, options = {}) {
    if (this._state.status !== 'ready') {
      throw new WorkspaceError('NOT_OPEN', '工作区未打开', false)
    }
    const { recursive = false, includeDirs = false, withIngestStatus = false } = options
    const targetPath = subdir === 'root'
      ? this._state.path
      : path.posix.join(this._state.path, subdir)

    // withIngestStatus：预读 .workspace-index.json（仅 root 目录用得到）
    let ingestMap = null
    if (withIngestStatus) {
      try {
        const { loadIndex } = require('./index-store')
        const idx = await loadIndex(this._state.path)
        ingestMap = idx.files || {}
      } catch (err) {
        // 索引损坏/不存在 → 当作全部未摄入，不阻塞 listFiles
        ingestMap = {}
      }
    }

    try {
      const results = await this._readDirEntries(targetPath, subdir, {
        recursive, includeDirs, ingestMap, rootForIngest: this._state.path
      })
      return results
    } catch (err) {
      if (err instanceof WorkspaceError) throw err
      throw new WorkspaceError('READ_FAIL', err.message, true, err)
    }
  }

  /**
   * 内部：递归读目录条目（listFiles 辅助）
   */
  async _readDirEntries(absDir, relDir, { recursive, includeDirs, ingestMap, rootForIngest }) {
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch (err) {
      if (err.code === 'ENOENT') return []  // 子目录不存在 → 返回空数组而非抛错
      throw err
    }

    const out = []
    for (const e of entries) {
      // 排除隐藏文件/目录（包括 .workspace-index.json）
      if (e.name.startsWith('.')) continue

      const entryPath = path.posix.join(absDir, e.name)
      const entryRel = path.posix.join(relDir, e.name)

      if (e.isDirectory()) {
        if (includeDirs) {
          out.push({ name: e.name, path: entryRel, size: 0, type: 'dir' })
        }
        if (recursive) {
          const sub = await this._readDirEntries(entryPath, entryRel, {
            recursive, includeDirs, ingestMap, rootForIngest
          })
          out.push(...sub)
        }
      } else if (e.isFile()) {
        const fileEntry = { name: e.name, path: entryRel, size: 0, type: 'file' }
        // 仅当 subdir === 'root' 时把 ingested 状态挂上
        // （wiki 子目录下的文件本身就是摄入产物，不存在「再摄入」语义）
        if (ingestMap && relDir === 'root') {
          // ingestMap 的 key 是原始源文件名（即 root 下的 filename）
          const info = ingestMap[e.name]
          if (info) {
            fileEntry.ingested = true
            fileEntry.wikiPage = info.wikiPage
            fileEntry.lastIngestAt = info.lastIngestAt
            fileEntry.quality = info.quality
          } else {
            fileEntry.ingested = false
          }
        }
        out.push(fileEntry)
      }
    }
    return out
  }
}

module.exports = { WorkspaceManager }
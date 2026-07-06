const fs = require('fs')
const path = require('path')
const chokidar = require('chokidar')
const { AgentMdParser } = require('./AgentMdParser')

/**
 * AgentMdService - agent.md 的 IO + 缓存 + 文件监听服务
 *
 * 职责:
 *  - 从磁盘读取 agent.md 解析后缓存
 *  - 把内容写回磁盘并同步缓存
 *  - 用 chokidar 监听外部修改,自动刷新缓存
 *
 * 设计原则:
 *  - 解析逻辑委托给 AgentMdParser(纯函数)
 *  - IO 与解析分离,便于单测
 *  - chokidar 选型原因: fs.watch 在 Windows 不可靠 + 不支持原子保存场景
 */
class AgentMdService {
  constructor({ path: agentMdPath } = {}) {
    this.path = agentMdPath
    this.cache = null
    this.rawCache = null
    this.watcher = null
    this._writeQueue = Promise.resolve()  // 串行队列
  }

  /**
   * 从磁盘加载 agent.md 并刷新缓存
   * 文件不存在时初始化为空结构(不抛错)
   * 文件过大(>1MB)时输出 warning
   * 非 UTF-8 编码时抛出友好错误
   *
   * 兜底策略:
   *  - 读盘失败(非 ENOENT)时尝试 .bak
   *  - 解析失败时尝试 .bak,成功则自动把 .bak 写回主文件(最佳努力)
   */
  loadFromFile() {
    let content = null
    try {
      const buf = fs.readFileSync(this.path)
      content = this._decodeUtf8(buf)

      // 文件大小警告
      if (buf.length > 1024 * 1024) {
        console.warn(`[AgentMdService] 文件过大 (${buf.length} 字节 > 1MB)，建议精简以提升加载速度`)
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        content = ''
      } else {
        // 读盘失败:尝试 .bak
        content = this._tryLoadBackup()
        if (content === null) throw err
      }
    }

    try {
      this.rawCache = content
      this.cache = AgentMdParser.parse(content)
    } catch (err) {
      // 解析失败:尝试 .bak
      console.warn(`[AgentMdService] 主文件解析失败，尝试 .bak fallback: ${err.message}`)
      const backup = this._tryLoadBackup()
      if (backup !== null) {
        this.rawCache = backup
        this.cache = AgentMdParser.parse(backup)
        // 自动恢复:把 .bak 写回主文件(最佳努力)
        try {
          fs.writeFileSync(this.path, backup, 'utf8')
          console.warn('[AgentMdService] 已自动从 .bak 恢复主文件')
        } catch (_) {
          // 恢复失败不影响本次内存态,下次再试
        }
      } else {
        throw err
      }
    }
  }

  /**
   * 尝试加载 .bak 备份内容
   * @returns {string|null} 成功返回内容,失败返回 null
   */
  _tryLoadBackup() {
    try {
      return fs.readFileSync(this.path + '.bak', 'utf8')
    } catch (_) {
      return null
    }
  }

  /**
   * 检测并解码 UTF-8
   * - 自动剥离 UTF-8 BOM
   * - 检测并拒绝 UTF-16 编码
   * - 检测可能的非 UTF-8 编码（含乱码字符）
   * @param {Buffer} buf
   * @returns {string} 解码后的字符串
   */
  _decodeUtf8(buf) {
    // 自动剥离 UTF-8 BOM
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      return buf.slice(3).toString('utf8')
    }
    // 检测 UTF-16 LE BOM
    if (buf[0] === 0xFF && buf[1] === 0xFE) {
      throw new Error('检测到 UTF-16 编码，请用编辑器另存为 UTF-8 后再试')
    }
    // 检测 UTF-16 BE BOM
    if (buf[0] === 0xFE && buf[1] === 0xFF) {
      throw new Error('检测到 UTF-16 编码，请用编辑器另存为 UTF-8 后再试')
    }
    // 尝试 UTF-8 解码
    const str = buf.toString('utf8')
    // 简单检测：是否有乱码字符（replacement character）
    if (str.includes('�')) {
      throw new Error('检测到可能的非 UTF-8 编码（含乱码），请用编辑器另存为 UTF-8 后再试')
    }
    return str
  }

  /**
   * 启动 chokidar 监听外部文件变更
   * awaitWriteFinish 避免读到正在写入的半截文件
   *
   * 容错策略（关键）：
   *  - loadFromFile 内部可能因 YAML/解析错误抛出异常
   *  - 抛出的异常在 chokidar 回调里属于 unhandled exception，会让 Electron 主进程崩溃
   *  - 这里用 try/catch 包裹，错误只打 log + 保留旧缓存，不再让进程死掉
   *  - 用户下次手动改文件或重启即可恢复，比"程序整体崩溃"友好得多
   */
  startWatching() {
    if (this.watcher) return
    this.watcher = chokidar.watch(this.path, {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignoreInitial: true
    })
    this.watcher.on('change', () => {
      try {
        this.loadFromFile()
      } catch (err) {
        console.error('[AgentMdService] 外部修改触发的重新加载失败，已保留旧缓存:', err.message)
      }
    })
    this.watcher.on('error', err => {
      console.error('[AgentMdService] watcher error:', err.message)
    })
  }

  /**
   * 关闭 chokidar watcher
   */
  stopWatching() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * 初始化: 加载一次 + 启动监听
   */
  init() {
    this.loadFromFile()
    this.startWatching()
  }

  /**
   * 写入 agent.md 并同步更新缓存（串行化，防并发竞态）
   *
   * 串行队列（关键）：
   *  - chokidar 外部编辑触发 loadFromFile 与 IPC 触发的 saveToFile 可能并发
   *  - 用 Promise 链 (_writeQueue) 串行化所有 saveToFile 调用
   *  - 避免两次写入交错导致 cache 与磁盘不一致
   *
   * @param {string} content - 完整 Markdown 内容
   * @returns {Promise<void>}
   */
  async saveToFile(content) {
    // 串行化所有 saveToFile 调用，避免并发竞态
    // 队列在 _saveToFileImpl 抛错后会永久 reject（旧错误传播，新写入永远不执行）
    // 拆成 result（返回给 caller，传递真实错误）+ _writeQueue（.catch 兜底，保持队列存活）
    const result = this._writeQueue.then(() => this._saveToFileImpl(content))
    this._writeQueue = result.catch(() => {})
    return result
  }

  /**
   * saveToFile 的实际同步实现（私有）
   *
   * 顺序保护（关键）：
   *  - 先 parse 内容做格式校验，通过后才写盘
   *  - 这样脏数据不会落地，cache 与磁盘永远一致
   *  - 解析失败抛出的错误由调用方（IPC handler）兜底，转成用户友好提示
   *
   * 自动 .bak 备份：仅在主文件已存在时备份
   * 自动创建不存在的父目录
   */
  _saveToFileImpl(content) {
    // 1. 先解析校验（失败会抛错，不写盘）
    const nextCache = AgentMdParser.parse(content)

    // 2. 自动 .bak 备份（仅在主文件已存在时）
    if (fs.existsSync(this.path)) {
      try {
        fs.copyFileSync(this.path, this.path + '.bak')
      } catch (err) {
        console.warn(`[AgentMdService] .bak 备份失败（继续写入）: ${err.message}`)
      }
    }

    // 3. 写盘
    const dir = path.dirname(this.path)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.path, content, 'utf8')

    // 4. 同步缓存
    this.rawCache = content
    this.cache = nextCache
  }

  /**
   * 获取格式化后的 Markdown(用于回写到 .md 时)
   * @returns {string}
   */
  getFormattedRules() {
    if (!this.cache) return ''
    return AgentMdParser.formatToMarkdown(this.cache)
  }

  /**
   * 获取当前缓存的原始文本和解析结果
   * @returns {{raw: string, parsed: Object}}
   */
  getCached() {
    return {
      raw: this.rawCache || '',
      parsed: this.cache || AgentMdParser.parse('')
    }
  }
}

module.exports = { AgentMdService }

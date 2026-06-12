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
  }

  /**
   * 从磁盘加载 agent.md 并刷新缓存
   * 文件不存在时初始化为空结构(不抛错)
   */
  loadFromFile() {
    try {
      const content = fs.readFileSync(this.path, 'utf8')
      this.rawCache = content
      this.cache = AgentMdParser.parse(content)
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.rawCache = ''
        this.cache = AgentMdParser.parse('')
      } else {
        throw err
      }
    }
  }

  /**
   * 启动 chokidar 监听外部文件变更
   * awaitWriteFinish 避免读到正在写入的半截文件
   */
  startWatching() {
    if (this.watcher) return
    this.watcher = chokidar.watch(this.path, {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignoreInitial: true
    })
    this.watcher.on('change', () => this.loadFromFile())
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
   * 写入 agent.md 并同步更新缓存
   * 自动创建不存在的父目录
   * @param {string} content - 完整 Markdown 内容
   */
  saveToFile(content) {
    const dir = path.dirname(this.path)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.path, content, 'utf8')
    this.rawCache = content
    this.cache = AgentMdParser.parse(content)
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

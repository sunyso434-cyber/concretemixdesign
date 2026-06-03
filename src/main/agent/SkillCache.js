/**
 * 技能缓存
 * 缓存常用MD技能的执行结果，提高响应速度
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

class SkillCache {
  constructor(options = {}) {
    this.options = options
    this.cacheDir = options.cacheDir || path.join(os.homedir(), '.concrete-mixdesign', 'skill-cache')
    // 留空，由 init() 从 SystemService 异步填充（或用 options 传入的值）
    this.maxAge = options.maxAge
    this.maxSize = options.maxSize
    this.evictRatio = options.evictRatio
    this.systemService = options.systemService || null
    this.memoryCache = new Map()
    this._initialized = false
  }

  /**
   * 异步初始化：从 SystemService 读取 cfg 填充 maxAge / maxSize / evictRatio（缺失时用兜底默认值）
   * 必须在缓存操作前调用一次。options 传入的值优先（向后兼容）。
   */
  async init() {
    if (this._initialized) return

    if (this.systemService) {
      try {
        const cfg = await this.systemService.getAgentConfig()
        if (this.maxAge === undefined || this.maxAge === null) this.maxAge = cfg.skillCacheMaxAgeMs
        if (this.maxSize === undefined || this.maxSize === null) this.maxSize = cfg.skillCacheMaxSize
        if (this.evictRatio === undefined || this.evictRatio === null) this.evictRatio = cfg.skillCacheEvictRatio
      } catch (err) {
        console.warn('[SkillCache] 读取 SystemService 配置失败，使用默认值:', err.message)
      }
    }

    // 兜底默认值
    if (this.maxAge === undefined || this.maxAge === null) this.maxAge = 7 * 24 * 60 * 60 * 1000 // 7天
    if (this.maxSize === undefined || this.maxSize === null) this.maxSize = 1000 // 最大缓存条目数
    if (this.evictRatio === undefined || this.evictRatio === null) this.evictRatio = 0.1 // 淘汰 10%

    this._ensureCacheDir()
    this._loadFromDisk()
    this._initialized = true
  }

  /**
   * 确保缓存目录存在
   */
  _ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true })
    }
  }

  /**
   * 从磁盘加载缓存
   */
  _loadFromDisk() {
    try {
      const files = fs.readdirSync(this.cacheDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.cacheDir, file)
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
            if (this._isValidEntry(data)) {
              this.memoryCache.set(data.key, data)
            }
          } catch (error) {
            // 忽略损坏的缓存文件
          }
        }
      }
    } catch (error) {
      // 忽略目录读取错误
    }
  }

  /**
   * 生成缓存键
   * @param {string} skillName - 技能名称
   * @param {object} args - 用户参数
   * @returns {string} 缓存键
   */
  generateKey(skillName, args) {
    const argsStr = JSON.stringify(args, Object.keys(args).sort())
    return `${skillName}_${this._hash(argsStr)}`
  }

  /**
   * 简单哈希函数
   */
  _hash(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 转换为32位整数
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * 检查缓存条目是否有效
   */
  _isValidEntry(entry) {
    if (!entry || !entry.key || !entry.data) {
      return false
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.maxAge) {
      return false
    }

    return true
  }

  /**
   * 获取缓存
   * @param {string} key - 缓存键
   * @returns {object|null} 缓存数据
   */
  get(key) {
    const entry = this.memoryCache.get(key)
    if (!entry) {
      return null
    }

    // 检查是否过期
    if (!this._isValidEntry(entry)) {
      this.memoryCache.delete(key)
      this._deleteFromDisk(key)
      return null
    }

    // 更新访问时间
    entry.lastAccess = Date.now()
    entry.accessCount = (entry.accessCount || 0) + 1

    return entry.data
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {object} data - 缓存数据
   * @param {object} metadata - 元数据
   */
  set(key, data, metadata = {}) {
    // 检查缓存大小限制
    if (this.memoryCache.size >= this.maxSize) {
      this._evictOldEntries()
    }

    const entry = {
      key,
      data,
      timestamp: Date.now(),
      lastAccess: Date.now(),
      accessCount: 0,
      ...metadata
    }

    this.memoryCache.set(key, entry)
    this._saveToDisk(key, entry)
  }

  /**
   * 删除缓存
   * @param {string} key - 缓存键
   */
  delete(key) {
    this.memoryCache.delete(key)
    this._deleteFromDisk(key)
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.memoryCache.clear()
    this._clearDisk()
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    let totalSize = 0
    let oldestEntry = null
    let newestEntry = null

    for (const [key, entry] of this.memoryCache) {
      totalSize++
      if (!oldestEntry || entry.timestamp < oldestEntry.timestamp) {
        oldestEntry = entry
      }
      if (!newestEntry || entry.timestamp > newestEntry.timestamp) {
        newestEntry = entry
      }
    }

    return {
      size: totalSize,
      maxSize: this.maxSize,
      oldestEntry: oldestEntry ? new Date(oldestEntry.timestamp).toISOString() : null,
      newestEntry: newestEntry ? new Date(newestEntry.timestamp).toISOString() : null
    }
  }

  /**
   * 淘汰旧条目
   */
  _evictOldEntries() {
    const entries = Array.from(this.memoryCache.entries())
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess)

    // 删除最旧的 evictRatio 比例条目（默认 10%）
    const deleteCount = Math.ceil(this.maxSize * this.evictRatio)
    for (let i = 0; i < deleteCount && i < entries.length; i++) {
      const [key] = entries[i]
      this.delete(key)
    }
  }

  /**
   * 保存到磁盘
   */
  _saveToDisk(key, entry) {
    try {
      const filePath = path.join(this.cacheDir, `${key}.json`)
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8')
    } catch (error) {
      // 忽略写入错误
    }
  }

  /**
   * 从磁盘删除
   */
  _deleteFromDisk(key) {
    try {
      const filePath = path.join(this.cacheDir, `${key}.json`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (error) {
      // 忽略删除错误
    }
  }

  /**
   * 清空磁盘缓存
   */
  _clearDisk() {
    try {
      const files = fs.readdirSync(this.cacheDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.cacheDir, file)
          fs.unlinkSync(filePath)
        }
      }
    } catch (error) {
      // 忽略清空错误
    }
  }
}

module.exports = SkillCache

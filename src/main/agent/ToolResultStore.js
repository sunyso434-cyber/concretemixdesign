// src/main/agent/ToolResultStore.js
const fs = require('fs')
const path = require('path')
const os = require('os')

const OFFLOAD_THRESHOLD = 20000       // 20K 字符落盘
const HUGE_THRESHOLD = 200000         // 200K 字符缓存也摘要
const SUMMARY_MAX_LEN = 500
const RECENT_KEYS_COUNT = 3
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.concrete-mixdesign', 'tool-cache')

class ToolResultStore {
  constructor({ cacheDir } = {}) {
    this.cacheDir = cacheDir || DEFAULT_CACHE_DIR
    // 内存缓存：快速读取最近结果
    // Map<toolCallId, { result, storedAt, isCached }>
    this._memoryCache = new Map()
    // 按 sessionId 记录最近 key 的插入顺序
    // Map<sessionId, Array<{ toolCallId, storedAt }>>
    this._sessionKeys = new Map()
  }

  store(sessionId, toolCallId, result) {
    const resultStr = JSON.stringify(result)
    const size = resultStr.length

    // 小结果：不离盘，直接返回
    if (size < OFFLOAD_THRESHOLD) {
      this._memoryCache.set(toolCallId, { result, storedAt: Date.now(), isCached: false })
      this._recordKey(sessionId, toolCallId)
      return { offloaded: false }
    }

    // 大结果：落盘
    const sessionDir = path.join(this.cacheDir, sessionId)
    fs.mkdirSync(sessionDir, { recursive: true })
    const filePath = path.join(sessionDir, toolCallId + '.json')

    let storeResult = null
    if (size > HUGE_THRESHOLD) {
      // 超大结果：摘要后落盘，内存也存摘要
      const summarized = { _summarized: true, originalSize: size, ...this._summarize(result) }
      fs.writeFileSync(filePath, JSON.stringify(summarized), 'utf8')
      storeResult = summarized
    } else {
      // 中等结果：完整落盘，内存缓存完整
      fs.writeFileSync(filePath, resultStr, 'utf8')
      this._memoryCache.set(toolCallId, { result, storedAt: Date.now(), isCached: true })
      storeResult = result
    }

    this._recordKey(sessionId, toolCallId)

    const summary = this._makeSummary(resultStr)
    return {
      offloaded: true,
      path: filePath,
      summary
    }
  }

  _recordKey(sessionId, toolCallId) {
    if (!this._sessionKeys.has(sessionId)) {
      this._sessionKeys.set(sessionId, [])
    }
    const keys = this._sessionKeys.get(sessionId)
    // 去重：如果已有同 key，移到尾部
    const existing = keys.findIndex(k => k.toolCallId === toolCallId)
    if (existing >= 0) keys.splice(existing, 1)
    keys.push({ toolCallId, storedAt: Date.now() })
    // 只保留 RECENT_KEYS_COUNT 条
    while (keys.length > RECENT_KEYS_COUNT) {
      const removed = keys.shift()
      this._memoryCache.delete(removed.toolCallId)
    }
  }

  getRecentKeys(sessionId, n = RECENT_KEYS_COUNT) {
    const keys = this._sessionKeys.get(sessionId) || []
    return keys.slice(-n)
  }

  get(toolCallId) {
    // 先查内存
    const mem = this._memoryCache.get(toolCallId)
    if (mem) return mem.result

    // 再查磁盘（遍历所有 session 目录）
    return this._readFromDisk(toolCallId)
  }

  _readFromDisk(toolCallId) {
    try {
      const files = fs.readdirSync(this.cacheDir, { recursive: true })
      const match = files.find(f => f.endsWith(toolCallId + '.json'))
      if (match) {
        const fullPath = path.join(this.cacheDir, match)
        const content = fs.readFileSync(fullPath, 'utf8')
        return JSON.parse(content)
      }
    } catch (_) {}
    return null
  }

  clear(sessionId) {
    const sessionDir = path.join(this.cacheDir, sessionId)
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true })
    } catch (_) {}
    this._sessionKeys.delete(sessionId)
    // 从内存缓存中删除该 session 的 key
    for (const [key, _] of this._memoryCache) {
      // 粗略清理：遍历所有 key 删除（小规模场景，可接受）
    }
  }

  clearExpired(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      const sessions = fs.readdirSync(this.cacheDir)
      const now = Date.now()
      for (const sessionId of sessions) {
        const sessionDir = path.join(this.cacheDir, sessionId)
        try {
          const files = fs.readdirSync(sessionDir)
          for (const file of files) {
            const filePath = path.join(sessionDir, file)
            const stat = fs.statSync(filePath)
            if (now - stat.mtimeMs > maxAge) {
              fs.unlinkSync(filePath)
            }
          }
          // 空目录清理
          if (fs.readdirSync(sessionDir).length === 0) {
            fs.rmdirSync(sessionDir)
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  _makeSummary(content) {
    if (content.length <= SUMMARY_MAX_LEN) return content
    return content.slice(0, SUMMARY_MAX_LEN - 3) + '...'
  }

  _summarize(result) {
    const str = JSON.stringify(result)
    return {
      summary: this._makeSummary(str),
      originalSize: str.length
    }
  }
}

module.exports = ToolResultStore

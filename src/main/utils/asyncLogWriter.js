// 异步批量日志写入器：内存队列 + 300ms 批量落盘，避免同步 IO 阻塞主进程事件循环
// 轮转检查降频为每次 flush 至多一次（同步 stat 开销可忽略）
// 取舍：进程崩溃最多丢 300ms 诊断日志（非业务关键数据），换取主进程不被阻塞
// 退出兜底：所有 writer 登记到模块级注册表，main.js before-quit 调 flushAll() 落盘
const fs = require('fs')
const { rotateIfNeeded } = require('./logRotator')

const _writers = new Set()

function createAsyncLogWriter(filePath, { maxSize = 5 * 1024 * 1024, maxFiles = 5, flushIntervalMs = 300 } = {}) {
  let queue = []
  let flushing = false
  let timer = null

  function scheduleFlush() {
    if (timer) return
    timer = setTimeout(flush, flushIntervalMs)
    if (timer.unref) timer.unref()
  }

  async function flush() {
    timer = null
    if (flushing || queue.length === 0) return
    flushing = true
    const lines = queue.join('')
    queue = []
    try {
      rotateIfNeeded(filePath, { maxSize, maxFiles })
      await fs.promises.appendFile(filePath, lines)
    } catch (err) {
      // 日志失败只打控制台，绝不影响业务
      console.error(`[asyncLogWriter] ${filePath} 写入失败:`, err.message)
    } finally {
      flushing = false
      if (queue.length > 0) scheduleFlush()
    }
  }

  const writer = {
    append(line) {
      queue.push(line)
      scheduleFlush()
    },
    flush
  }
  _writers.add(writer)
  return writer
}

// 进程退出前调用：立即落盘全部 writer 的队列
async function flushAll() {
  await Promise.all([..._writers].map(w => w.flush()))
}

module.exports = { createAsyncLogWriter, flushAll }

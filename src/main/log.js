// 日志模块：基于 electron-log，按天切分 + 单日大小兜底 + 定期清理超期文件
const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const log = require('electron-log/main')

// 保留最近的天数（超过自动删除）
const MAX_DAYS = 30
// 单个日志文件超过该大小会轮转为 .old（兜底，避免某天日志特别多导致单文件过大）
const MAX_SIZE = 50 * 1024 * 1024

// 日志目录：<userData>/logs
function logsDir() {
  return path.join(app.getPath('userData'), 'logs')
}

// 当前日志文件名：app-YYYY-MM-DD.log
function todayFileName() {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `app-${date}.log`
}

// 删除超过 MAX_DAYS 天的按天日志文件（含 .old 兜底文件）
function cleanupOldLogs() {
  try {
    const dir = logsDir()
    if (!fs.existsSync(dir)) return
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000
    for (const f of fs.readdirSync(dir)) {
      const m = /^app-(\d{4}-\d{2}-\d{2})\.log(?:\.old)?$/.exec(f)
      if (!m) continue
      const day = new Date(`${m[1]}T00:00:00`).getTime()
      if (Number.isNaN(day) || day < cutoff) {
        // 非当前使用的文件才删除，避免删掉正写入的文件
        if (!f.startsWith(todayFileName())) {
          fs.unlinkSync(path.join(dir, f))
        }
      }
    }
  } catch (e) {
    /* 清理失败不阻塞主流程 */
  }
}

// 初始化日志系统；app.getPath('userData') 在应用 ready 前可能不可用，故用 try-catch 兜底
function setupLogging() {
  log.initialize()

  // 按天切分：每天一个 app-YYYY-MM-DD.log
  log.transports.file.resolvePathFn = () => {
    try {
      return path.join(logsDir(), todayFileName())
    } catch (e) {
      return path.join(__dirname, todayFileName())
    }
  }
  // 单日文件过大时自动轮转为 .old
  log.transports.file.maxSize = MAX_SIZE
  // 控制台输出带级别和时间的清晰格式
  log.transports.console.format = '[{y-m-d} {h:i:s.ms}] {level}: {text}'

  // 让程序里所有 console.log/error/warn 都进入日志文件（保留原终端输出）
  console.log = (...args) => log.log(...args)
  console.error = (...args) => log.error(...args)
  console.warn = (...args) => log.warn(...args)

  cleanupOldLogs()
  // 每 24 小时检查一次，自动清理超期日志
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000)
}

module.exports = { setupLogging, cleanupOldLogs, todayFileName }
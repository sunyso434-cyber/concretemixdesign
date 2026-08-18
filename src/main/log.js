// 日志模块（自实现，不依赖 electron-log——后者在 asar 打包环境下 file transport 写入会失效）。
// 特性：按天切分成 app-YYYY-MM-DD.log、单日大小兜底(.old)、保留最近 MAX_DAYS 天自动清理。
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

// 保留最近的天数（超过自动删除）
const MAX_DAYS = 30
// 单个日志文件超过该大小会轮转为 .old（兜底，避免某天日志特别多导致单文件过大）
const MAX_SIZE = 50 * 1024 * 1024

function pad(n) { return String(n).padStart(2, '0') }

// 本地时间戳：2011-01-01 12:00:00.000
function fmtTime() {
  const d = new Date()
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
  )
}

// 日志目录：<userData>/logs
function logsDir() {
  return path.join(app.getPath('userData'), 'logs')
}

// 当前日志文件名：app-YYYY-MM-DD.log
function todayFileName() {
  const d = new Date()
  return `app-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`
}

// 当前日志完整路径（目录不存在则创建；userData 获不到时退回模块目录）
function todayFilePath() {
  try {
    const dir = logsDir()
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, todayFileName())
  } catch (e) {
    return path.join(__dirname, todayFileName())
  }
}

// 原生 console，用于终端同步输出（保留被覆盖前的 stdout 能力）
const _origLog = console.log.bind(console)

// 写前检查大小，超限则把当前文件轮转为 .old 再新建
function ensureSize(file) {
  try {
    const st = fs.statSync(file)
    if (st.size >= MAX_SIZE) {
      fs.renameSync(file, file + '.old')
    }
  } catch (e) { /* 文件不存在或失败可忽略 */ }
}

// 异步批量写入，避免同步 IO 阻塞主进程
let _buf = []
let _timer = null
function logToFile(level, args) {
  const text = Array.from(args).join(' ')
  _origLog(`[${fmtTime()}] [${level}] ${text}`) // 终端可见
  _buf.push(`[${fmtTime()}] [${level}] ${text}\n`) // 落盘
  if (_timer) return
  _timer = setTimeout(() => {
    _timer = null
    const data = _buf.join('')
    _buf = []
    try {
      const file = todayFilePath()
      ensureSize(file)
      fs.appendFileSync(file, data, 'utf8')
    } catch (e) { /* 写失败不阻塞主流程 */ }
  }, 300)
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
  } catch (e) { /* 清理失败不阻塞主流程 */ }
}

// 初始化：立即接线 console；清理延迟到 app ready（确保 userData 可用）
function setupLogging() {
  console.log = (...a) => logToFile('info', a)
  console.error = (...a) => logToFile('error', a)
  console.warn = (...a) => logToFile('warn', a)

  app.whenReady().then(() => {
    cleanupOldLogs()
    // 每 24 小时检查一次，自动清理超期日志
    setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000)
  })
}

module.exports = { setupLogging, cleanupOldLogs, todayFileName }
const fs = require('fs')

/**
 * 日志轮转工具（5MB 阈值，保留 5 个旧文件）
 *
 * 设计原则:
 *  - 仅在文件超过 maxSize 时触发
 *  - .log.(N-1) → .log.N（达到 maxFiles 时删除最旧）
 *  - .log → .log.1
 *  - 当前文件被截断为 0 字节
 *  - 文件不存在时 no-op（不抛错）
 *
 * @param {string} logPath - 日志文件绝对路径
 * @param {Object} opts
 * @param {number} opts.maxSize - 阈值（字节），超过即轮转
 * @param {number} opts.maxFiles - 保留的旧文件数（不含当前文件）
 */
function rotateIfNeeded(logPath, { maxSize, maxFiles } = {}) {
  if (!fs.existsSync(logPath)) return
  const stat = fs.statSync(logPath)
  if (stat.size < maxSize) return

  // .log.(N-1) → .log.N（达到 maxFiles 时删除最旧的）
  for (let i = maxFiles - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`
    const dst = `${logPath}.${i + 1}`
    if (fs.existsSync(src)) {
      if (i === maxFiles - 1) {
        fs.unlinkSync(src) // 删除最旧的
      } else {
        fs.renameSync(src, dst)
      }
    }
  }

  // .log → .log.1
  fs.renameSync(logPath, `${logPath}.1`)
  // 新建空文件（appendFileSync 后续可正常写入）
  fs.writeFileSync(logPath, '', 'utf8')
}

module.exports = { rotateIfNeeded }

// 维护调度服务：会话清理 + 记忆衰减的统一幂等调度入口
// 修复原 setInterval(24h) 在桌面短开场景下永不触发的问题：
// - 启动后 60 秒首次检查（AppSetting 时间戳门槛保证幂等，不会每次开机都执行）
// - 长开场景每 6 小时兜底检查
// - 维护失败不更新时间戳，下次启动自动重试
const { AppSetting } = require('../db/database')
const { cleanupOldSessions } = require('../db/services/SessionCleanupService')

const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000  // 门槛：距上次执行满 24h
const STARTUP_DELAY_MS = 60 * 1000                    // 启动后延迟 60s，错开初始化高峰
const RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000          // 长开兜底检查间隔
const LAST_RUN_KEY = 'maintenance.lastRunAt'

async function getLastRunAt() {
  const row = await AppSetting.findOne({ where: { key: LAST_RUN_KEY } })
  return row && row.value ? new Date(row.value).getTime() : 0
}

async function setLastRunAt(time) {
  await AppSetting.upsert({ key: LAST_RUN_KEY, value: new Date(time).toISOString() })
}

// 执行一轮维护检查。返回 { executed, reason, cleanup?, decay? }
async function runMaintenance({ keepDays = 30 } = {}) {
  const last = await getLastRunAt()
  const now = Date.now()
  if (now - last < MAINTENANCE_INTERVAL_MS) {
    return { executed: false, reason: 'interval-not-reached' }
  }

  const cleanup = await cleanupOldSessions({ keepDays })
  const MemoryTierService = require('./MemoryTierService')
  const decay = await MemoryTierService.applyDecay()

  // 全部成功才更新时间戳；中途抛错则不更新，下次启动重试
  await setLastRunAt(now)
  return { executed: true, reason: 'ok', cleanup, decay }
}

function scheduleMaintenance() {
  const run = async () => {
    try {
      const result = await runMaintenance()
      if (result.executed) {
        console.log(`[Maintenance] 清理 ${result.cleanup.deleted} 条老消息，衰减 ${result.decay.updated} 条记忆`)
      }
    } catch (err) {
      console.error('[Maintenance] 失败（下次启动自动重试）:', err.message)
    }
  }
  const t = setTimeout(run, STARTUP_DELAY_MS)
  if (t.unref) t.unref()
  const iv = setInterval(run, RETRY_INTERVAL_MS)
  if (iv.unref) iv.unref()
}

module.exports = { runMaintenance, scheduleMaintenance, LAST_RUN_KEY }

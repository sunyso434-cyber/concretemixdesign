/**
 * 审计日志服务
 * 封装 AI 通过技能对方案/基准的写操作审计（CONFIRM/UPDATE/DELETE/CREATE）
 *
 * 使用方式（在技能 execute 内）：
 *   await context.auditLogService.write({
 *     action: 'UPDATE',
 *     targetType: 'mix_design',
 *     targetId: 42,
 *     targetName: 'C30-xxx',
 *     before: { name: 'C30-old' },
 *     after: { name: 'C30-new' }
 *   })
 */

const { AuditLog } = require('../db/database')

/**
 * v0.6.0 Task 1.12：写审计日志（支持幂等）
 *
 * 幂等键：requestId（tool_call_id）。传入时先查同一 requestId 是否已写过审计：
 * - 命中 → 直接返回旧记录，不再重复写（断点续跑重跑同一 tool call 时防重复审计）
 * - 未命中 / 未传 requestId → 正常写入
 *
 * 兼容：旧调用方不传 requestId，走原逻辑（每次都写）。
 */
async function write({
  actor = 'ai',
  action,
  targetType,
  targetId,
  targetName = null,
  before = null,
  after = null,
  userIntent = null,
  requestId = null
}) {
  if (!action || !targetType || !targetId) {
    throw new Error('AuditLogService.write: action / targetType / targetId 必填')
  }

  // 幂等查重：同 requestId 已写过 → 返回旧记录
  if (requestId) {
    const existing = await AuditLog.findOne({ where: { requestId } })
    if (existing) return existing
  }

  return AuditLog.create({
    timestamp: new Date(),
    actor,
    action,
    targetType,
    targetId,
    targetName,
    before: before == null ? null : JSON.stringify(before),
    after: after == null ? null : JSON.stringify(after),
    userIntent,
    requestId
  })
}

async function listByTarget(targetType, targetId, { limit = 50 } = {}) {
  return AuditLog.findAll({
    where: { targetType, targetId },
    order: [['timestamp', 'DESC']],
    limit
  })
}

module.exports = { write, listByTarget }

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

async function write({
  actor = 'ai',
  action,
  targetType,
  targetId,
  targetName = null,
  before = null,
  after = null,
  userIntent = null
}) {
  if (!action || !targetType || !targetId) {
    throw new Error('AuditLogService.write: action / targetType / targetId 必填')
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
    userIntent
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

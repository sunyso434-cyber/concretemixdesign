const { ChatSession, ChatHistory } = require('../database')
const { Op } = require('sequelize')

/**
 * 清理老会话
 * 保留最近 keepDays 天 + 当前活跃会话
 */
async function cleanupOldSessions({ keepDays = 30 } = {}) {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)

  const where = { lastActivity: { [Op.lt]: cutoff } }
  // If isStarred field exists, don't delete starred sessions
  try {
    const { isStarred } = ChatSession.rawAttributes
    if (isStarred) {
      where.isStarred = { [Op.ne]: true }
    }
  } catch (_) {}
  const oldSessions = await ChatSession.findAll({
    where,
    attributes: ['sessionId']
  })
  const oldIds = oldSessions.map(s => s.sessionId)
  if (oldIds.length === 0) return { deleted: 0 }

  const histDeleted = await ChatHistory.destroy({
    where: { sessionId: { [Op.in]: oldIds } }
  })
  await ChatSession.destroy({
    where: { sessionId: { [Op.in]: oldIds } }
  })

  return { deleted: histDeleted }
}

module.exports = { cleanupOldSessions }

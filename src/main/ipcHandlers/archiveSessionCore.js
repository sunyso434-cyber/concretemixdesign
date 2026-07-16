// 会话归档核心：批量置 ChatSession.archived。
// 归档（archived=true）时跳过正在运行的会话；恢复（archived=false）不受限。
async function applyArchive({ sessionIds, archived, isRunning, ChatSession }) {
  const ids = Array.isArray(sessionIds) ? sessionIds.filter(Boolean) : []
  const skipped = []
  const toUpdate = []
  for (const sid of ids) {
    if (archived && isRunning(sid)) { skipped.push(sid); continue }
    toUpdate.push(sid)
  }
  let updated = 0
  if (toUpdate.length > 0) {
    const [count] = await ChatSession.update(
      { archived: !!archived },
      { where: { sessionId: toUpdate } }
    )
    updated = count
  }
  return { updated, skipped }
}

module.exports = { applyArchive }

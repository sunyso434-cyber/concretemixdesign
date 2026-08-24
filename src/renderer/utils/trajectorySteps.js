/**
 * v0.9.x 轨迹功能（阶段 1）：会话消息 → 轨迹步骤聚合
 *
 * 数据源：assistant 消息的 timeline（新消息自带；旧会话加载时已由
 * rebuildTimelines 重建），每条 timeline 项 = 一个轨迹步骤。
 * 回合 = 一条含 timeline 的 assistant 消息（近似 DSH 的 turn 概念）。
 *
 * 步骤结构：
 * {
 *   key, turn, msgId, msgContent, msgStats,
 *   type: 'reasoning' | 'tool', toolName, args, result, content, status
 * }
 */

/**
 * 把会话消息聚合为轨迹步骤列表（按消息顺序、timeline 顺序）
 * @param {Array} messages - 会话消息（含 timeline 的 assistant 消息）
 * @returns {Array} 步骤数组
 */
export function buildTrajectorySteps(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return []

  const steps = []
  let turn = 0
  for (const m of messages) {
    if (!m || m.role !== 'assistant') continue
    const timeline = Array.isArray(m.timeline) ? m.timeline : []
    if (timeline.length === 0) continue
    turn += 1

    timeline.forEach((item, ti) => {
      if (!item || typeof item !== 'object') return
      // v0.9.x：notice（模型切换留痕等系统提示）不进轨迹账本——轨迹只记思考+工具，
      // 切换提示已在聊天时间线中展示
      if (item.type === 'notice') return
      steps.push({
        key: `${m.id || 'm'}-${turn}-${ti}`,
        turn,
        msgId: m.id || null,
        msgContent: m.content || '',
        msgStats: m.stats || null,
        type: item.type === 'reasoning' ? 'reasoning' : 'tool',
        toolName: item.type === 'tool' ? item.toolName : undefined,
        args: item.type === 'tool' ? item.args : undefined,
        result: item.type === 'tool' ? item.result : undefined,
        content: item.type === 'reasoning' ? item.content : undefined,
        status: item.status || 'done',
        // v0.9.x 轨迹阶段2：每步精确耗时（TOOL_DONE/ERROR 埋点；旧数据为 null）
        elapsedMs: typeof item.elapsedMs === 'number' ? item.elapsedMs : null,
        // 工具调用 id（跨视图跳转定位用）
        toolCallId: item.toolCallId || undefined,
      })
    })
  }
  return steps
}

/** 步骤的全文检索文本（搜索用；结果转人话摘要减少噪音） */
export function trajectoryStepSearchText(step) {
  const parts = []
  if (step.type === 'tool') {
    parts.push(step.toolName || '')
    try {
      parts.push(JSON.stringify(step.args || {}))
    } catch (_) {}
    if (step.result && typeof step.result === 'object') {
      // 取关键字段：name/count/message/error/type/data.title 等
      const pick = ['name', 'count', 'message', 'error', 'type', 'title', 'filename', 'path']
      for (const k of pick) {
        const v = step.result[k]
        if (v !== undefined && v !== null) {
          parts.push(typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v))
        }
      }
    } else if (typeof step.result === 'string') {
      parts.push(step.result.slice(0, 200))
    }
  } else {
    parts.push(step.content || '')
  }
  return parts.join(' ').toLowerCase()
}

/**
 * 按查询与过滤器过滤步骤
 * @param {Array} steps - buildTrajectorySteps 结果
 * @param {string} query - 搜索词（空格分隔，全部命中才保留）
 * @param {string} filter - 'all' | 'tool' | 'reasoning' | 'failed'
 */
export function filterTrajectorySteps(steps, query, filter) {
  let out = steps
  if (filter === 'tool') out = out.filter(s => s.type === 'tool')
  else if (filter === 'reasoning') out = out.filter(s => s.type === 'reasoning')
  else if (filter === 'failed') out = out.filter(s => s.status === 'error')

  const q = (query || '').trim().toLowerCase()
  if (!q) return out
  const terms = q.split(/\s+/)
  return out.filter(s => {
    const text = trajectoryStepSearchText(s)
    return terms.every(t => text.includes(t))
  })
}

/** 步骤状态中文标签 */
export function trajectoryStatusLabel(status) {
  if (status === 'running') return '执行中'
  if (status === 'error') return '失败'
  return '完成'
}

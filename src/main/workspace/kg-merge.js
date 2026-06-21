// Task 5.3 (P5): KG 合并 + 冲突检测 + compact + 大小守卫
// - mergeInto(oldGraph, newTriples, source): 合并新三元组到全局图谱
//   - 冲突 1（conflicting_relation）: 相同 (s, o) 但不同 predicate
//   - 冲突 2（type_mismatch）: 同 id entity 但 type 不同
//   - 同 (s, p, o) 重复：合并 evidence（追加 source）+ 取最高 confidence
// - compactGraph(graph): 低置信度 / 三元组去重 / 孤立实体清理
//   - 不可变：返回新图，不修改入参
//   - 注：实体合并（同名+同类型）由 KGExtractor.compact 承担，避免命名冲突
// - checkSize(graph): 50MB JSON 抛 INDEX_TOO_LARGE；5 万 relations 抛；1 万 relations warning
const { WorkspaceError } = require('./WorkspaceError')

// 合并阈值
const RELATION_MAX_HARD = 50000      // 强制上限：超过抛错
const RELATION_MAX_WARN = 10000      // 警告阈值：超过建议 compact
const JSON_SIZE_MAX = 50 * 1024 * 1024  // 50MB
const MIN_CONFIDENCE = 0.3           // compact 时剔除阈值

/**
 * 把新提取的三元组合并到全局图谱。
 * @param {object} oldGraph - 旧 graph.json
 * @param {object} newTriples - { entities, relations }，entities 必须含 id
 * @param {string} source - 来源文件名（用于 evidence 标注 + 冲突 occurrences）
 * @returns {{ graph: object, conflicts: object[] }}
 */
function mergeInto(oldGraph, newTriples, source) {
  // 深拷贝（不依赖 structuredClone，Node 16 友好）
  const graph = JSON.parse(JSON.stringify(oldGraph || {
    entities: {}, relations: [], conflicts: [], mergeVersion: 0
  }))
  graph.entities = graph.entities || {}
  graph.relations = graph.relations || []
  graph.conflicts = graph.conflicts || []
  const conflicts = []

  // 1. 合并 entities
  for (const e of (newTriples.entities || [])) {
    if (!e || !e.id) continue
    if (graph.entities[e.id]) {
      const existing = graph.entities[e.id]
      // type 一致性检查
      if (existing.type && e.type && existing.type !== e.type) {
        conflicts.push({
          type: 'type_mismatch',
          description: `${e.name} 类型冲突：${existing.type} vs ${e.type}`,
          occurrences: [
            { source: existing.source || 'unknown', value: existing.type },
            { source, value: e.type }
          ],
          detectedAt: new Date().toISOString()
        })
      }
      // aliases 合并（去重）
      const aliasSet = new Set([...(existing.aliases || []), ...(e.aliases || [])])
      existing.aliases = [...aliasSet]
      // 缺字段补齐
      if (!existing.source && e.source) existing.source = e.source
    } else {
      graph.entities[e.id] = { ...e }
    }
  }

  // 2. 合并 relations + 冲突检测
  for (const r of (newTriples.relations || [])) {
    if (!r || !r.subjectId || !r.objectId) continue
    const existing = graph.relations.find(x =>
      x.subjectId === r.subjectId && x.objectId === r.objectId
    )
    if (existing) {
      if (existing.predicate === r.predicate) {
        // 同一关系：合并 evidence + 取最高 confidence
        if (typeof r.confidence === 'number' && r.confidence > (existing.confidence || 0)) {
          existing.confidence = r.confidence
        }
        if (r.evidence && !(existing.evidence || '').includes(r.evidence)) {
          existing.evidence = `${existing.evidence || ''} | ${source}: ${r.evidence}`
        }
      } else {
        // 不同 predicate：标冲突 + 保留新关系
        conflicts.push({
          type: 'conflicting_relation',
          description: `${r.subjectId} ${r.predicate} ${r.objectId} vs ${existing.predicate}`,
          occurrences: [
            { source: existing.source || 'unknown', value: existing.predicate },
            { source, value: r.predicate }
          ],
          detectedAt: new Date().toISOString()
        })
        graph.relations.push({ ...r })
      }
    } else {
      graph.relations.push({ ...r })
    }
  }

  // 3. 写冲突 + 元数据
  graph.conflicts = graph.conflicts.concat(conflicts)
  graph.mergeVersion = (graph.mergeVersion || 0) + 1
  graph.updatedAt = new Date().toISOString()
  graph.lastMergeAt = new Date().toISOString()

  return { graph, conflicts }
}

/**
 * 清理图谱：低置信度 / 三元组去重 / 孤立实体。
 * 不可变：返回新图，不修改入参。
 * @param {object} graph
 * @returns {object} 新图
 */
function compactGraph(graph) {
  const g = JSON.parse(JSON.stringify(graph || { entities: {}, relations: [] }))
  g.entities = g.entities || {}
  g.relations = g.relations || []
  g.conflicts = g.conflicts || []

  // 1. 去除低置信度
  const filtered = g.relations.filter(r => (r.confidence || 0) >= MIN_CONFIDENCE)

  // 2. 去重相同三元组 (subject+predicate+object)
  const seen = new Map()
  for (const r of filtered) {
    const key = `${r.subjectId}|${r.predicate}|${r.objectId}`
    if (!seen.has(key)) {
      seen.set(key, { ...r })
      continue
    }
    const exist = seen.get(key)
    if (typeof r.confidence === 'number' && r.confidence > (exist.confidence || 0)) {
      exist.confidence = r.confidence
    }
    if (r.evidence && !(exist.evidence || '').includes(r.evidence)) {
      exist.evidence = `${exist.evidence || ''} | ${r.source || 'unknown'}: ${r.evidence}`
    }
  }
  const deduped = [...seen.values()]

  // 3. 找出仍被引用的 entity id
  const referenced = new Set()
  for (const r of deduped) {
    referenced.add(r.subjectId)
    referenced.add(r.objectId)
  }
  const compactedEntities = {}
  for (const [id, e] of Object.entries(g.entities)) {
    if (referenced.has(id)) compactedEntities[id] = e
  }

  g.entities = compactedEntities
  g.relations = deduped
  g.mergeVersion = (g.mergeVersion || 0) + 1
  g.updatedAt = new Date().toISOString()
  g.lastCompactAt = new Date().toISOString()
  return g
}

/**
 * 大小守卫：在 saveGraph 前调用。
 * - 1万 relations 触发 warning（不抛）
 * - 5万 relations 抛 INDEX_TOO_LARGE
 * - JSON 序列化 > 50MB 抛 INDEX_TOO_LARGE
 * @param {object} graph
 * @returns {{ warnings: string[] }}
 */
function checkSize(graph) {
  const warnings = []
  const relCount = (graph && graph.relations || []).length
  if (relCount > RELATION_MAX_HARD) {
    throw new WorkspaceError(
      'INDEX_TOO_LARGE',
      `relations 超过 ${RELATION_MAX_HARD} 强制限制：${relCount}`,
      false
    )
  }
  if (relCount > RELATION_MAX_WARN) {
    warnings.push(`relations 超过 1 万：${relCount}（建议运行 compact）`)
  }
  // 序列化大小检查
  const jsonStr = JSON.stringify(graph || {})
  if (jsonStr.length > JSON_SIZE_MAX) {
    throw new WorkspaceError(
      'INDEX_TOO_LARGE',
      `graph.json 超过 50MB（实际 ${(jsonStr.length / 1024 / 1024).toFixed(1)}MB）`,
      false
    )
  }
  return { warnings }
}

module.exports = { mergeInto, compactGraph, checkSize }

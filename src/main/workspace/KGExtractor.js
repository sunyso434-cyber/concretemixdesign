const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { WorkspaceError } = require('./WorkspaceError')

// v1.5 原始设计：sha1 完整 16 位（hex），避免碰撞
const sha1Id = (name, type) =>
  crypto.createHash('sha1').update(`${name}|${type}`).digest('hex').substring(0, 16)

// evidence 最短长度门槛（Crit-3：避免太短的 evidence 污染图）
const MIN_EVIDENCE_LEN = 30

class KGExtractor {
  constructor({ llmClient, schema } = {}) {
    this.llmClient = llmClient
    this.schema = schema
  }

  /**
   * 从文本提取实体+关系。LLM 失败或输出无内容 → quality: low（不抛）。
   * @param {string} content
   * @param {string} sourceFile
   * @returns {Promise<{entities: object[], relations: object[], quality: 'high'|'low', droppedRelations?: object[], error?: WorkspaceError}>}
   */
  async extract(content, sourceFile) {
    if (!this.llmClient) {
      return {
        entities: [], relations: [], quality: 'low',
        error: new WorkspaceError('KG_EXTRACT_FAIL', 'no LLM client', true)
      }
    }
    try {
      // 1. 构造 prompt
      const prompt = this._buildPrompt(content)
      // 2. 调 LLM
      const raw = await this.llmClient.invoke(prompt)
      // 3. 解析 JSON
      const parsed = JSON.parse(raw)
      // 4. 先建索引：name → entity（Crit-5：relation 的 type 从这里反查）
      const nameToEntity = {}
      for (const e of (parsed.entities || [])) {
        if (e.name && e.type) nameToEntity[e.name] = e
      }
      // 5. 补 id + source
      const entities = (parsed.entities || []).map(e => ({
        ...e,
        id: sha1Id(e.name, e.type),
        aliases: e.aliases || [],
        properties: e.properties || {},
        source: sourceFile
      }))
      // 6. 处理 relations
      const relations = []
      const droppedRelations = []
      for (const r of (parsed.relations || [])) {
        const subjEntity = nameToEntity[r.subject]
        const objEntity = nameToEntity[r.object]
        if (!subjEntity || !objEntity) {
          // entity 字典里查不到 → 跳过（避免破图）
          droppedRelations.push({ relation: r, reason: 'entity-not-found' })
          continue
        }
        const evidence = r.evidence || ''
        if (evidence.length < MIN_EVIDENCE_LEN) {
          droppedRelations.push({ relation: r, reason: 'evidence-too-short' })
          continue
        }
        relations.push({
          subjectId: sha1Id(subjEntity.name, subjEntity.type),
          predicate: r.predicate,
          objectId: sha1Id(objEntity.name, objEntity.type),
          evidence,
          confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
          source: sourceFile
        })
      }
      // 7. 质量降级
      if (entities.length === 0 && relations.length === 0) {
        return {
          entities: [], relations: [], quality: 'low',
          error: new WorkspaceError('KG_EXTRACT_FAIL', 'all relations dropped', true),
          droppedRelations
        }
      }
      return { entities, relations, quality: 'high', droppedRelations }
    } catch (err) {
      return {
        entities: [], relations: [], quality: 'low',
        error: new WorkspaceError('KG_EXTRACT_FAIL', err.message, true, err)
      }
    }
  }

  _buildPrompt(content) {
    return `从以下混凝土领域文本中提取实体和关系，输出 JSON：

文本：${content}

Schema：
- entityTypes: ${this.schema?.entityTypes?.join(', ') || ''}
- relationTypes: ${this.schema?.relationTypes?.join(', ') || ''}

示例：${JSON.stringify(this.schema?.examples?.[0] || {})}

输出格式：
{"entities": [{"name": "X", "type": "Y"}], "relations": [{"subject": "X", "predicate": "increases", "object": "Y", "evidence": "≥30 字原文片段", "confidence": 0.9}]}`
  }

  /**
   * 加载 graph.json。不存在 → 返回空图。损坏 → 抛 KG_GRAPH_CORRUPT。
   */
  async loadGraph(workspacePath) {
    const fp = path.join(workspacePath, 'wiki', 'kg', 'graph.json')
    try {
      const raw = await fs.readFile(fp, 'utf-8')
      return JSON.parse(raw)
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {
          version: 1,
          workspacePath: workspacePath.replace(/\\/g, '/'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          entities: {},
          relations: [],
          conflicts: [],
          lastMergeAt: new Date().toISOString(),
          mergeVersion: 0
        }
      }
      throw new WorkspaceError('KG_GRAPH_CORRUPT', `graph.json 损坏: ${err.message}`, false, err)
    }
  }

  /**
   * 原子写 graph.json：先写 .tmp.<ts>，再 rename。
   */
  async saveGraph(workspacePath, graph) {
    const dir = path.join(workspacePath, 'wiki', 'kg')
    await fs.mkdir(dir, { recursive: true })
    const fp = path.join(dir, 'graph.json')
    const tmpFp = `${fp}.tmp.${Date.now()}`
    await fs.writeFile(tmpFp, JSON.stringify(graph, null, 2), 'utf-8')
    await fs.rename(tmpFp, fp)
  }

  /**
   * 合并重复实体（同名+同类型），返回新图（不可变）。
   * - 第一个出现的 entity 保留为 canonical
   * - 后续同名同类型合并到 canonical：aliases 合并
   * - relations 的 subjectId/objectId 指向 canonical id
   * - mergeVersion +1
   */
  compact(graph) {
    const entityById = { ...(graph.entities || {}) }
    // canonicalId: name|type → id
    const canonical = new Map()
    const idRemap = {} // oldId → canonicalId
    const newEntities = {}

    for (const [id, e] of Object.entries(entityById)) {
      const key = `${e.name}|${e.type}`
      if (!canonical.has(key)) {
        // 第一次见：作为 canonical
        canonical.set(key, id)
        newEntities[id] = { ...e, aliases: [...(e.aliases || [])] }
        idRemap[id] = id
      } else {
        // 重复：合并到 canonical
        const canonId = canonical.get(key)
        const canon = newEntities[canonId]
        const mergedAliases = new Set([...(canon.aliases || []), ...(e.aliases || [])])
        newEntities[canonId] = { ...canon, aliases: [...mergedAliases] }
        idRemap[id] = canonId
      }
    }

    // relations 重新映射
    const newRelations = (graph.relations || []).map(r => ({
      ...r,
      subjectId: idRemap[r.subjectId] || r.subjectId,
      objectId: idRemap[r.objectId] || r.objectId
    }))

    return {
      ...graph,
      entities: newEntities,
      relations: newRelations,
      mergeVersion: (graph.mergeVersion || 0) + 1,
      updatedAt: new Date().toISOString()
    }
  }
}

module.exports = { KGExtractor }

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
    // 懒加载：优先用 this.llmClient，没有就回退到 global.deepseekService
    const llmClient = this.llmClient || (typeof global !== 'undefined' && global.deepseekService) || null
    if (!llmClient) {
      console.warn('[KGExtractor] llmClient 为空，跳过 KG 提取（deepseekService 尚未初始化？）')
      return {
        entities: [], relations: [], quality: 'low',
        error: new WorkspaceError('KG_EXTRACT_FAIL', 'no LLM client', true)
      }
    }
    try {
      // 1. 构造 prompt
      const prompt = this._buildPrompt(content)
      // 2. 调 LLM（llmClient 已在 extract 入口懒加载）
      const raw = await llmClient.invoke(prompt)
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
        console.warn('[KGExtractor] LLM 返回了合法 JSON 但 entities 和 relations 均为空')
        return {
          entities: [], relations: [], quality: 'low',
          error: new WorkspaceError('KG_EXTRACT_FAIL', 'all relations dropped', true),
          droppedRelations
        }
      }
      return { entities, relations, quality: 'high', droppedRelations }
    } catch (err) {
      console.warn('[KGExtractor] LLM 调用或解析异常:', err.message)
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
   * Task 5.3 (P5)：写盘前调 checkSize，超过 50MB / 5万 relations 抛 INDEX_TOO_LARGE。
   * 1万 relations 触发 warning 写入 graph._sizeWarnings（消费方读后自处理）。
   */
  async saveGraph(workspacePath, graph) {
    const { checkSize } = require('./kg-merge')
    const sizeCheck = checkSize(graph)
    if (sizeCheck.warnings.length > 0) {
      // 把 warning 挂到 graph 上（不破坏 schema，存 _ 前缀私有字段）
      graph._sizeWarnings = [...(graph._sizeWarnings || []), ...sizeCheck.warnings]
    }
    const dir = path.join(workspacePath, 'wiki', 'kg')
    await fs.mkdir(dir, { recursive: true })
    const fp = path.join(dir, 'graph.json')
    const tmpFp = `${fp}.tmp.${Date.now()}`
    await fs.writeFile(tmpFp, JSON.stringify(graph, null, 2), 'utf-8')
    await fs.rename(tmpFp, fp)
  }

  /**
   * BM25 检索知识图谱，返回完整三元组列表（spec §4.14）。
   * - 不调 LLM（纯本地 BM25）
   * - 索引：entity name + aliases + relation evidence
   * - 展开：entity 命中 → 找相关 relations；relation 命中 → 直接返回三元组
   * - 去重：按 (subjectId, predicate, objectId)
   *
   * @param {string} query - 用户查询关键词
   * @param {number} [topK=10]
   * @param {string} [workspacePath=null] - 不传则从 instance 推断（v1.5.1 简化版不依赖单例）
   * @returns {Promise<Array<{subject: {name, type, id}, predicate: string, object: {name, type, id}, evidence: string, confidence: number, source: string, score: number}>>}
   */
  async searchGraph(query, topK = 10, workspacePath = null) {
    if (!query || !query.trim()) return []

    // v1.5.1 简化版：要求传 workspacePath（不依赖 WorkspaceManager 单例）
    if (!workspacePath) {
      throw new WorkspaceError('PATH_INVALID', 'searchGraph 需要 workspacePath 参数（P5 阶段请传当前工作区路径）', false)
    }

    const graph = await this.loadGraph(workspacePath)
    if (Object.keys(graph.entities).length === 0) return []

    // 1. 构造可检索语料
    const corpus = []
    const docIndex = []  // path → { kind, key }
    for (const e of Object.values(graph.entities)) {
      const aliasesText = (e.aliases || []).join(' ')
      corpus.push(`${e.name} ${aliasesText}`)
      docIndex.push({ kind: 'entity', key: e.id })
    }
    for (const r of graph.relations) {
      corpus.push(r.evidence || '')
      docIndex.push({ kind: 'relation', key: r })
    }

    // 2. BM25 检索（双倍 topK 以便展开后有足够结果）
    const { buildBM25, queryBM25 } = require('./bm25')
    const bm25 = buildBM25(corpus.map((content, i) => ({ path: String(i), content })))
    const hits = queryBM25(bm25, query, topK * 2)

    if (hits.length === 0) return []

    // 3. 扩展到完整三元组
    const results = []
    for (const hit of hits) {
      const idx = parseInt(hit.path, 10)
      const ref = docIndex[idx]
      if (!ref) continue

      if (ref.kind === 'entity') {
        // entity 命中：找出所有相关 relations（按主语/宾语）
        const entityId = ref.key
        const relatedRels = graph.relations.filter(r =>
          r.subjectId === entityId || r.objectId === entityId
        ).slice(0, 3)
        for (const r of relatedRels) {
          const s = graph.entities[r.subjectId]
          const o = graph.entities[r.objectId]
          if (!s || !o) continue
          results.push({
            subject: { name: s.name, type: s.type, id: s.id },
            predicate: r.predicate,
            object: { name: o.name, type: o.type, id: o.id },
            evidence: r.evidence, confidence: r.confidence, source: r.source,
            score: hit.score
          })
        }
      } else {
        // relation 命中：直接返回三元组
        const r = ref.key
        const s = graph.entities[r.subjectId]
        const o = graph.entities[r.objectId]
        if (!s || !o) continue
        results.push({
          subject: { name: s.name, type: s.type, id: s.id },
          predicate: r.predicate,
          object: { name: o.name, type: o.type, id: o.id },
          evidence: r.evidence, confidence: r.confidence, source: r.source,
          score: hit.score
        })
      }
    }

    // 4. 去重 + 排序 + topK
    const seen = new Set()
    const deduped = []
    for (const r of results) {
      const key = `${r.subject.id}-${r.predicate}-${r.object.id}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(r)
    }
    return deduped.sort((a, b) => b.score - a.score).slice(0, topK)
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

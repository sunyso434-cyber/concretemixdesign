/**
 * 学习服务（v2 改造）
 * - 不再自动写入 UserPreference 表（脏数据）
 * - 改为只观察 + 调用 PatternDetector 生成建议
 * - 建议由老板在 UI 采纳后才会落到 agent.md
 */

// 替换 require:
const { getSuggestionStore } = require('../agent/preferences')
const PreferenceSuggestion = require('../db/database').PreferenceSuggestion
const { Op } = require('sequelize')
const { AgentMdParser } = require('../agent/agentMd/AgentMdParser')

const eventBus = require('../agent/EventBus')
const { PreferencePatternDetector } = require('../agent/preferences')
const MaterialService = require('./MaterialService')
const { getInstance: getAgentMdService } = require('../agent/agentMd')

class LearningService {
  constructor() {
    this._initialized = false
    // 内存观察日志（按 session 维度独立存放）
    this._observationLog = []
  }

  init() {
    if (this._initialized) return
    eventBus.on('tool:executed', this._onToolExecuted.bind(this))
    eventBus.on('user:correction', this._onUserCorrection.bind(this))
    this._initialized = true
    console.log('[LearningService] 学习服务已初始化（v2 模式：仅观察 + 生成建议）')
  }

  async _onToolExecuted({ skillName, args, result }) {
    try {
      if (!result || result.success === false) return
      if (skillName !== 'calculate_mix_design') return

      // 查询材料 ID → name 映射
      const materialNames = await this._resolveMaterialNames(args)

      // 加载当前 agent.md 偏好（v2 adapter：从 sections 读取）
      const agentMd = getAgentMdService().getCached()
      const sections = (agentMd.parsed && agentMd.parsed.sections) || []
      const bizSection = sections.find(s => s.title === '业务规则')
      const subs = (bizSection?.subSections) || []
      const prefs = {
        materials: (subs.find(s => s.title === '材料')?.items || []).map(v => ({
          category: '', dimension: '', value: v
        })),
        method: null
      }
      const blacklist = []

      // 调用 PatternDetector
      const detector = new PreferencePatternDetector({
        existingMaterials: prefs.materials,
        existingMethod: prefs.method,
        existingBlacklist: blacklist,
        observationLog: this._observationLog
      })
      detector.observe(args, { materialNames })
      const suggestions = detector.flushSuggestions()

      // 写入 suggestionStore（会广播 IPC 事件）
      const store = getSuggestionStore()
      for (const s of suggestions) {
        store.add(s)
      }
    } catch (error) {
      console.error('[LearningService] 学习失败:', error.message)
    }
  }

  async _resolveMaterialNames(args) {
    const ids = [
      args.cementId,
      args.flyAshId,
      args.slagId,
      args.lithiumSlagId,
      args.compositePowderId,
      args.superplasticizerId
    ].filter(Boolean)
    const map = {}
    for (const id of ids) {
      try {
        const m = await MaterialService.getMaterialById(id)
        if (m && m.name) map[id] = m.name
      } catch (_) {
        // 单条失败不影响其他
      }
    }
    return map
  }

  async _onUserCorrection(correction) {
    // 修正记录仍保留（spec §10 第 5 项未明确删）
    try {
      const { CorrectionRule } = require('../db/database')
      await CorrectionRule.create({
        context: correction.context || {},
        originalSuggestion: correction.original,
        userCorrection: correction.corrected,
        toolName: correction.toolName,
        usageCount: 0
      })
    } catch (error) {
      console.error('[LearningService] 保存修正记录失败:', error.message)
    }
  }

  async saveCorrection(correction) {
    await this._onUserCorrection(correction)
  }

  /**
   * 记录工具失败教训（对标 AutoGPT task_outcome → memory）
   */
  async recordFailure({ skillName, args, error }) {
    const { CorrectionRule } = require('../db/database')
    const context = { skillName, args: JSON.stringify(args) }
    await CorrectionRule.create({
      context: JSON.stringify(context),
      originalSuggestion: '',
      userCorrection: `[自动记录] ${error}`,
      toolName: skillName,
      usageCount: 0
    })
  }

  /**
   * 找同类失败教训（BM25 检索）
   */
  async findFailurePatterns(skillName, query = '') {
    const { CorrectionRule } = require('../db/database')
    const rules = await CorrectionRule.findAll({
      where: { toolName: skillName },
      order: [['updatedAt', 'DESC']],
      limit: 20
    })
    if (rules.length === 0 || !query) return rules.slice(0, 3)

    const { buildBM25, queryBM25 } = require('../workspace/bm25')
    const corpus = rules.map(r => ({ path: String(r.id), content: r.context + ' ' + r.userCorrection }))
    const index = buildBM25(corpus)
    return queryBM25(index, query, 3).map(hit => {
      const rule = rules.find(r => String(r.id) === hit.path)
      return rule ? { context: rule.context, userCorrection: rule.userCorrection, score: hit.score } : null
    }).filter(Boolean)
  }

  /**
   * 获取当前建议列表（按 confidence 倒序）
   */
  async getSuggestions() {
    // v2: 从 SQLite 读 + 按 confidence 倒序
    return await PreferenceSuggestion.findAll({
      where: { status: 'pending' },
      order: [['confidence', 'DESC']]
    })
  }

  /**
   * 接受建议（支持单 id 或 id 数组）
   */
  async acceptSuggestion(idOrIds) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds]
    await PreferenceSuggestion.update(
      { status: 'accepted' },
      { where: { id: ids } }
    )
    // [借鉴 Mneme] 接受时 +0.05 recallCount + decayScore 重置
    for (const id of ids) {
      const m = await PreferenceSuggestion.findByPk(id)
      if (m) {
        await m.update({
          recallCount: m.recallCount + 1,
          decayScore: Math.min(1.0, m.decayScore + 0.05),
          lastRecalledAt: new Date()
        })
      }
    }
    return ids.length
  }

  /**
   * 自动接受高置信度建议（对标 TencentDB L3 自动沉淀）
   * - threshold >= threshold 的 pending 建议标 accepted
   * - material 类型建议自动回写到 agent.md 的 业务规则 > 材料 段
   * @returns {Promise<{accepted: number}>}
   */
  async autoAcceptHighConfidence({ threshold = 0.95 } = {}) {
    const candidates = await PreferenceSuggestion.findAll({
      where: { status: 'pending', confidence: { [Op.gte]: threshold } }
    })

    let accepted = 0
    for (const c of candidates) {
      await c.update({ status: 'accepted', decayScore: 1.0, recallCount: c.recallCount + 1 })

      // material 类型回写 agent.md
      if (c.type === 'material' && c.payload?.value) {
        const agentMd = getAgentMdService()
        const cached = agentMd.getCached()
        const sections = cached.parsed.sections || []
        let bizSection = sections.find(s => s.title === '业务规则')
        if (!bizSection) {
          bizSection = { title: '业务规则', subSections: [] }
          sections.push(bizSection)
        }
        let matSection = bizSection.subSections.find(s => s.title === '材料')
        if (!matSection) {
          matSection = { title: '材料', items: [], rawText: '' }
          bizSection.subSections.push(matSection)
        }
        if (!matSection.items.includes(c.payload.value)) {
          matSection.items.push(c.payload.value)
          await agentMd.saveToFile(AgentMdParser.formatToMarkdown(cached.parsed))
        }
      }
      accepted++
    }
    return { accepted }
  }
}

module.exports = new LearningService()

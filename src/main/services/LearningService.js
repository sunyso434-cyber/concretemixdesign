/**
 * 学习服务（v2 改造）
 * - 不再自动写入 UserPreference 表（脏数据）
 * - 改为只观察 + 调用 PatternDetector 生成建议
 * - 建议由老板在 UI 采纳后才会落到 agent.md
 */

const eventBus = require('../agent/EventBus')
const { getSuggestionStore, PreferencePatternDetector } = require('../agent/preferences')
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
   * 获取当前建议列表（按 confidence 倒序）
   */
  getSuggestions() {
    const store = getSuggestionStore()
    if (!store || !store._items) return []
    return [...store._items].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
  }

  /**
   * 接受一条建议（标记 accepted）
   */
  acceptSuggestion(id) {
    const store = getSuggestionStore()
    if (!store) return null
    const item = (store._items || []).find(i => i.id === id)
    if (!item) return null
    item.status = 'accepted'
    return item
  }
}

module.exports = new LearningService()

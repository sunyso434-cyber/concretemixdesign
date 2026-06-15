const { randomUUID } = require('crypto')

/**
 * PreferencePatternDetector - 纯函数式偏好模式识别器
 * 输入：观察数据 + 现有偏好 + 黑名单 + 历史观察日志
 * 输出：待生成的偏好建议数组
 *
 * materialNames 数据来源说明：
 * observe(args, { materialNames }) 第二个参数的 materialNames 是 { [id]: name } 形态的 ID→名称映射。
 * 1. 首选来源：calculate_mix_design 工具返回结果 result.data.materialDetails
 *    （src/main/skills/mix-design.js 第 180 行附近构建），LearningService 在阶段 A
 *    改造后从工具返回结果取 materialDetails，转成 { [id]: name } 映射。
 * 2. 降级来源：MaterialService.getById(id) 按 ID 单条查表（已有逻辑）。
 * 测试中 materialNames: { 1: '拉法基', 2: '粉煤灰' } 是模拟这个映射，不是硬编码业务数据。
 */
class PreferencePatternDetector {
  /**
   * @param {Object} opts
   * @param {Array} opts.existingMaterials - agent.md.professionalPrefs.materials
   * @param {string|null} opts.existingMethod - agent.md.professionalPrefs.method
   * @param {string[]} opts.existingBlacklist - agent.md.ignoredSuggestionTypes
   * @param {Array} opts.observationLog - 内存中的历史观察
   */
  constructor({ existingMaterials, existingMethod, existingBlacklist, observationLog }) {
    this.existingMaterials = existingMaterials || []
    this.existingMethod = existingMethod || null
    this.existingBlacklist = new Set(existingBlacklist || [])
    this.observationLog = observationLog || []
  }

  /**
   * 添加一次观察
   * @param {Object} args - calculate_mix_design 工具参数
   * @param {Object} ctx - { materialNames: { [id]: name } }
   */
  observe(args, ctx) {
    const { materialNames = {} } = ctx
    this.observationLog.push({
      timestamp: Date.now(),
      args,
      materialNames
    })
  }

  /**
   * 标记某类型建议被采纳/黑名单/忽略 → 从观察日志移除该类型对应的所有 (category, dimension, metric) 组合
   * @param {string[]} types - ['material_vendor', 'method_preference', ...]
   */
  markAccepted(types) {
    const typeSet = new Set(types)
    // 简化：markAccepted 时只清空匹配类型的组合
    // （caller 需要传入 types；这里通过 _classifyObservation 复用）
    this.observationLog = this.observationLog.filter(obs => {
      const items = this._extractObservableItems(obs.args, obs.materialNames)
      return !items.some(it => typeSet.has(this._suggestionTypeFor(it)))
    })
  }

  /**
   * 提取并评估所有观察，生成建议（同时清空建议项对应的观察）
   * @returns {Array<Suggestion>}
   */
  flushSuggestions() {
    const grouped = new Map() // key → count
    for (const obs of this.observationLog) {
      const items = this._extractObservableItems(obs.args, obs.materialNames)
      for (const item of items) {
        const key = this._itemKey(item)
        grouped.set(key, (grouped.get(key) || 0) + 1)
      }
    }

    const suggestions = []
    const consumedKeys = new Set()
    const total = this.observationLog.length

    for (const [key, count] of grouped.entries()) {
      if (total < 5) continue
      if (count / total < 0.8) continue
      consumedKeys.add(key)
      const item = this._itemFromKey(key)
      const type = this._suggestionTypeFor(item)
      if (this.existingBlacklist.has(type)) continue
      if (this._isAlreadyInMaterials(item)) continue

      suggestions.push({
        id: randomUUID(),
        type,
        title: `💡 发现您${item.category}偏好 ${item.value || item.values || item.method}`,
        proposedYaml: item,
        reason: `最近 ${total} 次任务中 ${count} 次符合此模式`,
        confidence: count / total,
        createdAt: new Date(),
        status: 'pending'
      })
    }

    // 部分清空：只清空已建议的组合
    this.observationLog = this.observationLog.filter(obs => {
      const items = this._extractObservableItems(obs.args, obs.materialNames)
      return !items.some(it => consumedKeys.has(this._itemKey(it)))
    })

    return suggestions
  }

  // ===== 内部 helpers =====

  _extractObservableItems(args, materialNames) {
    const items = []
    if (args.cementId && materialNames[args.cementId]) {
      items.push({ category: '水泥', dimension: '厂家', value: materialNames[args.cementId] })
    }
    if (args.flyAshId && materialNames[args.flyAshId]) {
      items.push({ category: '掺合料', dimension: '种类', value: materialNames[args.flyAshId] })
    }
    if (args.slagId && materialNames[args.slagId]) {
      items.push({ category: '掺合料', dimension: '种类', value: materialNames[args.slagId] })
    }
    if (args.lithiumSlagId && materialNames[args.lithiumSlagId]) {
      items.push({ category: '掺合料', dimension: '种类', value: materialNames[args.lithiumSlagId] })
    }
    if (args.compositePowderId && materialNames[args.compositePowderId]) {
      items.push({ category: '掺合料', dimension: '种类', value: materialNames[args.compositePowderId] })
    }
    if (args.superplasticizerId && materialNames[args.superplasticizerId]) {
      items.push({ category: '外加剂', dimension: '厂家', value: materialNames[args.superplasticizerId] })
    }
    if (args.calculationMethod === 'absolute') {
      items.push({ method: '体积法' })
    } else if (args.calculationMethod === 'mass') {
      items.push({ method: '质量法' })
    }
    return items
  }

  _itemKey(item) {
    if (item.method) return `method:${item.method}`
    return `${item.category}|${item.dimension}|${item.metric || ''}|${item.value || ''}`
  }

  _itemFromKey(key) {
    if (key.startsWith('method:')) {
      return { method: key.slice(7) }
    }
    const [category, dimension, metric, value] = key.split('|')
    const item = { category, dimension, value }
    if (metric) item.metric = metric
    return item
  }

  _suggestionTypeFor(item) {
    if (item.method) return 'method_preference'
    if (item.dimension === '厂家') return 'material_vendor'
    if (item.dimension === '种类') return 'material_category'
    if (item.dimension === '性能') return 'material_performance'
    return 'unknown'
  }

  _isAlreadyInMaterials(item) {
    if (item.method) return this.existingMethod === item.method
    return this.existingMaterials.some(m =>
      m.category === item.category &&
      m.dimension === item.dimension &&
      (m.metric || '') === (item.metric || '') &&
      (m.value || '') === (item.value || '')
    )
  }
}

module.exports = { PreferencePatternDetector }
const { PreferenceSuggestion } = require('../../db/database')

/**
 * 建议存储 v2 — 改为 SQLite 持久化（第一批清理时是内存版）
 * 不再重启即清空，老板重启后建议还在
 */
class SuggestionStore {
  async add(suggestion) {
    // 用 (type + payload JSON) 去重
    const exists = await PreferenceSuggestion.findOne({
      where: { type: suggestion.type, status: 'pending' }
    })
    if (exists) return exists

    return PreferenceSuggestion.create({
      type: suggestion.type,
      payload: suggestion.payload || {},
      confidence: suggestion.confidence || 0.5,
      status: 'pending',
      decayScore: 1.0
    })
  }

  async list() {
    return PreferenceSuggestion.findAll({ where: { status: 'pending' } })
  }

  async get(id) {
    return PreferenceSuggestion.findByPk(id)
  }

  async remove(id) {
    return PreferenceSuggestion.destroy({ where: { id } })
  }

  async clear() {
    return PreferenceSuggestion.destroy({ where: { status: 'pending' } })
  }
}

module.exports = { SuggestionStore: new SuggestionStore() }

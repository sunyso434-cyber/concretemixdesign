/**
 * 会话级「已加载技能」登记表（技能目录式路由 · 方案一）
 *
 * 背景：catalog 路由模式下，每轮 LLM 请求只携带「常驻工具 + 会话已加载技能」的完整
 * JSON Schema，其余技能仅以目录形式存在于 system prompt。本模块维护第二个集合——
 * 会话内已通过 use_skill 元工具（或 toolExecutor 拦截自动展开）加载过的技能名。
 *
 * 设计决策：
 * - 仅存内存：会话恢复（resume/followUp）后记录丢失是可接受的——
 *   toolExecutor 的拦截自动展开会自愈（多花一轮），不做 DB 持久化。
 * - 单例导出：use-skill.js 与 strategies/toolExecutor.js 分属不同目录层级，
 *   通过 require 同一单例共享状态；同时把类挂到导出上，供测试构造隔离实例。
 */
class SessionLoadedSkills {
  constructor() {
    /** @type {Map<string, Set<string>>} sessionId -> Set<skillName> */
    this._map = new Map()
  }

  /**
   * 登记一个已加载技能（幂等；sessionId/name 缺失时静默拒绝）
   * @param {string} sessionId - 会话 ID
   * @param {string} name - 技能名
   * @returns {boolean} 是否登记成功
   */
  load(sessionId, name) {
    if (!sessionId || !name) return false
    let set = this._map.get(sessionId)
    if (!set) {
      set = new Set()
      this._map.set(sessionId, set)
    }
    set.add(name)
    return true
  }

  /**
   * 查询某技能在指定会话是否已加载
   * @param {string} sessionId
   * @param {string} name
   * @returns {boolean}
   */
  has(sessionId, name) {
    const set = this._map.get(sessionId)
    return Boolean(set && set.has(name))
  }

  /**
   * 获取指定会话的已加载技能名数组（无记录返回空数组）
   * @param {string} sessionId
   * @returns {string[]}
   */
  get(sessionId) {
    const set = this._map.get(sessionId)
    return set ? Array.from(set) : []
  }

  /** 会话结束/清理时调用，防止长驻进程内存累积 */
  cleanup(sessionId) {
    this._map.delete(sessionId)
  }

  /** 清空全部登记（测试用） */
  reset() {
    this._map.clear()
  }
}

module.exports = new SessionLoadedSkills()
module.exports.SessionLoadedSkills = SessionLoadedSkills

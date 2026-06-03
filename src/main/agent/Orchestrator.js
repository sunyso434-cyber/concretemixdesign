/**
 * Orchestrator 外壳
 *
 * 职责：
 * - 状态机（idle / running / paused）
 * - pause / resume / abort
 * - 委托 ExecutionStrategy 执行
 *
 * 不做：
 * - 主循环（交给 UnifiedStrategy）
 * - prompt 构造（交给 systemPromptBuilder）
 * - 错误分类（交给 errorHandler）
 */

const controlMixin = require('./controlMixin')

class Orchestrator {
  constructor({ deepseekService, skillRegistry, skillExecutor, agentMemoryService, strategyName = 'unified' }) {
    this.deepseekService = deepseekService
    this.skillRegistry = skillRegistry
    this.skillExecutor = skillExecutor
    this.agentMemoryService = agentMemoryService

    // 状态
    this.state = 'idle'
    this.aborted = false
    this.paused = false
    this.webContents = null

    // 注入 control mixin
    Object.assign(this, controlMixin)

    // 选 strategy
    const Strategy = this._resolveStrategy(strategyName)
    this.strategy = new Strategy({
      deepseekService, skillRegistry, skillExecutor, agentMemoryService
    })
  }

  _resolveStrategy(name) {
    if (name === 'unified') {
      return require('./strategies/UnifiedStrategy')
    }
    if (name === 'multi-agent') {
      return require('./strategies/MultiAgentStrategy')
    }
    throw new Error(`Unknown strategy: ${name}`)
  }

  static create(strategyName, deps) {
    return new Orchestrator({ ...deps, strategyName })
  }

  /**
   * 跑一个 session 任务
   * @param {Object} input
   * @param {string} input.sessionId
   * @param {string} input.message
   * @param {string} [input.mode='auto']
   * @param {Object} [input.webContents]
   * @returns {Promise<Object>}
   */
  async run(input) {
    this.state = 'running'
    this.webContents = input.webContents || null

    try {
      const result = await this.strategy.execute(input)
      return result
    } finally {
      this.state = 'idle'
      this.aborted = false
    }
  }
}

module.exports = Orchestrator

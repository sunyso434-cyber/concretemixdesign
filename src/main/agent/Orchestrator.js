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
  constructor({ deepseekService, skillRegistry, skillExecutor, agentMemoryService, systemService, strategyName = 'unified' }) {
    this.deepseekService = deepseekService
    this.skillRegistry = skillRegistry
    this.skillExecutor = skillExecutor
    this.agentMemoryService = agentMemoryService
    this.systemService = systemService || null

    // 状态
    this.state = 'idle'
    this.aborted = false
    this.paused = false
    this.webContents = null

    // 注入 control mixin
    Object.assign(this, controlMixin)

    // v9.1.0: 初始化 ask_user 跨进程协同所需字段
    this._pendingConfirmation = null
    this._confirmationTimer = null

    // 选 strategy
    const Strategy = this._resolveStrategy(strategyName)
    this.strategy = new Strategy({
      deepseekService, skillRegistry, skillExecutor, agentMemoryService, systemService,
      // v9.1.0: 把 self 传给 strategy，让 ask_user 等 skill 能通过 context.orchestrator 拿到本实例
      orchestrator: this
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
    // v9.1.0: 存 sessionId 到实例，让 controlMixin 的 requestConfirmation 能按 sessionId 路由
    this.sessionId = input.sessionId || null
    this._abortController = new AbortController()

    try {
      const result = await this.strategy.execute({
        ...input,
        signal: this._abortController.signal,
        getState: () => this.state
      })
      return result
    } finally {
      this.state = 'idle'
      this.aborted = false
      this._abortController = null
    }
  }
}

module.exports = Orchestrator

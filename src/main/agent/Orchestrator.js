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
// soft skill 注入器：监听 user 消息决定激活/退激活，拼装 Layer1/2/3
const SoftSkillInjector = require('./SoftSkillInjector')
// 子文件解析与加载（parseSubFileRefs + loadSubFile），无状态，可复用
const SubFileResolver = require('./SubFileResolver')

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

    // 实例化 soft skill 注入器（生产接线修复）
    // - SubFileResolver 无状态，同时充当 mdInstructionBuilder（parseSubFileRefs 来自它）
    // - baseDir 用用户 skill 目录，匹配子文件约定 <baseDir>/<skillName>/<subFile>
    //   builtin soft skill 子目录若不在该路径下，loadSubFile 静默返回 success=false，不崩
    // - skillRegistry 兜底：Orchestrator.create 入口可能在未知 strategy 等场景传入 undefined/null，
    //   此时不构造 injector（反正 strategy 解析会抛错或测试会重写 strategy）
    const subFileResolver = new SubFileResolver()
    const userDir = (skillRegistry && typeof skillRegistry.getUserDir === 'function' && skillRegistry.getUserDir()) || null
    this._softSkillInjector = new SoftSkillInjector({
      skillRegistry: skillRegistry || {},
      mdInstructionBuilder: subFileResolver,
      subFileResolver,
      baseDir: userDir
    })

    // 选 strategy
    const Strategy = this._resolveStrategy(strategyName)
    this.strategy = new Strategy({
      deepseekService, skillRegistry, skillExecutor, agentMemoryService, systemService,
      // v9.1.0: 把 self 传给 strategy，让 ask_user 等 skill 能通过 context.orchestrator 拿到本实例
      orchestrator: this,
      // 生产接线修复：补传 softSkillInjector，否则 UnifiedStrategy 内恒为 null
      softSkillInjector: this._softSkillInjector
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

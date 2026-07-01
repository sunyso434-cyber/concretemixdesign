const ContextManager = require('./ContextManager')
const AuditLogger = require('./AuditLogger')
const FeatureFlag = require('./FeatureFlag')

const handleInput = require('./handlers/input')
const handleConst = require('./handlers/const')
const handleMaterial = require('./handlers/material')
const handleFormula = require('./handlers/formula')
const handleTableLookup = require('./handlers/tableLookup')
const handleIfElse = require('./handlers/ifElse')
const handleOutput = require('./handlers/output')

class BlueprintEngine {
  constructor(opts = {}) {
    this.materialsIndex = opts.materialsIndex || {}
    this.tables = opts.tables || {}
    this.context = new ContextManager()
    this.audit = new AuditLogger(this.context)
  }

  async dispatch(step) {
    switch (step.type) {
      case 'input': return handleInput(step, this.context, this._userParams)
      case 'const': return handleConst(step, this.context)
      case 'material': return handleMaterial(step, this.context, this.materialsIndex, this._runtimeCtx)
      case 'formula': return handleFormula(step, this.context)
      case 'table_lookup': return handleTableLookup(step, this.context, this.tables)
      case 'if_else': return handleIfElse(step, this.context, (s) => this.dispatch(s))
      case 'output': return handleOutput(step, this.context)
      default: throw new Error(`未知操作类型: ${step.type}`)
    }
  }

  async run(blueprint, userParams = {}, runtimeCtx = {}) {
    if (!FeatureFlag.isEnabled()) {
      throw new Error('蓝图引擎已禁用（blueprint_engine_enabled=false）')
    }

    // 每次 run() 重置上下文，避免跨 run 变量缓存导致 input 步骤被跳过
    this.context = new ContextManager()
    this.audit = new AuditLogger(this.context)

    this._userParams = userParams instanceof Map ? userParams : new Map(Object.entries(userParams))
    this._runtimeCtx = runtimeCtx

    const steps = blueprint.steps || []
    for (let i = 0; i < steps.length; i++) {
      const step = { ...steps[i], _index: i }
      const result = await this.dispatch(step)
      this.context.logStep(step, result)
    }

    return {
      results: this.context.getResults(),
      log: this.audit.getLog()
    }
  }
}

module.exports = BlueprintEngine

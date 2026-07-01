class ContextManager {
  constructor() {
    this._vars = new Map()
    this._auditLog = []
    this._results = {}
  }

  set(name, value) { this._vars.set(name, value) }
  get(name) { return this._vars.get(name) }
  has(name) { return this._vars.has(name) }
  snapshot() { return Object.fromEntries(this._vars) }

  logStep(step, result) {
    this._auditLog.push({
      stepIndex: step._index,
      type: step.type,
      var: step.var,
      result,
      snapshot: this.snapshot()
    })
  }

  getAuditLog() { return this._auditLog }
  getResults() { return this._results }
}

module.exports = ContextManager

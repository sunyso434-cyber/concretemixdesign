class AuditLogger {
  constructor(contextManager) {
    this.cm = contextManager
  }

  logStep(step, result) {
    this.cm.logStep(step, result)
  }

  getLog() {
    return this.cm.getAuditLog()
  }

  formatSummary() {
    const log = this.getLog()
    return log.map(entry =>
      `[${entry.stepIndex}] ${entry.type} ${entry.var} = ${JSON.stringify(entry.result)}`
    ).join('\n')
  }
}

module.exports = AuditLogger

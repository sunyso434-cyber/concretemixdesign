const ContextManager = require('../../../services/BlueprintEngine/ContextManager')
const AuditLogger = require('../../../services/BlueprintEngine/AuditLogger')

describe('AuditLogger', () => {
  let cm
  let logger

  beforeEach(() => {
    cm = new ContextManager()
    logger = new AuditLogger(cm)
  })

  test('logStep 委托给 contextManager.logStep', () => {
    cm.set('a', 1)
    const step = { _index: 0, type: 'input', var: 'a' }
    logger.logStep(step, 1)

    const log = cm.getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      stepIndex: 0,
      type: 'input',
      var: 'a',
      result: 1
    })
  })

  test('getLog 返回 contextManager 的审计日志', () => {
    cm.set('x', 10)
    logger.logStep({ _index: 0, type: 'input', var: 'x' }, 10)
    logger.logStep({ _index: 1, type: 'compute', var: 'y' }, 20)

    const log = logger.getLog()
    expect(log).toHaveLength(2)
    expect(log[0].var).toBe('x')
    expect(log[1].var).toBe('y')
    // 同一个引用，确保是委托
    expect(log).toBe(cm.getAuditLog())
  })

  test('formatSummary 输出可读摘要，如 "[0] input x = 1"', () => {
    cm.set('x', 1)
    logger.logStep({ _index: 0, type: 'input', var: 'x' }, 1)
    cm.set('y', 2)
    logger.logStep({ _index: 1, type: 'compute', var: 'y' }, 2)

    const summary = logger.formatSummary()
    const lines = summary.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('[0] input x = 1')
    expect(lines[1]).toBe('[1] compute y = 2')
  })
})

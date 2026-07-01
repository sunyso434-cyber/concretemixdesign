const ContextManager = require('../../../services/BlueprintEngine/ContextManager')

describe('ContextManager', () => {
  let cm
  beforeEach(() => { cm = new ContextManager() })

  test('set/get/has 基础操作', () => {
    cm.set('a', 1)
    expect(cm.get('a')).toBe(1)
    expect(cm.has('a')).toBe(true)
    expect(cm.has('b')).toBe(false)
  })

  test('snapshot 返回变量字典快照', () => {
    cm.set('a', 1)
    cm.set('b', 2)
    expect(cm.snapshot()).toEqual({ a: 1, b: 2 })
  })

  test('logStep(step, result) 记录审计日志（与 §4.1 流程图保持一致）', () => {
    cm.set('a', 1)
    cm.logStep({ _index: 0, type: 'input', var: 'a' }, 1)
    const log = cm.getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      stepIndex: 0,
      type: 'input',
      var: 'a',
      result: 1,
      snapshot: { a: 1 }
    })
  })
})

/**
 * EventBus 单测
 * 前置：A4 (commit 8b35d16) — EventBus 继承自 EventEmitter + clear() = removeAllListeners()
 * 关键：EventBus 是单例，每个 test 前必须清空监听者（避免污染）
 */

const eventBus = require('../EventBus')

describe('EventBus', () => {
  // 关键：每个 test 前清空监听者（解决 Jest 单例污染问题）
  beforeEach(() => eventBus.clear())
  afterAll(() => eventBus.clear())

  test('on / emit 应触发回调', () => {
    const cb = jest.fn()
    eventBus.on('test', cb)
    eventBus.emit('test', { foo: 1 })
    expect(cb).toHaveBeenCalledWith({ foo: 1 })
  })

  test('off 应移除指定监听者', () => {
    const cb = jest.fn()
    eventBus.on('test', cb)
    eventBus.off('test', cb)
    eventBus.emit('test', {})
    expect(cb).not.toHaveBeenCalled()
  })

  test('clear 应清空所有监听者', () => {
    // EventBus 继承自 EventEmitter，没有 _listeners 字段
    // 验证 removeAllListeners() 行为：用官方 API eventNames() 和 listenerCount()
    const cbA = jest.fn()
    const cbB = jest.fn()
    eventBus.on('a', cbA)
    eventBus.on('b', cbB)

    // clear 前：应有 2 个事件名
    expect(eventBus.eventNames()).toEqual(expect.arrayContaining(['a', 'b']))
    expect(eventBus.listenerCount('a')).toBe(1)
    expect(eventBus.listenerCount('b')).toBe(1)

    eventBus.clear()

    // clear 后：所有事件应被移除
    expect(eventBus.eventNames()).toEqual([])
    expect(eventBus.listenerCount('a')).toBe(0)
    expect(eventBus.listenerCount('b')).toBe(0)

    // 间接验证：emit 后 cb 不应被调用
    eventBus.emit('a', { x: 1 })
    eventBus.emit('b', { y: 2 })
    expect(cbA).not.toHaveBeenCalled()
    expect(cbB).not.toHaveBeenCalled()
  })

  test('多个监听者应都被调用', () => {
    const cb1 = jest.fn()
    const cb2 = jest.fn()
    eventBus.on('test', cb1)
    eventBus.on('test', cb2)
    eventBus.emit('test', {})
    expect(cb1).toHaveBeenCalled()
    expect(cb2).toHaveBeenCalled()
  })

  test('emit 无监听者不应 throw', () => {
    expect(() => eventBus.emit('no_listener_event', {})).not.toThrow()
  })

  test('emitToolExecuted 应触发 tool:executed 事件', () => {
    const cb = jest.fn()
    eventBus.on('tool:executed', cb)
    const args = { foo: 'bar' }
    const result = { success: true }
    eventBus.emitToolExecuted('test-skill', args, result)
    expect(cb).toHaveBeenCalledTimes(1)
    const payload = cb.mock.calls[0][0]
    expect(payload.skillName).toBe('test-skill')
    expect(payload.args).toBe(args)
    expect(payload.result).toBe(result)
    expect(payload.timestamp).toBeGreaterThan(0)
  })

  test('emitUserCorrection 应触发 user:correction 事件', () => {
    const cb = jest.fn()
    eventBus.on('user:correction', cb)
    const correction = {
      toolName: 'strength-validator',
      context: { mixId: 'M001' },
      original: { value: 30 },
      corrected: { value: 35 }
    }
    eventBus.emitUserCorrection(correction)
    expect(cb).toHaveBeenCalledTimes(1)
    const payload = cb.mock.calls[0][0]
    expect(payload.toolName).toBe('strength-validator')
    expect(payload.original).toEqual({ value: 30 })
    expect(payload.corrected).toEqual({ value: 35 })
    expect(payload.timestamp).toBeGreaterThan(0)
  })
})

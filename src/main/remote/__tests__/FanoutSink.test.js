const { FanoutSink, wrapWs, wrapWebContents } = require('../FanoutSink')

// —— 测试辅助：可控制的裸 ws mock ——
function createMockWs(initialReadyState = 1) {
  const listeners = {}
  return {
    readyState: initialReadyState,
    send: jest.fn(),
    on: jest.fn((event, cb) => {
      listeners[event] = cb
    }),
    // 模拟 ws 断开：readyState 变为 CLOSED(3) 并触发 'close'
    simulateClose() {
      this.readyState = 3
      if (listeners['close']) listeners['close']()
    }
  }
}

// —— 测试辅助：可控制的 Electron webContents mock ——
function createMockWebContents(initialDestroyed = false) {
  const listeners = {}
  let destroyed = initialDestroyed
  return {
    isDestroyed: jest.fn(() => destroyed),
    send: jest.fn(),
    on: jest.fn((event, cb) => {
      listeners[event] = cb
    }),
    // 模拟窗口销毁：标记 destroyed 并触发 'closed'
    emitClosed() {
      destroyed = true
      if (listeners['closed']) listeners['closed']()
    }
  }
}

describe('FanoutSink', () => {
  describe('广播', () => {
    test('send 同时广播到所有目标', () => {
      const sink = new FanoutSink()
      const t1 = { send: jest.fn() }
      const t2 = { send: jest.fn() }
      sink.addTarget(t1)
      sink.addTarget(t2)

      sink.send('agent:event', { id: 1 })

      expect(t1.send).toHaveBeenCalledWith('agent:event', { id: 1 })
      expect(t2.send).toHaveBeenCalledWith('agent:event', { id: 1 })
    })

    test('重复 addTarget 同一目标只广播一次', () => {
      const sink = new FanoutSink()
      const t = { send: jest.fn() }
      sink.addTarget(t)
      sink.addTarget(t)

      sink.send('agent:event', {})

      expect(t.send).toHaveBeenCalledTimes(1)
    })

    test('removeTarget 后不再广播给该目标', () => {
      const sink = new FanoutSink()
      const t = { send: jest.fn() }
      sink.addTarget(t)
      sink.removeTarget(t)

      sink.send('agent:event', {})

      expect(t.send).not.toHaveBeenCalled()
    })
  })

  describe('单目标隔离', () => {
    test('单个目标抛错不影响其他目标收到广播', () => {
      const sink = new FanoutSink()
      const t1 = { send: jest.fn(() => { throw new Error('boom') }) }
      const t2 = { send: jest.fn() }
      sink.addTarget(t1)
      sink.addTarget(t2)

      expect(() => sink.send('agent:event', {})).not.toThrow()
      expect(t2.send).toHaveBeenCalledWith('agent:event', {})
    })
  })

  describe('isDestroyed 语义', () => {
    test('空 sink 视为已销毁', () => {
      expect(new FanoutSink().isDestroyed()).toBe(true)
    })

    test('任一目标存活即为 false', () => {
      const sink = new FanoutSink()
      sink.addTarget({ send: jest.fn(), isDestroyed: () => false })
      sink.addTarget({ send: jest.fn(), isDestroyed: () => true })
      expect(sink.isDestroyed()).toBe(false)
    })

    test('所有目标失效才返回 true', () => {
      const sink = new FanoutSink()
      sink.addTarget({ send: jest.fn(), isDestroyed: () => true })
      sink.addTarget({ send: jest.fn(), isDestroyed: () => true })
      expect(sink.isDestroyed()).toBe(true)
    })

    test('无 isDestroyed 方法的鸭子目标视为存活', () => {
      const sink = new FanoutSink()
      sink.addTarget({ send: jest.fn() })
      expect(sink.isDestroyed()).toBe(false)
    })
  })
})

describe('wrapWs', () => {
  test('send 序列化为 JSON {channel, payload} 发给 ws', () => {
    const ws = createMockWs(1)
    const wrapped = wrapWs(ws)

    wrapped.send('agent:event', { a: 1 })

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ channel: 'agent:event', payload: { a: 1 } }))
  })

  test('readyState 非 OPEN 时 send 静默跳过', () => {
    const ws = createMockWs(3) // CLOSED
    const wrapped = wrapWs(ws)

    wrapped.send('agent:event', {})

    expect(ws.send).not.toHaveBeenCalled()
  })

  test('isDestroyed 反映 readyState：OPEN(1) 存活，其余失效', () => {
    const ws = createMockWs(1)
    const wrapped = wrapWs(ws)
    expect(wrapped.isDestroyed()).toBe(false)

    ws.readyState = 3 // CLOSED
    expect(wrapped.isDestroyed()).toBe(true)
  })

  test('onClose 注册的回调在 ws close 时触发', () => {
    const ws = createMockWs(1)
    const wrapped = wrapWs(ws)
    const cb = jest.fn()
    wrapped.onClose(cb)

    ws.simulateClose()

    expect(cb).toHaveBeenCalledTimes(1)
  })

  test('ws close 后 sink 自动移除该目标（防目标集泄漏）', () => {
    const sink = new FanoutSink()
    const ws = createMockWs(1)
    const wrapped = wrapWs(ws)
    sink.addTarget(wrapped)
    expect(sink.isDestroyed()).toBe(false)

    ws.simulateClose()

    // 目标被自动移除 → sink 变空 → 视为已销毁
    expect(sink.isDestroyed()).toBe(true)
    // 且后续广播不再触达已断开的 ws
    sink.send('agent:event', {})
    expect(ws.send).not.toHaveBeenCalled()
  })
})

describe('wrapWebContents', () => {
  test('send / isDestroyed 鸭子类型包装（不依赖 electron 模块）', () => {
    const wc = createMockWebContents(false)
    const wrapped = wrapWebContents(wc)

    wrapped.send('channel-a', { x: 1 })
    expect(wc.send).toHaveBeenCalledWith('channel-a', { x: 1 })

    expect(wrapped.isDestroyed()).toBe(false)
    wc.isDestroyed.mockReturnValue(true)
    expect(wrapped.isDestroyed()).toBe(true)
  })

  test('webContents closed 后 sink 自动移除该目标', () => {
    const sink = new FanoutSink()
    const wc = createMockWebContents(false)
    const wrapped = wrapWebContents(wc)
    sink.addTarget(wrapped)
    expect(sink.isDestroyed()).toBe(false)

    wc.emitClosed()

    expect(sink.isDestroyed()).toBe(true)
  })
})

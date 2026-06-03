const controlMixin = require('../controlMixin')

describe('controlMixin', () => {
  let target
  let webContents

  beforeEach(() => {
    webContents = { send: jest.fn(), isDestroyed: jest.fn(() => false) }
    target = { webContents, state: 'idle', aborted: false, paused: false }
    Object.assign(target, controlMixin)
  })

  test('_notifyProgress 应通过 webContents.send 发送事件', () => {
    target._notifyProgress('test_event', { foo: 'bar' })
    expect(webContents.send).toHaveBeenCalledWith('test_event', { foo: 'bar' })
  })

  test('webContents destroyed 时 _notifyProgress 应静默', () => {
    webContents.isDestroyed.mockReturnValue(true)
    target._notifyProgress('test_event', { foo: 'bar' })
    expect(webContents.send).not.toHaveBeenCalled()
  })

  test('pause 应把 state 改 paused', () => {
    target.state = 'running'
    target.pause()
    expect(target.state).toBe('paused')
  })

  test('resume 应把 state 改 running', () => {
    target.state = 'paused'
    target.resume()
    expect(target.state).toBe('running')
  })

  test('abort 应把 aborted 改 true', () => {
    target.abort()
    expect(target.aborted).toBe(true)
  })

  test('_cleanMessage 应剥离 reasoning_content 之外的非序列化字段', () => {
    const msg = {
      role: 'assistant',
      content: 'hi',
      reasoning_content: 'thinking...',
      extra: 'noise'
    }
    const cleaned = target._cleanMessage(msg)
    expect(cleaned.reasoning_content).toBe('thinking...')
    expect(cleaned.extra).toBeUndefined()
  })
})

const controlMixin = require('../../agent/controlMixin')

describe('controlMixin 中断机制（v3.1）', () => {
  let target
  let webContents

  beforeEach(() => {
    webContents = { send: jest.fn(), isDestroyed: jest.fn(() => false) }
    target = { webContents, sessionId: 's1', state: 'running' }
    Object.assign(target, controlMixin)
  })

  test('requestInterrupt 置 interruptRequested=true 并 abort _currentTurnAbort', () => {
    const abortSpy = jest.fn()
    target._currentTurnAbort = { abort: abortSpy }
    target.requestInterrupt()
    expect(target.interruptRequested).toBe(true)
    expect(abortSpy).toHaveBeenCalled()
  })

  test('requestInterrupt 无 _currentTurnAbort 时不报错', () => {
    expect(() => target.requestInterrupt()).not.toThrow()
    expect(target.interruptRequested).toBe(true)
  })

  test('clearInterrupt 重置标志 / isInterrupted 反映标志', () => {
    expect(target.isInterrupted()).toBe(false)
    target.requestInterrupt()
    expect(target.isInterrupted()).toBe(true)
    target.clearInterrupt()
    expect(target.isInterrupted()).toBe(false)
  })

  test('cancelPendingConfirmation reject INTERRUPTED_BY_STEER + 清 pending + 通知前端收起', async () => {
    const p = target.requestConfirmation({ question: 'x' })
    const reqId = webContents.send.mock.calls[0][1].confirmationId
    const assertion = expect(p).rejects.toThrow('INTERRUPTED_BY_STEER')
    target.cancelPendingConfirmation()
    expect(target._pendingConfirmation).toBeNull()
    const closeCall = webContents.send.mock.calls.find(c => c[0] === 'agent:confirmation-close')
    expect(closeCall).toBeTruthy()
    expect(closeCall[1]).toEqual({ sessionId: 's1', confirmationId: reqId })
    clearTimeout(target._confirmationTimer)
    return assertion
  })

  test('cancelPendingConfirmation 无 pending 时静默', () => {
    expect(() => target.cancelPendingConfirmation()).not.toThrow()
  })
})

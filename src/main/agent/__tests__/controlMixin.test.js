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

  // ===== v2026-08-03：ask_user 确认弹窗修复 =====
  describe('requestConfirmation（v2026-08-03 修复）', () => {
    test('发事件带 confirmationId（回答校验 + 超时关闭用）', () => {
      const p = target.requestConfirmation({ question: '确定？', inputType: 'choice', options: ['A', 'B'] })
      const sent = webContents.send.mock.calls[0]
      expect(sent[0]).toBe('agent:confirmation-request')
      expect(sent[1].confirmationId).toMatch(/^cf_/)
      expect(sent[1].question).toBe('确定？')
      expect(target._pendingConfirmation.confirmationId).toBe(sent[1].confirmationId)
      // 清理 timer 防止测试悬挂
      clearTimeout(target._confirmationTimer)
      p.catch(() => {})
    })

    test('超时（90s）→ reject USER_CONFIRMATION_TIMEOUT + 发 agent:confirmation-close 通知前端收起', () => {
      jest.useFakeTimers()
      const p = target.requestConfirmation({ question: 'x' })
      const reqId = webContents.send.mock.calls[0][1].confirmationId
      const assertion = expect(p).rejects.toThrow('USER_CONFIRMATION_TIMEOUT')
      jest.advanceTimersByTime(90 * 1000)
      // 前端收到关闭事件（带同一 confirmationId）
      const closeCall = webContents.send.mock.calls.find(c => c[0] === 'agent:confirmation-close')
      expect(closeCall).toBeTruthy()
      expect(closeCall[1]).toEqual({ sessionId: target.sessionId, confirmationId: reqId })
      // pending 已清
      expect(target._pendingConfirmation).toBeNull()
      jest.useRealTimers()
      return assertion
    })

    test('resolveConfirmation：confirmationId 匹配 → resolve 回答', async () => {
      const p = target.requestConfirmation({ question: 'x' })
      const reqId = webContents.send.mock.calls[0][1].confirmationId
      const resultPromise = p.then(r => r)
      target.resolveConfirmation(true, { answer: 'yes', confirmationId: reqId })
      await expect(resultPromise).resolves.toEqual({ answer: 'yes', confirmationId: reqId })
      clearTimeout(target._confirmationTimer)
    })

    test('resolveConfirmation：confirmationId 不匹配（旧弹窗残留回答）→ 忽略，不污染当前 pending', async () => {
      const p = target.requestConfirmation({ question: '新提问' })
      const reqId = webContents.send.mock.calls[0][1].confirmationId
      // 旧弹窗的回答（id 不匹配）先到
      target.resolveConfirmation(true, { answer: '旧回答', confirmationId: 'cf_stale_000' })
      // pending 未被清，新提问仍等待
      expect(target._pendingConfirmation).not.toBeNull()
      // 新弹窗的回答正常 resolve
      const resultPromise = p.then(r => r)
      target.resolveConfirmation(true, { answer: '新回答', confirmationId: reqId })
      await expect(resultPromise).resolves.toMatchObject({ answer: '新回答' })
      clearTimeout(target._confirmationTimer)
    })

    test('resolveConfirmation：不带 confirmationId 的旧调用方保持放行（兼容）', async () => {
      const p = target.requestConfirmation({ question: 'x' })
      const resultPromise = p.then(r => r)
      target.resolveConfirmation(true, { answer: 'legacy' })
      await expect(resultPromise).resolves.toEqual({ answer: 'legacy' })
      clearTimeout(target._confirmationTimer)
    })
  })

  // ===== 批 B Task 1.7：steer/followUp/drain 队列 =====
  describe('steer/followUp/drain 队列（Task 1.7）', () => {
    test('steer 入队 → drainSteering 返回并清空', () => {
      target.steer('插话1')
      target.steer('插话2')
      expect(target.steeringQueue).toEqual(['插话1', '插话2'])
      const out = target.drainSteering()
      expect(out).toEqual(['插话1', '插话2'])
      expect(target.steeringQueue).toEqual([])
    })

    test('followUp 入队 → drainFollowUp 返回并清空', () => {
      target.followUp('追加任务1')
      expect(target.followUpQueue).toEqual(['追加任务1'])
      const out = target.drainFollowUp()
      expect(out).toEqual(['追加任务1'])
      expect(target.followUpQueue).toEqual([])
    })

    test('drainSteering 空队列返回 [] 且不报错', () => {
      expect(target.drainSteering()).toEqual([])
    })

    test('drainFollowUp 空队列返回 [] 且不报错', () => {
      expect(target.drainFollowUp()).toEqual([])
    })

    test('drain 后再次入队正常工作（清空后可复用）', () => {
      target.steer('a')
      target.drainSteering()
      target.steer('b')
      expect(target.drainSteering()).toEqual(['b'])
    })

    test('steer 空消息不入队', () => {
      target.steer('')
      target.steer(null)
      target.steer(undefined)
      expect(target.steeringQueue).toBeUndefined()
    })

    test('steer 与 followUp 队列独立（互不影响）', () => {
      target.steer('插话')
      target.followUp('追加')
      expect(target.steeringQueue).toEqual(['插话'])
      expect(target.followUpQueue).toEqual(['追加'])
      target.drainSteering()
      expect(target.followUpQueue).toEqual(['追加'])
    })
  })
})

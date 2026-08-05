const askUser = require('../../skills/ask-user')

const _ctx = () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } })

describe('ask_user INTERRUPTED_BY_STEER（v3.1 问题 D）', () => {
  test('requestConfirmation reject INTERRUPTED_BY_STEER → 返回 interrupted:true 正常中断', async () => {
    const orchestrator = {
      requestConfirmation: jest.fn(() => Promise.reject(new Error('INTERRUPTED_BY_STEER')))
    }
    const result = await askUser.execute({ question: 'x' }, { orchestrator, ..._ctx() })
    expect(result.success).toBe(false)
    expect(result.error).toBe('INTERRUPTED_BY_STEER')
    expect(result.interrupted).toBe(true)
  })
})

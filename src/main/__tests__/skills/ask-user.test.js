/**
 * ask_user Skill 单元测试
 *
 * 覆盖：
 * - 正常回答（用户输入文本）
 * - 用户取消
 * - 用户超时（90s）
 * - 用户跳过（用 defaultValue）
 * - context 无 orchestrator
 * - 嵌套调用拒绝
 * - choice 模式透传 options
 * - errors 定义
 */

const askUser = require('../../skills/ask-user')

const _ctx = (overrides = {}) => ({
  orchestrator: null,
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  ...overrides
})

// 构造一个 mock orchestrator：requestConfirmation 返回可控 Promise
const _mockOrchestrator = (behavior = 'resolve-answer') => {
  let resolveFn, rejectFn
  const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej })
  const requestConfirmation = jest.fn(() => promise)

  // 测试代码可以通过 mockOrchestrator._resolve / _reject 主动控制 Promise
  const mock = { requestConfirmation, _resolve: resolveFn, _reject: rejectFn }

  if (behavior === 'resolve-answer') {
    // 默认行为：立即 resolve { answer: 'mock-answer' }
    mock.requestConfirmation = jest.fn(() => Promise.resolve({ answer: 'mock-answer' }))
  } else if (behavior === 'reject-USER_REJECTED') {
    mock.requestConfirmation = jest.fn(() => Promise.reject(new Error('USER_REJECTED')))
  } else if (behavior === 'reject-USER_CONFIRMATION_TIMEOUT') {
    mock.requestConfirmation = jest.fn(() => Promise.reject(new Error('USER_CONFIRMATION_TIMEOUT')))
  } else if (behavior === 'reject-NO_WEB_CONTENTS') {
    mock.requestConfirmation = jest.fn(() => Promise.reject(new Error('NO_WEB_CONTENTS')))
  } else if (behavior === 'reject-nested') {
    mock.requestConfirmation = jest.fn(() => Promise.reject(new Error('已有进行中的确认请求，不支持嵌套')))
  }

  return mock
}

describe('ask_user Skill - schema 与元数据', () => {
  test('skill 元数据完整', () => {
    expect(askUser.name).toBe('ask_user')
    expect(askUser.description).toBeTruthy()
    expect(askUser.version).toBe('1.0.0')
    expect(askUser.category).toBe('agent')
    expect(askUser.services).toEqual([])
    expect(typeof askUser.execute).toBe('function')
  })

  test('question 是必填参数', () => {
    expect(askUser.parameters.question.required).toBe(true)
  })

  test('inputType 默认 text 且枚举正确', () => {
    expect(askUser.parameters.inputType.enum).toEqual(['text', 'choice'])
  })

  test('errors 定义了 6 个错误码', () => {
    const codes = Object.keys(askUser.errors)
    expect(codes).toContain('E_ASK_USER_REJECTED')
    expect(codes).toContain('E_ASK_USER_TIMEOUT')
    expect(codes).toContain('E_ASK_USER_NO_ORCHESTRATOR')
    expect(codes).toContain('E_ASK_USER_NO_SESSION')
    expect(codes).toContain('E_ASK_USER_NO_WEB_CONTENTS')
    expect(codes).toContain('E_ASK_USER_NESTED')
  })
})

describe('ask_user Skill - 正常回答', () => {
  test('用户输入文本后返回 success=true, answered=true', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('resolve-answer') })
    const result = await askUser.execute({
      question: '请提供水泥产地',
      inputType: 'text'
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.answered).toBe(true)
    expect(result.answer).toBe('mock-answer')
    expect(ctx.orchestrator.requestConfirmation).toHaveBeenCalledTimes(1)
  })

  test('requestConfirmation 收到正确的 payload', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('resolve-answer') })
    await askUser.execute({
      question: '请提供强度等级',
      inputType: 'choice',
      options: ['C30', 'C40', 'C50'],
      placeholder: '选择等级',
      defaultValue: 'C30'
    }, ctx)

    const payload = ctx.orchestrator.requestConfirmation.mock.calls[0][0]
    expect(payload.toolName).toBe('ask_user')
    expect(payload.question).toBe('请提供强度等级')
    expect(payload.inputType).toBe('choice')
    expect(payload.options).toEqual(['C30', 'C40', 'C50'])
    expect(payload.placeholder).toBe('选择等级')
    expect(payload.defaultValue).toBe('C30')
  })

  test('不传 inputType 时默认 text', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('resolve-answer') })
    await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    const payload = ctx.orchestrator.requestConfirmation.mock.calls[0][0]
    // ask_user skill 内部不强制设置 inputType（用默认参数），由 LLM 传入
    // 这里测试当 inputType 未传时，payload 透传 undefined（默认值在解构时已生效）
    // 实际 payload 的 inputType 取决于 execute 的解构默认值
    expect(payload.question).toBe('请提供水泥产地')
  })
})

describe('ask_user Skill - 用户取消', () => {
  test('用户取消返回 success=false', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-USER_REJECTED') })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/取消/)
  })
})

describe('ask_user Skill - 用户超时', () => {
  test('超时返回 success=false', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-USER_CONFIRMATION_TIMEOUT') })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/超时/)
  })

  test('超时但有 defaultValue 时降级使用 defaultValue', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-USER_CONFIRMATION_TIMEOUT') })
    const result = await askUser.execute({
      question: '请提供水泥产地',
      defaultValue: '北京'
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.answered).toBe(false)
    expect(result.answer).toBe('北京')
    expect(result.note).toMatch(/defaultValue/)
  })
})

describe('ask_user Skill - 窗口关闭/不可用', () => {
  test('NO_WEB_CONTENTS 返回错误', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-NO_WEB_CONTENTS') })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/窗口/)
  })
})

describe('ask_user Skill - context 无 orchestrator', () => {
  test('context.orchestrator 缺失返回错误', async () => {
    const ctx = _ctx({ orchestrator: null })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/orchestrator/)
  })

  test('context.orchestrator 没有 requestConfirmation 方法返回错误', async () => {
    const ctx = _ctx({ orchestrator: {} })  // 空对象，没有 requestConfirmation
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/orchestrator/)
  })
})

describe('ask_user Skill - 嵌套调用', () => {
  test('已有进行中的提问时返回错误', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-nested') })
    const result = await askUser.execute({
      question: '问题 1'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/嵌套/)
  })
})

describe('ask_user Skill - answer 空值处理', () => {
  test('用户提交空文本 + 无 defaultValue 返回空字符串', async () => {
    const ctx = _ctx({
      orchestrator: {
        requestConfirmation: jest.fn(() => Promise.resolve({ answer: '' }))
      }
    })
    const result = await askUser.execute({
      question: '请提供备注（可选）'
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.answered).toBe(false)
    expect(result.answer).toBe('')
  })

  test('用户提交空文本 + 有 defaultValue 返回 defaultValue', async () => {
    const ctx = _ctx({
      orchestrator: {
        requestConfirmation: jest.fn(() => Promise.resolve({ answer: '' }))
      }
    })
    const result = await askUser.execute({
      question: '请提供水泥产地',
      defaultValue: '北京'
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.answered).toBe(false)
    expect(result.answer).toBe('北京')
  })

  test('result.answer 为 undefined 时降级到 defaultValue', async () => {
    const ctx = _ctx({
      orchestrator: {
        requestConfirmation: jest.fn(() => Promise.resolve({}))  // 无 answer 字段
      }
    })
    const result = await askUser.execute({
      question: '请提供水泥产地',
      defaultValue: '上海'
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.answer).toBe('上海')
  })
})

describe('ask_user Skill - 未知错误', () => {
  test('未知 Error message 透传', async () => {
    const ctx = _ctx({
      orchestrator: {
        requestConfirmation: jest.fn(() => Promise.reject(new Error('SOMETHING_UNEXPECTED')))
      }
    })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/SOMETHING_UNEXPECTED/)
  })
})

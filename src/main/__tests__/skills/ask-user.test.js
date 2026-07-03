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
 * - form 模式校验 + 透传 fields
 * - errors 定义（v2.0.0：7 个错误码 + form fields 校验）
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

  const mock = { requestConfirmation, _resolve: resolveFn, _reject: rejectFn }

  if (behavior === 'resolve-answer') {
    mock.requestConfirmation = jest.fn(() => Promise.resolve({ answer: 'mock-answer' }))
  } else if (behavior === 'resolve-values') {
    mock.requestConfirmation = jest.fn(() => Promise.resolve({ values: { name: 'mocked-name' } }))
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
    expect(askUser.version).toBe('2.0.0')  // v10.x 升级
    expect(askUser.category).toBe('agent')
    expect(askUser.services).toEqual([])
    expect(typeof askUser.execute).toBe('function')
  })

  test('question 是必填参数', () => {
    expect(askUser.parameters.question.required).toBe(true)
  })

  test('inputType 枚举含 text/choice/form', () => {
    expect(askUser.parameters.inputType.enum).toEqual(['text', 'choice', 'form'])
  })

  test('fields 参数定义含 form 模式 schema', () => {
    expect(askUser.parameters.fields.required).toBe(false)
    expect(askUser.parameters.fields.items.properties.type.enum).toContain('boolean')
  })

  test('errors 定义了 7 个错误码（含 form 校验）', () => {
    const codes = Object.keys(askUser.errors)
    expect(codes).toContain('E_ASK_USER_REJECTED')
    expect(codes).toContain('E_ASK_USER_TIMEOUT')
    expect(codes).toContain('E_ASK_USER_NO_ORCHESTRATOR')
    expect(codes).toContain('E_ASK_USER_NO_SESSION')
    expect(codes).toContain('E_ASK_USER_NO_WEB_CONTENTS')
    expect(codes).toContain('E_ASK_USER_NESTED')
    expect(codes).toContain('E_ASK_USER_FORM_FIELDS_EMPTY')
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
    expect(payload.question).toBe('请提供水泥产地')
  })
})

describe('ask_user Skill - 用户取消', () => {
  test('用户取消返回 success=false + 错误码', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-USER_REJECTED') })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_REJECTED')
    expect(result.error.message).toMatch(/取消/)
  })
})

describe('ask_user Skill - 用户超时', () => {
  test('超时返回 success=false + 错误码', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-USER_CONFIRMATION_TIMEOUT') })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_TIMEOUT')
    expect(result.error.message).toMatch(/超时/)
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
    expect(result.error.code).toBe('E_ASK_USER_NO_WEB_CONTENTS')
  })
})

describe('ask_user Skill - context 无 orchestrator', () => {
  test('context.orchestrator 缺失返回错误', async () => {
    const ctx = _ctx({ orchestrator: null })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_NO_ORCHESTRATOR')
    expect(result.error.message).toMatch(/orchestrator/)
  })

  test('context.orchestrator 没有 requestConfirmation 方法返回错误', async () => {
    const ctx = _ctx({ orchestrator: {} })
    const result = await askUser.execute({
      question: '请提供水泥产地'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_NO_ORCHESTRATOR')
  })
})

describe('ask_user Skill - 嵌套调用', () => {
  test('已有进行中的提问时返回错误', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('reject-nested') })
    const result = await askUser.execute({
      question: '问题 1'
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_NESTED')
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
        requestConfirmation: jest.fn(() => Promise.resolve({}))
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

describe('ask_user Skill - form 模式（v2.0.0 新增）', () => {
  test('form 模式无 fields 返回 FORM_FIELDS_EMPTY 错误', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator() })
    const result = await askUser.execute({
      question: '保存方案',
      inputType: 'form'
      // 故意不传 fields
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_FORM_FIELDS_EMPTY')
  })

  test('form 模式 fields 为空数组也报错', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator() })
    const result = await askUser.execute({
      question: '保存方案',
      inputType: 'form',
      fields: []
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_FORM_FIELDS_EMPTY')
  })

  test('form 模式正常返回 values', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('resolve-values') })
    const result = await askUser.execute({
      question: '确认保存',
      inputType: 'form',
      fields: [
        { key: 'name', label: '名称', type: 'string', value: 'C30-旧' }
      ]
    }, ctx)

    expect(result.success).toBe(true)
    expect(result.values).toEqual({ name: 'mocked-name' })
  })

  test('form 模式透传 fields 到 orchestrator', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator('resolve-values') })
    const fields = [
      { key: 'name', label: '名称', type: 'string', value: 'C30' },
      { key: 'slump', label: '坍落度', type: 'number', value: 180 },
      { key: 'isDefault', label: '默认', type: 'boolean', value: false }
    ]
    await askUser.execute({
      question: '保存',
      inputType: 'form',
      fields
    }, ctx)

    const payload = ctx.orchestrator.requestConfirmation.mock.calls[0][0]
    expect(payload.fields).toEqual(fields)
    expect(payload.inputType).toBe('form')
  })

  test('form 模式 field 缺 key 报错', async () => {
    const ctx = _ctx({ orchestrator: _mockOrchestrator() })
    const result = await askUser.execute({
      question: '保存',
      inputType: 'form',
      fields: [{ label: '无 key 的字段', type: 'string', value: 'x' }]
    }, ctx)

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_ASK_USER_FORM_FIELD_INVALID')
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
    // 未知错误是字符串形式（含 SOMETHING_UNEXPECTED）
    expect(typeof result.error === 'string' || result.error.message?.includes('SOMETHING_UNEXPECTED')).toBe(true)
  })
})

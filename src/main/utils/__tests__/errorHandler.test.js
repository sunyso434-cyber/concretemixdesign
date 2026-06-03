const eventBus = require('../../agent/EventBus')
const errorHandler = require('../errorHandler')

describe('errorHandler 4 级分类', () => {
  beforeEach(() => eventBus.clear())
  afterAll(() => eventBus.clear())

  test('fatal 应 emit error:fatal', () => {
    const cb = jest.fn()
    eventBus.on('error:fatal', cb)
    errorHandler.fatal('test_source', { message: 'fatal' })
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ errorSource: 'test_source' }))
  })

  test('error 应 emit error:<source>', () => {
    const cb = jest.fn()
    eventBus.on('error:llm', cb)
    errorHandler.error('llm', { message: 'fail' })
    expect(cb).toHaveBeenCalled()
  })

  test('warn 应 emit warn:<source>', () => {
    const cb = jest.fn()
    eventBus.on('warn:ui_notify', cb)
    errorHandler.warn('ui_notify', { message: 'wc destroyed' })
    expect(cb).toHaveBeenCalled()
  })

  test('silent 应不 emit 任何事件', () => {
    const cb = jest.fn()
    eventBus.on('error', cb)
    eventBus.on('warn', cb)
    errorHandler.silent('ui_notify', { message: 'silent' })
    expect(cb).not.toHaveBeenCalled()
  })

  test('errorSource 字段应存在', () => {
    const cb = jest.fn()
    eventBus.on('error:llm', cb)
    errorHandler.error('llm', { message: 'fail' })
    const callArg = cb.mock.calls[0][0]
    expect(callArg).toHaveProperty('errorSource', 'llm')
  })
})

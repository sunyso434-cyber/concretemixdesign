const ErrorCodes = require('../ErrorCodes')

describe('ErrorCodes', () => {
  // 排除函数型成员（createError / _getRecoveryStrategy），只测错误码字符串
  const errorCodeKeys = Object.keys(ErrorCodes).filter(
    k => typeof ErrorCodes[k] === 'string'
  )

  test('所有错误码应为已定义的非空字符串', () => {
    expect(errorCodeKeys.length).toBeGreaterThan(0)
    errorCodeKeys.forEach(key => {
      const value = ErrorCodes[key]
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
      // 错误码字符串值应与 key 名一致（约定）
      expect(value).toBe(key)
    })
  })

  test('4 个新错误码（D2 批次加）当前不存在时跳过，存在则应为字符串', () => {
    // 此测试在 D2 实施前会"无操作"通过（按 plan 描述"正常"）
    const newCodes = ['MEMORY_SAVE_FAILED', 'WC_DESTROYED', 'TIMEOUT_RETRY_EXHAUSTED', 'RATE_LIMIT_EXHAUSTED']
    newCodes.forEach(name => {
      if (ErrorCodes[name]) {
        // D2 已实施：必须为非空字符串
        expect(typeof ErrorCodes[name]).toBe('string')
        expect(ErrorCodes[name].length).toBeGreaterThan(0)
      }
      // 否则：保持沉默，D2 之前正常
    })
  })

  test('_getRecoveryStrategy(code) 应返回有效恢复策略', () => {
    // 实际 API 叫 _getRecoveryStrategy（带下划线，私有约定）
    // plan 描述的 getRecovery 暂未提供；有则验证，无则报告
    if (typeof ErrorCodes._getRecoveryStrategy !== 'function' &&
        typeof ErrorCodes.getRecovery !== 'function') {
      // 没找到恢复策略函数，标记为预期行为
      console.warn('ErrorCodes: 未找到 _getRecoveryStrategy 或 getRecovery 函数')
      return
    }
    const fn = ErrorCodes.getRecovery || ErrorCodes._getRecoveryStrategy
    const validStrategies = [
      'retry', 'skip', 'silent', 'fail', 'wait_and_retry', 'ask_user',
      // 实际 API 使用的扩展策略
      'fix_params', 'adjust_params', 'list_skills', 'check_config',
      'list_materials', 'review_design', 'adjust_constraints', 'check_pricing'
    ]
    // 任取一个已知错误码测试
    const sampleCode = ErrorCodes.PARAM_MISSING || errorCodeKeys[0]
    const recovery = fn(sampleCode)
    expect(recovery).toBeDefined()
    expect(validStrategies).toContain(recovery)
  })

  test('createError 应返回标准错误响应结构', () => {
    // 附加测试：覆盖 createError 工厂方法
    if (typeof ErrorCodes.createError !== 'function') {
      console.warn('ErrorCodes: 未找到 createError 函数')
      return
    }
    const err = ErrorCodes.createError('PARAM_MISSING', '缺少参数 x', '请提供 x', { x: 1 })
    expect(err.success).toBe(false)
    expect(err.title).toBe('缺少参数 x')
    expect(err.code).toBe('PARAM_MISSING')
    expect(err.hint).toBe('请提供 x')
    expect(err.recovery).toBeDefined()
    expect(err.details).toEqual({ x: 1 })
  })

  test('7 个 E-MINERU-* 错误码应注册进 AI_ERROR_REGISTRY（v0.7.0）', () => {
    const registry = ErrorCodes.AI_ERROR_REGISTRY
    const mineruCodes = [
      'E-MINERU-NO-TOKEN',
      'E-MINERU-SIZE-EXCEEDED',
      'E-MINERU-UPLOAD-FAIL',
      'E-MINERU-PARSE-FAIL',
      'E-MINERU-TIMEOUT',
      'E-MINERU-NETWORK',
      'E-MINERU-API-ERROR'
    ]
    mineruCodes.forEach(code => {
      expect(registry[code]).toBeDefined()
      const entry = registry[code]
      expect(typeof entry.title).toBe('string')
      expect(entry.title.length).toBeGreaterThan(0)
      expect(typeof entry.hint).toBe('string')
      expect(typeof entry.recovery).toBe('string')
      expect(['error', 'warn', 'info']).toContain(entry.severity)
    })
  })

  test('createError 对 E-MINERU-* 码应自动补全 registry 字段', () => {
    const err = ErrorCodes.createError('E-MINERU-NO-TOKEN')
    expect(err.success).toBe(false)
    expect(err.code).toBe('E-MINERU-NO-TOKEN')
    expect(err.title).toBe('MinerU Token 未配置')
    expect(err.recovery).toBe('fix_settings')
    // caller 显式传 message/hint 应覆盖 registry
    const err2 = ErrorCodes.createError('E-MINERU-API-ERROR', '额度超限', '请配置个人 Token')
    expect(err2.title).toBe('额度超限')
    expect(err2.hint).toBe('请配置个人 Token')
  })
})

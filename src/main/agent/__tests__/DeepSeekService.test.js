// src/main/agent/__tests__/DeepSeekService.test.js
const { Readable } = require('stream')
const DeepSeekService = require('../../services/DeepSeekService')

describe('DeepSeekService 配置', () => {
  let service
  let mockSystemService

  beforeEach(() => {
    mockSystemService = {
      getAgentConfig: jest.fn().mockResolvedValue({
        deepseekModel: 'deepseek-v4-pro',
        deepseekMaxTokens: 32768,
        deepseekTimeout: 120000,
        deepseekContextLimit: 800000,
        deepseekThinkingEnabled: true,
        agentMaxSteps: 20  // v1.2 字段名
      })
    }
    service = new DeepSeekService('test-api-key', mockSystemService)
  })

  describe('getAvailableModels', () => {
    test('返回可用模型列表', () => {
      const models = service.getAvailableModels()
      expect(models).toContain('deepseek-v4-flash')
      expect(models).toContain('deepseek-v4-pro')
    })
  })

  describe('clearConfigCache', () => {
    test('清掉本实例的 _config 缓存', async () => {
      // 第一次调用：填充缓存
      await service._getConfig()
      expect(service._configCache).not.toBeNull()

      // 清缓存
      service.clearConfigCache()
      expect(service._configCache).toBeNull()
    })
  })

  describe('_getConfig TTL（v1.1 修正：使用固定 baseTime）', () => {
    test('5 秒内重复调用不重读数据库', async () => {
      // v1.1 修正：先固定 baseTime，避免 Date.now() 被 mock 后基线漂移
      const baseTime = Date.now()
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(baseTime)

      // 第一次调用（t=0）
      await service._getConfig()
      expect(mockSystemService.getAgentConfig).toHaveBeenCalledTimes(1)

      // 4 秒后（t=4000）：仍用缓存
      dateSpy.mockReturnValue(baseTime + 4000)
      await service._getConfig()
      expect(mockSystemService.getAgentConfig).toHaveBeenCalledTimes(1)

      // 6 秒后（t=6000）：缓存过期，重读
      dateSpy.mockReturnValue(baseTime + 6000)
      await service._getConfig()
      expect(mockSystemService.getAgentConfig).toHaveBeenCalledTimes(2)

      dateSpy.mockRestore()
    })
  })

  // v1.2 修复验证：未注入 systemService 时 _getConfig 应使用共享常量 DEFAULT_AGENT_MAX_STEPS=200
  describe('_getConfig fallback（v1.2）', () => {
    test('未注入 systemService 时使用硬编码默认值（maxSteps=200，与 UnifiedStrategy 共享常量）', async () => {
      const svc = new DeepSeekService('test-api-key', null)
      const cfg = await svc._getConfig()
      expect(cfg.maxSteps).toBe(200)  // DEFAULT_AGENT_MAX_STEPS
      expect(cfg.model).toBe('deepseek-v4-flash')
      expect(cfg.maxTokens).toBe(32768)
      expect(cfg.contextLimit).toBe(800000)
      expect(cfg.thinkingEnabled).toBe(true)
    })

    test('systemService 返回的 config 含 maxSteps=15 时，maxSteps 透传 15', async () => {
      const customSystemService = {
        getAgentConfig: jest.fn().mockResolvedValue({
          deepseekModel: 'deepseek-v4-pro',
          deepseekMaxTokens: 16384,
          deepseekTimeout: 60000,
          deepseekContextLimit: 400000,
          deepseekThinkingEnabled: false,
          agentMaxSteps: 15
        })
      }
      const svc = new DeepSeekService('test-api-key', customSystemService)
      const cfg = await svc._getConfig()
      expect(cfg.maxSteps).toBe(15)  // agentMaxSteps 透传
      expect(cfg.model).toBe('deepseek-v4-pro')
    })
  })

  // v8.3.8: 网络错误码映射补全 + stream 响应体安全读取
  describe('_buildClassifiedError（v8.3.8 网络错误码 + stream 安全）', () => {
    test('ECONNRESET 应映射为 E-NET-500（核心修复：DeepSeek 服务端 TLS reset 走 llmNetwork 5 次熔断路径）', async () => {
      const err = new Error('read ECONNRESET')
      err.code = 'ECONNRESET'
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-NET-500')
      expect(classified.success).toBe(false)
      expect(classified.details.callSite).toBe('DeepSeekService.chat')
      expect(classified.details.httpStatus).toBeUndefined()
      expect(classified.details.rawMessage).toBe('read ECONNRESET')
    })

    test('ETIMEDOUT 应映射为 E-NET-500', async () => {
      const err = new Error('connect ETIMEDOUT')
      err.code = 'ETIMEDOUT'
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-NET-500')
    })

    test('ERR_NETWORK 应映射为 E-NET-500', async () => {
      const err = new Error('Network Error')
      err.code = 'ERR_NETWORK'
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-NET-500')
    })

    test('ENOTFOUND 仍映射为 E-NET-500（回归保护）', async () => {
      const err = new Error('getaddrinfo ENOTFOUND')
      err.code = 'ENOTFOUND'
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-NET-500')
    })

    test('ECONNREFUSED 仍映射为 E-NET-500（回归保护）', async () => {
      const err = new Error('connect ECONNREFUSED')
      err.code = 'ECONNREFUSED'
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-NET-500')
    })

    test('ECONNABORTED 仍映射为 E-NET-408（回归保护：超时专属）', async () => {
      const err = new Error('timeout of 120000ms exceeded')
      err.code = 'ECONNABORTED'
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-NET-408')
    })

    test('未知 code 仍兜底为 E-SYS-999（回归保护）', async () => {
      const err = new Error('weird thing')
      err.code = 'EGIBBERISH'
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-SYS-999')
    })

    test('HTTP 429 仍映射为 E-LLM-429（回归保护）', async () => {
      const err = new Error('Request failed with status code 429')
      err.response = { status: 429, data: { error: { message: 'rate limit' } } }
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-LLM-429')
      expect(classified.details.httpStatus).toBe(429)
      expect(classified.details.rawMessage).toBe('rate limit')
    })

    // 核心修复：stream 响应体不能 JSON.stringify（TLSSocket 循环引用）
    test('response.data 是 stream 时用 _readErrorBody 读取，不抛循环引用', async () => {
      const stream = Readable.from(['{"error":{"message":"rate limit exceeded"}}'])
      const err = new Error('Request failed with status code 429')
      err.response = { status: 429, data: stream }
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-LLM-429')
      expect(classified.details.rawMessage).toBe('rate limit exceeded')
    })

    test('response.data 是 stream 且内容非 JSON 时，rawMessage 退回到字符串本身', async () => {
      const stream = Readable.from(['plain text error body'])
      const err = new Error('Request failed with status code 500')
      err.response = { status: 500, data: stream }
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-LLM-500')
      expect(classified.details.rawMessage).toBe('plain text error body')
    })

    test('response.data 是 stream 但读取失败时，rawMessage 退回到 error.message', async () => {
      const stream = Readable.from([])  // 空 stream
      stream.destroy(new Error('stream read failed'))
      const err = new Error('socket hang up')
      err.code = 'ECONNRESET'
      err.response = { status: undefined, data: stream }
      const classified = await service._buildClassifiedError(err, 'DeepSeekService.chat')
      expect(classified.code).toBe('E-NET-500')
      // stream 读取失败 → rawMessage 用 error.message
      expect(classified.details.rawMessage).toBe('socket hang up')
    })
  })
})

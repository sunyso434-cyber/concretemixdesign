// src/main/agent/__tests__/DeepSeekService.test.js
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
      expect(service._config).not.toBeNull()

      // 清缓存
      service.clearConfigCache()
      expect(service._config).toBeNull()
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

  // v1.2 修复验证：未注入 systemService 时 _getConfig 应使用共享常量 DEFAULT_AGENT_MAX_STEPS=10
  describe('_getConfig fallback（v1.2）', () => {
    test('未注入 systemService 时使用硬编码默认值（maxSteps=10，与 UnifiedStrategy 共享常量）', async () => {
      const svc = new DeepSeekService('test-api-key', null)
      const cfg = await svc._getConfig()
      expect(cfg.maxSteps).toBe(10)  // DEFAULT_AGENT_MAX_STEPS
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
})

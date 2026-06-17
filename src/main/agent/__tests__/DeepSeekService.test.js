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
})

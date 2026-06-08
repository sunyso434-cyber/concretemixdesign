/**
 * Orchestrator.run 主路径集成测试
 *
 * 通过 Orchestrator.create() 入口跑通 UnifiedStrategy 主路径，
 * 验证外壳与 strategy 的接线正确。
 *
 * 跑法：
 *   npx jest src/main/agent/__tests__/Orchestrator.integration.test.js
 */

const Orchestrator = require('../Orchestrator')

describe('Orchestrator.run 集成测试', () => {
  let orch
  let mocks

  beforeEach(() => {
    mocks = {
      deepseekService: { chatWithToolsStream: jest.fn() },
      skillRegistry: { getSkill: jest.fn(), getToolSchemas: jest.fn(() => []) },
      skillExecutor: { execute: jest.fn() },
      agentMemoryService: {
        buildMemoryContext: jest.fn(async () => ''),
        buildHistoryMessages: jest.fn(async () => []),
        saveMessage: jest.fn(async () => {})
      }
    }
    orch = Orchestrator.create('unified', mocks)
  })

  test('主路径: 用户消息 → LLM → 直接返回', async () => {
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({ content: 'hi', tool_calls: null })
    const result = await orch.run({ sessionId: 's', message: 'hello' })
    expect(result.success).toBe(true)
  })

  test('主路径: 调工具 → 工具结果 → LLM 二次回复', async () => {
    const mockSkill = { name: 'q', parameters: {} }
    mocks.skillRegistry.getSkill.mockReturnValue(mockSkill)
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'r' })
    mocks.deepseekService.chatWithToolsStream
      .mockResolvedValueOnce({ content: null, tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }] })
      .mockResolvedValueOnce({ content: 'result' })

    const result = await orch.run({ sessionId: 's', message: 'q' })
    expect(result.success).toBe(true)
    expect(mocks.deepseekService.chatWithToolsStream).toHaveBeenCalledTimes(2)
  })
})

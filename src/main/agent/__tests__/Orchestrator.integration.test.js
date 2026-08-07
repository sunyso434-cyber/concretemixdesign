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
      skillRegistry: {
        getSkill: jest.fn(),
        getToolSchemas: jest.fn(() => []),
        // soft skill 接线修复后 Orchestrator 会构造 SoftSkillInjector，
        // 注入器在 tryActivate 时调用 listSoftSkills；这里没 soft skill，返回空数组即可
        listSoftSkills: jest.fn(() => []),
        getUserDir: jest.fn(() => null)
      },
      skillExecutor: { execute: jest.fn() },
      agentMemoryService: {
        buildAgentMdBlock: jest.fn(async () => ''),
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

  // v9.1.0 修复：attachments（图片附件）应透传到 strategy
  test('attachments 应透传到 strategy.execute', async () => {
    const att = [{ type: 'image', base64: 'data:image/png;base64,xxx', originalName: 'a.png' }]
    mocks.deepseekService.chatWithToolsStream.mockResolvedValue({ content: 'hi', tool_calls: null })

    // 探针：捕获 strategy.execute 收到的 input
    const origExecute = orch.strategy.execute.bind(orch.strategy)
    let capturedInput = null
    orch.strategy.execute = jest.fn(async (input) => {
      capturedInput = input
      return origExecute(input)
    })

    await orch.run({ sessionId: 's', message: 'hi', attachments: att })
    expect(capturedInput).toBeDefined()
    expect(capturedInput.attachments).toEqual(att)
  })
})

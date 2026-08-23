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

// mock 模式参照 UnifiedStrategy.steer.test.js（2026-08-23 修复）：
// UnifiedStrategy 主循环内部用 failover config 直接 new DeepSeekService(config)，
// 注入的 mocks.deepseekService.chatWithToolsStream 不会被调用——必须 mock 类本身，
// 否则真实 DeepSeekService 构造 HTTP 请求失败 → llmParse 计数超阈值 → max_failures_exceeded
let mockChat = null
let mockGetConfig = null
jest.mock('../../services/DeepSeekService', () => {
  return jest.fn().mockImplementation(function (config, sys) {
    return { config, systemService: sys, chatWithToolsStream: (...args) => mockChat(...args), _getConfig: (...args) => mockGetConfig(...args) }
  })
})
jest.mock('../../../shared/utils/contextStats', () => ({ estimateTokens: () => 1000 }))
// sqlite3 原生模块在非 Electron 环境加载即崩溃，mock db/database 规避（本项目测试不碰真实 DB）
jest.mock('../../db/database', () => ({}))

describe('Orchestrator.run 集成测试', () => {
  let orch
  let mocks

  beforeEach(() => {
    if (!mockChat) { mockChat = jest.fn(); mockGetConfig = jest.fn() }
    mockChat.mockReset()
    mockGetConfig.mockReset()
    mockGetConfig.mockResolvedValue({ maxSteps: 20, apiKey: 'sk-test', contextLimit: 200000 })
    mocks = {
      // 对齐 UnifiedStrategy.steer.test.js 的标准 mock：deepseekService._getConfig 提供
      // maxSteps/apiKey（缺失时配置读取失败会被计入 LLM 失败阈值 → max_failures_exceeded）
      deepseekService: {
        chatWithToolsStream: jest.fn(),
        _getConfig: jest.fn(async () => ({ maxSteps: 20, apiKey: 'sk-test' }))
      },
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
      },
      systemService: { getAgentConfig: jest.fn(async () => ({ messageTrimmerTokenBudget: 30000 })) }
    }
    orch = Orchestrator.create('unified', mocks)
  })

  test('主路径: 用户消息 → LLM → 直接返回', async () => {
    mockChat.mockResolvedValue({ content: 'hi', tool_calls: null })
    const result = await orch.run({ sessionId: 's', message: 'hello' })
    expect(result.success).toBe(true)
  })

  test('主路径: 调工具 → 工具结果 → LLM 二次回复', async () => {
    const mockSkill = { name: 'q', parameters: {} }
    mocks.skillRegistry.getSkill.mockReturnValue(mockSkill)
    mocks.skillExecutor.execute.mockResolvedValue({ success: true, data: 'r' })
    mockChat
      .mockResolvedValueOnce({ content: null, tool_calls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }] })
      .mockResolvedValueOnce({ content: 'result' })

    const result = await orch.run({ sessionId: 's', message: 'q' })
    expect(result.success).toBe(true)
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  // v9.1.0 修复：attachments（图片附件）应透传到 strategy
  test('attachments 应透传到 strategy.execute', async () => {
    const att = [{ type: 'image', base64: 'data:image/png;base64,xxx', originalName: 'a.png' }]
    mockChat.mockResolvedValue({ content: 'hi', tool_calls: null })

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

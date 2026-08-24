/**
 * UnifiedStrategy catalog 路由接线集成测试（技能目录式路由 · T5）
 *
 * 场景：
 * 1. catalog（默认）：首轮直调未加载业务技能 → 拦截自动展开 → 第二轮 tools 含该技能
 * 2. full：开关生效 → getRoutingToolSchemas 不被调用，直调直接执行
 *
 * mock 方式对齐 UnifiedStrategy.test.js（DeepSeekService 构造器 / contextStats / db/database）。
 */

// 捕获 buildSystemPrompt 收到的 renderMode（包装真实实现）
let mockCapturedRenderModes = []
jest.mock('../systemPromptBuilder', () => {
  const actual = jest.requireActual('../systemPromptBuilder')
  return {
    ...actual,
    buildSystemPrompt: (...args) => {
      const params = args[0] || {}
      mockCapturedRenderModes.push(params.renderMode)
      return actual.buildSystemPrompt(...args)
    }
  }
})

const UnifiedStrategy = require('../strategies/UnifiedStrategy')
const sessionLoadedSkills = require('../sessionLoadedSkills')

let mockChat = null
let mockGetConfig = null
jest.mock('../../services/DeepSeekService', () => {
  return jest.fn().mockImplementation(function (config, sys) {
    return {
      config,
      systemService: sys,
      chatWithToolsStream: (...args) => mockChat(...args),
      _getConfig: (...args) => mockGetConfig(...args)
    }
  })
})

let mockEstimateTokens
jest.mock('../../../shared/utils/contextStats', () => ({
  estimateTokens: (...args) => mockEstimateTokens(...args)
}))

jest.mock('../../db/database', () => ({}))

// 带路由能力的注册表 mock（对齐真实 SkillRegistry 的方法面）
function makeRoutedRegistry() {
  const baseSchemas = [{ type: 'function', function: { name: 'use_skill', description: '元工具' } }]
  return {
    getSkill: (name) => name === 'calculate_mix_design'
      ? { name: 'calculate_mix_design', description: '计算配合比', parameters: {}, execute: () => {} }
      : null,
    getToolSchemas: jest.fn(() => baseSchemas),
    // catalog 工厂：常驻(use_skill) + 已加载集合
    getRoutingToolSchemas: jest.fn((loadedNames) => baseSchemas.concat(
      Array.from(loadedNames || []).map(n => ({ type: 'function', function: { name: n, description: `已加载:${n}` } }))
    )),
    isResident: (name) => name === 'use_skill' || name.startsWith('workspace_'),
    getSkillSchema: (name) => ({ type: 'function', function: { name } }),
    getSkillMeta: (name) => ({
      name, description: `${name} 描述`, version: '1.0.0',
      category: name.startsWith('workspace_') ? 'workspace' : 'tool'
    })
  }
}

function toolCallOf(name) {
  return { id: `call_${name}`, function: { name, arguments: '{}' } }
}

describe('UnifiedStrategy catalog 路由接线', () => {
  beforeEach(() => {
    sessionLoadedSkills.reset()
    mockCapturedRenderModes = []
    mockEstimateTokens = jest.fn(() => 1000)
    mockChat = jest.fn()
    mockGetConfig = jest.fn()
  })

  test('catalog 默认：直调未加载技能被拦截自动展开，第二轮 tools 含该技能；renderMode=catalog', async () => {
    mockGetConfig.mockResolvedValue({ maxSteps: 20, apiKey: 'sk-test' })
    const registry = makeRoutedRegistry()

    mockChat
      .mockResolvedValueOnce({ content: null, tool_calls: [toolCallOf('calculate_mix_design')] })
      .mockResolvedValueOnce({ content: '任务完成', tool_calls: null })

    const strategy = new UnifiedStrategy({
      deepseekService: { chatWithToolsStream: mockChat, _getConfig: mockGetConfig },
      skillRegistry: registry,
      skillExecutor: { execute: jest.fn(async () => ({ success: true })) },
      agentMemoryService: {
        buildHistoryMessages: jest.fn(async () => []),
        saveMessage: jest.fn(async () => {})
      },
      systemService: { getAgentConfig: jest.fn(async () => ({ messageTrimmerTokenBudget: 30000 })) }
    })

    const result = await strategy.execute({ sessionId: 's-route', message: '算个配合比' })

    expect(result.success).toBe(true)
    // 首轮 tools 不含业务技能（只有常驻 use_skill）
    const firstTools = mockChat.mock.calls[0][1].map(s => s.function.name)
    expect(firstTools).toEqual(['use_skill'])
    // 第二轮 tools 含拦截登记的 calculate_mix_design
    const secondTools = mockChat.mock.calls[1][1].map(s => s.function.name)
    expect(secondTools).toContain('calculate_mix_design')
    // 会话登记生效；system prompt 收到 catalog 渲染指令
    expect(sessionLoadedSkills.has('s-route', 'calculate_mix_design')).toBe(true)
    expect(mockCapturedRenderModes[0]).toBe('catalog')
    // getToolSchemas 仅用于 skillNames 目录构建，不作为 tools 来源
    expect(registry.getRoutingToolSchemas).toHaveBeenCalled()
  })

  test("skillRoutingMode='full'：走旧全量行为，getRoutingToolSchemas 不被调用，renderMode=full", async () => {
    mockGetConfig.mockResolvedValue({ maxSteps: 20, apiKey: 'sk-test', skillRoutingMode: 'full' })
    const registry = makeRoutedRegistry()

    mockChat
      .mockResolvedValueOnce({ content: null, tool_calls: [toolCallOf('calculate_mix_design')] })
      .mockResolvedValueOnce({ content: '任务完成', tool_calls: null })

    const skillExecutor = { execute: jest.fn(async () => ({ success: true })) }
    const strategy = new UnifiedStrategy({
      deepseekService: { chatWithToolsStream: mockChat, _getConfig: mockGetConfig },
      skillRegistry: registry,
      skillExecutor,
      agentMemoryService: {
        buildHistoryMessages: jest.fn(async () => []),
        saveMessage: jest.fn(async () => {})
      },
      systemService: { getAgentConfig: jest.fn(async () => ({ messageTrimmerTokenBudget: 30000 })) }
    })

    const result = await strategy.execute({ sessionId: 's-route-2', message: '算个配合比' })

    expect(result.success).toBe(true)
    expect(registry.getRoutingToolSchemas).not.toHaveBeenCalled()
    // 未拦截：直接执行了技能（旧行为）
    expect(skillExecutor.execute).toHaveBeenCalledWith('calculate_mix_design', {}, expect.anything())
    // 两轮 tools 都来自 getToolSchemas 全量源
    for (const call of mockChat.mock.calls) {
      expect(call[1]).toBe(registry.getToolSchemas.mock.results[0].value)
    }
    expect(mockCapturedRenderModes[0]).toBe('full')
    expect(sessionLoadedSkills.has('s-route-2', 'calculate_mix_design')).toBe(false)
  })
})

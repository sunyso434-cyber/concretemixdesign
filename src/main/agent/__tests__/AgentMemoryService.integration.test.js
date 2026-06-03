/**
 * AgentMemoryService 集成测试（真实 SQLite）
 *
 * 验证两个关键流程：
 * 1. saveMessage 后能用 getHistory(sessionId) 找回（基础对话历史）
 * 2. TF-IDF 召回：C1 修复后 buildMemoryContext 把 queryContext 透传给
 *    findSimilarCorrections，相关 CorrectionRule 能被召回
 *
 * 关键点（与 plan 不同的实际 API）：
 * - AgentMemoryService 是单例导出（module.exports = new AgentMemoryService()），
 *   不接 {dbPath} 参数；通过 process.env.USER_DATA_PATH 隔离数据库文件
 * - 没有 getMessagesBySession 方法，实际是 getHistory(sessionId, options)
 * - saveCorrection 字段是 originalSuggestion / userCorrection / toolName
 *   （plan 写的 rightAnswer 是错的）
 *
 * 跑法：
 *   npx jest src/main/agent/__tests__/AgentMemoryService.integration.test.js
 */

// 必须在 require database 之前 mock electron（database.js 顶层会调 app.getPath）
const path = require('path')
const fs = require('fs')
const os = require('os')

// 准备临时 userData 目录（database.js 用 USER_DATA_PATH 拼 db 路径）
// 变量名以 mock 开头，jest.mock 工厂里才能引用
const mockTmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem-it-'))
process.env.USER_DATA_PATH = mockTmpUserData

jest.mock('electron', () => ({
  app: {
    getPath: () => mockTmpUserData
  }
}))

const { sequelize, syncModels } = require('../../db/database')
const AgentMemoryService = require('../../services/AgentMemoryService')

describe('AgentMemoryService 集成测试（真实 SQLite）', () => {
  // 测试结束统一关连接、删临时目录
  afterAll(async () => {
    try {
      await sequelize.close()
    } catch (e) {
      // 关闭失败不影响清理
    }
    try {
      fs.rmSync(mockTmpUserData, { recursive: true, force: true })
    } catch (e) {
      // 删不掉也不影响
    }
  })

  beforeAll(async () => {
    // 建表（包含 ChatHistory / UserPreference / CorrectionRule）
    await syncModels()
  })

  test('saveMessage 后能 getHistory 取回', async () => {
    const sessionId = 'it-s1-' + Date.now()

    await AgentMemoryService.saveMessage({
      sessionId,
      role: 'user',
      content: 'hello'
    })

    const messages = await AgentMemoryService.getHistory(sessionId)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('hello')
    expect(messages[0].role).toBe('user')
  })

  test('saveMessage 应存 toolCalls（assistant 调工具）', async () => {
    const sessionId = 'it-s2-' + Date.now()

    await AgentMemoryService.saveMessage({
      sessionId,
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', function: { name: 'x', arguments: '{}' } }]
    })

    const msgs = await AgentMemoryService.getHistory(sessionId)
    const m = msgs.find(x => x.role === 'assistant')
    expect(m).toBeDefined()
    expect(m.toolCalls).toBeDefined()
    expect(Array.isArray(m.toolCalls)).toBe(true)
    expect(m.toolCalls[0].id).toBe('c1')
    expect(m.toolCalls[0].function.name).toBe('x')
  })

  test('saveMessage 应存 toolCallId（tool 角色返回结果）', async () => {
    const sessionId = 'it-s3-' + Date.now()

    await AgentMemoryService.saveMessage({
      sessionId,
      role: 'tool',
      content: 'tool result',
      toolCallId: 'call_abc'
    })

    const msgs = await AgentMemoryService.getHistory(sessionId)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('tool')
    expect(msgs[0].toolCallId).toBe('call_abc')
    expect(msgs[0].content).toBe('tool result')
  })

  test('buildHistoryMessages 4 轮含 tool 调用能正确还原（H3 P1-4）', async () => {
    const sessionId = 'it-s4-' + Date.now()

    // 1) 用户问
    await AgentMemoryService.saveMessage({
      sessionId,
      role: 'user',
      content: 'u1'
    })
    // 2) assistant 调工具（空 content，带 toolCalls）
    await AgentMemoryService.saveMessage({
      sessionId,
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', function: { name: 'q', arguments: '{}' } }]
    })
    // 3) tool 返回结果
    await AgentMemoryService.saveMessage({
      sessionId,
      role: 'tool',
      content: 'result',
      toolCallId: 'c1'
    })
    // 4) assistant 最终回答
    await AgentMemoryService.saveMessage({
      sessionId,
      role: 'assistant',
      content: 'final'
    })

    const history = await AgentMemoryService.buildHistoryMessages(sessionId)

    // 关键断言：tool 消息必须保留且 tool_call_id 正确（OpenAI 格式下划线）
    expect(history).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'c1' })
    )
    // 关键断言：带 tool_calls 的 assistant 消息必须保留
    expect(history).toContainEqual(
      expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) })
    )
    // 关键断言：纯文本 assistant 也要保留
    expect(history).toContainEqual(
      expect.objectContaining({ role: 'assistant', content: 'final' })
    )
    // 关键断言：user 也要保留
    expect(history).toContainEqual(
      expect.objectContaining({ role: 'user', content: 'u1' })
    )
  })

  test('TF-IDF 召回（C1 修复后）：buildMemoryContext 接 queryContext 命中规则', async () => {
    // 写一条修正规则：context 含 material=42.5水泥
    await AgentMemoryService.saveCorrection({
      context: { material: '42.5水泥' },
      originalSuggestion: { strength: 'C30' },
      userCorrection: 'PO42.5',
      toolName: null
    })

    // 用相同 queryContext 触发 buildMemoryContext
    const ctx = await AgentMemoryService.buildMemoryContext('s1', {
      queryContext: { material: '42.5水泥' }
    })

    // 关键断言：PO42.5 必须出现在返回的上下文里（C1 修好后 TF-IDF 召回非 0）
    expect(ctx).toContain('PO42.5')
  })
})

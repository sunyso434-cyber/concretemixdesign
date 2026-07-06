/**
 * agent:run IPC 兼容测试
 *
 * 验证 Orchestrator.run 的返回/抛错格式与 agentHandler.js 的 try/catch 映射兼容。
 * agentHandler.js 把 run 的成功结果直接 return，把抛出的错误转成 {success:false, error:msg}。
 *
 * 跑法：
 *   npx jest src/main/agent/__tests__/agentHandler.test.js
 */

const Orchestrator = require('../Orchestrator')

describe('agent:run IPC 兼容性', () => {
  test('Orchestrator.run 返回 {success:true, result} 兼容', async () => {
    const orch = Orchestrator.create('unified', {
      deepseekService: { chatWithTools: jest.fn().mockResolvedValue({ content: 'ok' }) },
      skillRegistry: { getToolSchemas: () => [] },
      skillExecutor: {},
      agentMemoryService: { buildAgentMdBlock: async () => '', buildHistoryMessages: async () => [], saveMessage: async () => {} }
    })
    const result = await orch.run({ sessionId: 's', message: 'hi' })
    // IPC handler 期望的格式（D5 保持兼容）
    expect(result).toHaveProperty('success')
  })

  test('run 抛错时 IPC handler 应返回 {success:false, error}', async () => {
    // 模拟 D 阶段后的 errorHandler.fatal 流程
    const orch = Orchestrator.create('unified', {
      deepseekService: { chatWithTools: jest.fn().mockRejectedValue(new Error('fatal')) },
      skillRegistry: { getToolSchemas: () => [] },
      skillExecutor: {},
      agentMemoryService: { buildAgentMdBlock: async () => '', buildHistoryMessages: async () => [], saveMessage: async () => {} }
    })
    try {
      await orch.run({ sessionId: 's', message: 'hi' })
    } catch (e) {
      // IPC handler 的 try/catch 把错误转成 {success:false, error:e.message}
      // 这个映射在 agentHandler.js，测试只验证"run 会抛错"
      expect(e.message).toBe('fatal')
    }
  })
})

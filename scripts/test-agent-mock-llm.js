/**
 * Manual 端到端测试：mock LLM → Orchestrator → 工具执行 → DB 写回
 *
 * 解决 P2-5：原 13 个 manual 脚本无 agent 覆盖
 */

const Orchestrator = require('../src/main/agent/Orchestrator')

async function main() {
  console.log('[test-agent-mock-llm] 启动...')

  // 1. mock LLM：第一次返 tool_call，第二次返最终内容
  const deepseekService = {
    chatWithTools: async ({ messages }) => {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === 'user') {
        return {
          content: null,
          tool_calls: [
            { id: 'c1', function: { name: 'query_material', arguments: '{}' } }
          ]
        }
      }
      if (lastMsg.role === 'tool') {
        return { content: '查询结果：42.5水泥', tool_calls: null }
      }
      return { content: 'OK', tool_calls: null }
    }
  }

  // 2. mock 技能注册表与执行器
  const skillRegistry = {
    getSkill: name => ({ name, parameters: {} }),
    getToolSchemas: () => []
  }
  const skillExecutor = {
    execute: async (_skill, _args, _sessionId) => ({ success: true, data: 'mock result' })
  }

  // 3. mock 记忆服务
  const agentMemoryService = {
    buildMemoryContext: async () => '',
    buildHistoryMessages: async () => [],
    saveMessage: async msg => console.log('[memory] save:', msg.role, (msg.content || '').slice(0, 30))
  }

  // 4. 跑编排
  const orch = Orchestrator.create('unified', {
    deepseekService,
    skillRegistry,
    skillExecutor,
    agentMemoryService
  })

  const result = await orch.run({ sessionId: 'test', message: '查询 42.5 水泥' })

  console.log('[test-agent-mock-llm] 结果:', JSON.stringify(result))

  if (!result.success) {
    console.error('[test-agent-mock-llm] 失败')
    process.exit(1)
  }

  if (result.content !== '查询结果：42.5水泥') {
    console.error('[test-agent-mock-llm] 内容不符合预期，实际:', result.content)
    process.exit(1)
  }

  console.log('[test-agent-mock-llm] PASS')
}

main().catch(e => {
  console.error('[test-agent-mock-llm] 异常:', e)
  process.exit(1)
})

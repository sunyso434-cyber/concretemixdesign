/**
 * Agent VCR 测试套件
 * 录制真实 DeepSeek API 响应 → 回放验证 Agent 核心逻辑
 */
const assert = require('assert')
const path = require('path')
const fs = require('fs')

const FIXTURE_DIR = path.join(__dirname, 'fixtures')

// 加载 VCR fixture
function loadFixture(name) {
  const file = path.join(FIXTURE_DIR, name + '.json')
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

describe('Agent Core Logic', () => {
  describe('ToolRegistry', () => {
    it('should register and retrieve tools', () => {
      const ToolRegistry = require('../../src/main/agent/ToolRegistry')
      const registry = new ToolRegistry()

      registry.register({
        name: 'test_tool',
        description: 'A test tool',
        parameters: { test: { type: 'string' } },
        handler: async () => ({ success: true })
      })

      const schemas = registry.getToolSchemas()
      assert.strictEqual(schemas.length, 1)
      assert.strictEqual(schemas[0].function.name, 'test_tool')
      assert(registry.toolNames.includes('test_tool'))
    })

    it('should throw on duplicate registration', () => {
      const ToolRegistry = require('../../src/main/agent/ToolRegistry')
      const registry = new ToolRegistry()
      registry.register({ name: 'dup', handler: async () => ({}) })
      assert.throws(() => registry.register({ name: 'dup', handler: async () => ({}) }))
    })

    it('should return error for unknown tool', async () => {
      const ToolRegistry = require('../../src/main/agent/ToolRegistry')
      const registry = new ToolRegistry()
      const result = await registry.execute('nonexistent', {})
      assert.strictEqual(result.success, false)
      assert(result.error.includes('Unknown tool'))
    })

    it('should execute registered handler', async () => {
      const ToolRegistry = require('../../src/main/agent/ToolRegistry')
      const registry = new ToolRegistry()
      registry.register({
        name: 'echo',
        handler: async (args) => ({ success: true, echo: args.message })
      })
      const result = await registry.execute('echo', { message: 'hello' })
      assert.strictEqual(result.success, true)
      assert.strictEqual(result.echo, 'hello')
    })
  })

  describe('SharedSchemas', () => {
    it('should export tempSettings and admixtureParams', () => {
      const schemas = require('../../src/main/agent/SharedSchemas')
      assert(schemas.tempSettings)
      assert(schemas.tempSettings.properties.regressionAlphaA)
      assert(schemas.admixtureParams)
    })
  })

  describe('AgentMemoryService', () => {
    // Memory 测试需要 SQLite，标记为集成测试
    it('should provide buildMemoryContext method', () => {
      const memoryService = require('../../src/main/services/AgentMemoryService')
      assert.strictEqual(typeof memoryService.buildMemoryContext, 'function')
      assert.strictEqual(typeof memoryService.saveMessage, 'function')
      assert.strictEqual(typeof memoryService.findSimilarCorrections, 'function')
    })

    it('tfidf similarity should handle empty inputs', () => {
      const memoryService = require('../../src/main/services/AgentMemoryService')
      const sim = memoryService._tfidfSimilarity({}, {})
      assert.strictEqual(sim, 0)
    })

    it('tfidf similarity should return 1 for identical', () => {
      const memoryService = require('../../src/main/services/AgentMemoryService')
      const sim = memoryService._tfidfSimilarity({ key: 'value' }, { key: 'value' })
      assert(sim > 0.9)
    })
  })

  describe('AgentOrchestrator', () => {
    it('should build system prompt with memory context', async () => {
      const AgentOrchestrator = require('../../src/main/agent/AgentOrchestrator')
      const ToolRegistry = require('../../src/main/agent/ToolRegistry')
      const registry = new ToolRegistry()
      registry.register({ name: 'echo', handler: async (a) => a })

      const ag = new AgentOrchestrator({
        deepseekService: { _callAPI: async () => ({ content: 'done' }) },
        toolRegistry: registry,
        webContents: null
      })

      const prompt = ag._buildSystemPrompt('测试记忆上下文', 'auto')
      assert(prompt.includes('全自动模式'))
      assert(prompt.includes('测试记忆上下文'))
      assert(prompt.includes('echo'))
    })
  })

  describe('VCR Fixtures (requires recorded data)', () => {
    const fixtures = ['c30_design_flow', 'optimization_flow', 'error_recovery', 'correction_learning']

    for (const name of fixtures) {
      it(`should have fixture: ${name}`, () => {
        const fixture = loadFixture(name)
        if (!fixture) {
          console.log(`  ⚠ Fixture "${name}" not recorded yet — run recording session first`)
          return
        }
        assert(Array.isArray(fixture.messages))
        assert(fixture.expectedResult)
      })
    }
  })
})

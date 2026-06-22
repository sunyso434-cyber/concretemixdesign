/**
 * diagnose-real.js
 * 老板应用真实场景诊断：
 *   1. 用老板数据库里的 systemService 真实配置
 *   2. 用 SkillRegistry 真实 21+7 个 skill schema
 *   3. 用 systemPromptBuilder 构造真实 system prompt
 *   4. 调真实 chatWithToolsStream，看具体错误
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

async function getApiKeyFromDb() {
  const initSqlJs = require('sql.js')
  const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'concrete-mixdesign', 'concrete-mixdesign.db')
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  const result = db.exec("SELECT paramValue FROM systemParams WHERE paramName = 'deepseekApiKey'")
  db.close()
  return result[0].values[0][0]
}

// Mock 一个 systemService，只实现 getAgentConfig 用 sql.js 读真实数据
function createMockSystemService() {
  const initSqlJs = require('sql.js')
  const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'concrete-mixdesign', 'concrete-mixdesign.db')
  
  return {
    async getAgentConfig() {
      const SQL = await initSqlJs()
      const db = new SQL.Database(fs.readFileSync(DB_PATH))
      const result = db.exec("SELECT paramName, paramValue FROM systemParams")
      const rows = result[0]?.values || []
      db.close()
      
      const params = {}
      for (const [k, v] of rows) params[k] = v
      
      const strVal = (key, def) => params[key] ? String(params[key]) : def
      const numVal = (key, def) => {
        if (!params[key]) return def
        const n = Number(params[key])
        return Number.isFinite(n) ? n : def
      }
      const boolVal = (key, def) => {
        if (!params[key]) return def
        const v = String(params[key]).toLowerCase()
        return v === 'true' || v === '1' || v === 'yes'
      }
      
      return {
        deepseekModel: strVal('deepseekModel', 'deepseek-v4-flash'),
        deepseekMaxTokens: numVal('deepseekMaxTokens', 32768),
        deepseekTimeout: numVal('deepseekTimeout', 120000),
        deepseekContextLimit: numVal('deepseekContextLimit', 800000),
        deepseekThinkingEnabled: boolVal('deepseekThinkingEnabled', true),
        agentMaxSteps: numVal('agentMaxSteps', 10),
        agentMaxConsecutiveFailures: numVal('agentMaxConsecutiveFailures', 2),
        agentRateLimitBaseMs: numVal('agentRateLimitBaseMs', 5000),
        agentRateLimitMaxMs: numVal('agentRateLimitMaxMs', 30000),
        agentConfirmationTimeoutMs: numVal('agentConfirmationTimeoutMs', 120000),
        skillCacheMaxAgeMs: numVal('skillCacheMaxAgeMs', 7 * 24 * 60 * 60 * 1000),
        skillCacheMaxSize: numVal('skillCacheMaxSize', 1000),
        skillCacheEvictRatio: numVal('skillCacheEvictRatio', 0.1),
        messageTrimmerTokenBudget: numVal('messageTrimmerTokenBudget', 30000)
      }
    }
  }
}

async function main() {
  const apiKey = await getApiKeyFromDb()
  console.log(`✅ API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}\n`)
  
  const DeepSeekService = require('../src/main/services/DeepSeekService.js')
  const systemService = createMockSystemService()
  const ds = new DeepSeekService(apiKey, systemService)
  
  const cfg = await ds._getConfig()
  console.log('老板真实配置:')
  console.log(JSON.stringify(cfg, null, 2))
  console.log('')
  
  // 模拟老板的真实 system prompt（包含 workspace 工具说明 + 5 类报告 Skill 矩阵）
  const skillNames = [
    'compare_materials', 'check_compliance', 'query_compliance_check',
    'optimize_mix_cost', 'create_skill', 'query_design_history',
    'list_available_materials', 'calculate_mix_design', 'run_parameter_diagnosis',
    'predict_performance', 'prepare_sales_quote_draft', 'calculate_sales_quote',
    'save_mix_design', 'save_sales_quote', 'save_to_basic_mix_library',
    'manage_skills', 'list_standards', 'query_standards',
    'concrete_innovation_brainstorm', 'my_custom_tool', 'material_query',
    'workspace.search', 'workspace.readPage', 'workspace.ingest',
    'workspace.writeFile', 'workspace.listFiles', 'workspace.lint', 'workspace.searchGraph'
  ]
  
  const { buildSystemPrompt } = require('../src/main/agent/systemPromptBuilder.js')
  const systemPrompt = buildSystemPrompt({
    memoryContext: '',
    skillNames,
    agentMdRules: fs.readFileSync(path.join(os.homedir(), '.concrete-mixdesign', 'agent.md'), 'utf-8')
  })
  
  console.log(`真实 system prompt 长度: ${systemPrompt.length} 字符`)
  console.log(`估算 tokens: ${Math.ceil(systemPrompt.length / 2)}\n`)
  
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '你好' }
  ]
  
  // 用 18+ 个真实 skill schema
  const tools = ds.getAvailableModels ? null : null  // dummy
  const registryTools = []  // 暂用空列表
  
  console.log('─── 调 chatWithToolsStream（真实配置 + 真实 system prompt）───')
  const startTime = Date.now()
  try {
    const response = await ds.chatWithToolsStream(messages, [], () => {})
    const elapsed = Date.now() - startTime
    console.log(`\n✅ 成功，耗时 ${elapsed}ms`)
    console.log(`content 长度: ${(response.content || '').length}`)
    console.log(`reasoning_content 长度: ${(response.reasoning_content || '').length}`)
  } catch (err) {
    const elapsed = Date.now() - startTime
    console.log(`\n❌ 失败，耗时 ${elapsed}ms`)
    console.log('─── 错误详情 ───')
    console.log('err.message:', err.message)
    console.log('err.status:', err.status)
    console.log('err.code:', err.code)
    console.log('err.response?.status:', err.response?.status)
    console.log('err.response?.data:', JSON.stringify(err.response?.data).slice(0, 500))
    console.log('err.stack:', err.stack?.slice(0, 1500))
  }
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})

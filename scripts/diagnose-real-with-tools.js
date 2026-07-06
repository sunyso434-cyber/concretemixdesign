/**
 * diagnose-real-with-tools.js
 * 用老板真实配置 + 真实 system prompt + 28 个 tool schema 复现
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

function createMockSystemService() {
  const initSqlJs = require('sql.js')
  const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'concrete-mixdesign', 'concrete-mixdesign.db')
  return {
    async getAgentConfig() {
      const SQL = await initSqlJs()
      const db = new SQL.Database(fs.readFileSync(DB_PATH))
      const result = db.exec("SELECT paramName, paramValue FROM systemParams")
      const rows = result[0] && result[0].values || []
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

const all28Tools = [
  { type: 'function', function: { name: 'check_compliance', description: '检查配合比是否合规', parameters: { type: 'object', properties: { mixDesignId: { type: 'integer' } }, required: ['mixDesignId'] } } },
  { type: 'function', function: { name: 'query_compliance_check', description: '查询合规检查结果', parameters: { type: 'object', properties: { checkId: { type: 'integer' } }, required: ['checkId'] } } },
  { type: 'function', function: { name: 'optimize_mix_cost', description: '网格搜索找出最低成本方案', parameters: { type: 'object', properties: { strength: { type: 'string' }, cementId: { type: 'integer' }, sandIds: { type: 'array' }, stoneIds: { type: 'array' } }, required: ['strength', 'cementId', 'sandIds', 'stoneIds'] } } },
  { type: 'function', function: { name: 'create_skill', description: '创建一个自定义技能', parameters: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' } }, required: ['name', 'code'] } } },
  { type: 'function', function: { name: 'query_design_history', description: '查询历史配合比设计', parameters: { type: 'object', properties: { limit: { type: 'integer' } }, required: [] } } },
  { type: 'function', function: { name: 'list_available_materials', description: '查询材料库可用原材料', parameters: { type: 'object', properties: { type: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'calculate_mix_design', description: '计算混凝土配合比', parameters: { type: 'object', properties: { strength: { type: 'string' }, slump: { type: 'number' }, cementId: { type: 'integer' }, sandIds: { type: 'array' }, stoneIds: { type: 'array' } }, required: ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds'] } } },
  { type: 'function', function: { name: 'predict_performance', description: '预测混凝土性能', parameters: { type: 'object', properties: { mixDesignId: { type: 'integer' } }, required: ['mixDesignId'] } } },
  { type: 'function', function: { name: 'prepare_sales_quote_draft', description: '准备销售报价草稿', parameters: { type: 'object', properties: { mixDesignId: { type: 'integer' } }, required: ['mixDesignId'] } } },
  { type: 'function', function: { name: 'calculate_sales_quote', description: '计算销售报价', parameters: { type: 'object', properties: { mixDesignId: { type: 'integer' }, profitRate: { type: 'number' } }, required: ['mixDesignId'] } } },
  { type: 'function', function: { name: 'save_mix_design', description: '保存配合比设计', parameters: { type: 'object', properties: { design: { type: 'object' } }, required: ['design'] } } },
  { type: 'function', function: { name: 'save_sales_quote', description: '保存销售报价', parameters: { type: 'object', properties: { quote: { type: 'object' } }, required: ['quote'] } } },
  { type: 'function', function: { name: 'save_to_basic_mix_library', description: '保存到基本配合比库', parameters: { type: 'object', properties: { mixDesignId: { type: 'integer' } }, required: ['mixDesignId'] } } },
  { type: 'function', function: { name: 'manage_skills', description: '管理技能', parameters: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'list_standards', description: '列出规范', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'query_standards', description: '查询规范', parameters: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] } } },
  { type: 'function', function: { name: 'concrete_innovation_brainstorm', description: '混凝土创新头脑风暴', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } } },
  { type: 'function', function: { name: 'my_custom_tool', description: '用户自定义工具', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'material_query', description: '材料查询', parameters: { type: 'object', properties: { name: { type: 'string' } } } } },
  { type: 'function', function: { name: 'workspace_search', description: '搜索工作区', parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'integer' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'workspace_readPage', description: '读 wiki 页', parameters: { type: 'object', properties: { wikiPath: { type: 'string' } }, required: ['wikiPath'] } } },
  { type: 'function', function: { name: 'workspace_ingest', description: '入库文件', parameters: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] } } },
  { type: 'function', function: { name: 'workspace_writeFile', description: '写文件到工作区', parameters: { type: 'object', properties: { type: { type: 'string' }, filename: { type: 'string' }, payload: { type: 'object' } }, required: ['type', 'filename', 'payload'] } } },
  { type: 'function', function: { name: 'workspace_listFiles', description: '列工作区文件', parameters: { type: 'object', properties: { subdir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'workspace_lint', description: '工作区健康检查', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'workspace_searchGraph', description: '查询知识图谱', parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'integer' } }, required: ['query'] } } }
]

async function main() {
  const apiKey = await getApiKeyFromDb()
  console.log('API Key:', apiKey.slice(0, 8) + '...' + apiKey.slice(-4))
  console.log('28 个 tool schema 已加载')
  console.log('')

  const DeepSeekService = require('../src/main/services/DeepSeekService.js')
  const systemService = createMockSystemService()
  const ds = new DeepSeekService(apiKey, systemService)

  const cfg = await ds._getConfig()
  console.log('老板真实配置: model=' + cfg.model + ', thinkingEnabled=' + cfg.thinkingEnabled + ', maxTokens=' + cfg.maxTokens)
  console.log('')

  const skillNames = all28Tools.map(t => t.function.name)
  const { buildSystemPrompt } = require('../src/main/agent/systemPromptBuilder.js')
  const systemPrompt = buildSystemPrompt({
    memoryContext: '',
    skillNames,
    agentMdRules: fs.readFileSync(path.join(os.homedir(), '.concrete-mixdesign', 'agent.md'), 'utf-8')
  })

  console.log('System prompt: ' + systemPrompt.length + ' 字符 (~' + Math.ceil(systemPrompt.length / 2) + ' tokens)')
  console.log('Tools: ' + all28Tools.length + ' 个')
  console.log('')

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '你好' }
  ]

  console.log('--- 调 chatWithToolsStream（28 tool + 真实 system prompt）---')
  const startTime = Date.now()
  try {
    const response = await ds.chatWithToolsStream(messages, all28Tools, () => {})
    const elapsed = Date.now() - startTime
    console.log('')
    console.log('SUCCESS，耗时 ' + elapsed + 'ms')
    console.log('content 长度: ' + (response.content || '').length)
    console.log('reasoning_content 长度: ' + (response.reasoning_content || '').length)
    console.log('tool_calls 数量: ' + (response.tool_calls || []).length)
    if (response.content) {
      console.log('content 前 200 字: ' + response.content.slice(0, 200))
    }
  } catch (err) {
    const elapsed = Date.now() - startTime
    console.log('')
    console.log('FAILED，耗时 ' + elapsed + 'ms')
    console.log('--- 错误详情 ---')
    console.log('err.message:', err.message)
    console.log('err.status:', err.status)
    console.log('err.code:', err.code)
    console.log('err.response?.status:', err.response && err.response.status)
    console.log('err.response?.data:', JSON.stringify(err.response && err.response.data).slice(0, 800))
    console.log('err.stack:', err.stack && err.stack.slice(0, 1500))
  }
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
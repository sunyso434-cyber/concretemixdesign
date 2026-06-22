/**
 * verify-streaming.js
 * 100% 复现老板的真实场景：直接调 DeepSeekService.chatWithToolsStream
 *
 * 关键差异：本脚本用流式（stream: true），且通过 DeepSeekService 实例化
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

// 加载 sql.js 读老板数据库的 API Key
async function getApiKeyFromDb() {
  const initSqlJs = require('sql.js')
  const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'concrete-mixdesign', 'concrete-mixdesign.db')
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  const result = db.exec("SELECT paramValue FROM systemParams WHERE paramName = 'deepseekApiKey'")
  db.close()
  if (!result.length || !result[0].values.length) {
    throw new Error(`数据库里没找到 deepseekApiKey: ${DB_PATH}`)
  }
  return result[0].values[0][0]
}

async function main() {
  const apiKey = await getApiKeyFromDb()
  console.log(`✅ API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}\n`)

  // 直接 require DeepSeekService，绕过 Electron
  const DeepSeekService = require('../src/main/services/DeepSeekService.js')
  const ds = new DeepSeekService(apiKey, null)  // systemService=null 用硬编码默认

  console.log('─── 读取配置（用 systemService=null 走默认分支）───')
  const cfg = await ds._getConfig()
  console.log('配置:', JSON.stringify(cfg, null, 2))
  console.log('')

  // 老板实际的 system prompt 是大段（包含 5 类报告 + workspace 工具说明）
  // 这里用一个能代表真实的 system prompt 长度
  const longSystemPrompt = `你是混凝土配合比设计专家，名字叫"智能设计助手"。
请严格按以下规则回复用户：
1. 优先调用工具，不要直接给答案
2. 配合比类问题必须调 calculate_mix_design
3. 优化类问题必须调 optimize_mix_cost
4. 对比类问题必须调 compare_materials
5. 诊断类问题必须调 diagnose_mix_issue
6. 报价类问题必须调 prepare_quote_draft
7. 工具结果用中文回复用户
8. 不确定时主动问用户
`.repeat(20)  // 重复 20 次模拟真实长度

  console.log(`System prompt 长度: ${longSystemPrompt.length} 字符\n`)

  const messages = [
    { role: 'system', content: longSystemPrompt },
    { role: 'user', content: '你好' }
  ]

  // 用 18 个 skill schema 中最关键的 5 个作为工具
  const tools = [
    {
      type: 'function',
      function: {
        name: 'list_available_materials',
        description: '查询材料库中可用的原材料列表',
        parameters: { type: 'object', properties: { type: { type: 'string', description: '材料类型筛选' } }, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'calculate_mix_design',
        description: '根据给定参数计算混凝土配合比',
        parameters: {
          type: 'object',
          properties: {
            strength: { type: 'string', description: '强度等级' },
            slump: { type: 'number', description: '坍落度(mm)' },
            cementId: { type: 'integer' },
            sandIds: { type: 'array', items: { type: 'integer' } },
            stoneIds: { type: 'array', items: { type: 'integer' } }
          },
          required: ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
        }
      }
    }
  ]

  console.log('─── 调用 chatWithToolsStream（流式 + 工具 + 老板真实配置）───')
  const startTime = Date.now()
  try {
    const response = await ds.chatWithToolsStream(messages, tools, (event) => {
      // 实时打印事件
      if (event.type === 'reasoning_delta') {
        process.stdout.write(`[思考] ${event.content.slice(0, 30)}...`)
      } else if (event.type === 'text_delta') {
        process.stdout.write(`[文本] ${event.content}`)
      }
    })
    const elapsed = Date.now() - startTime
    console.log(`\n\n✅ 流式调用成功，耗时 ${elapsed}ms`)
    console.log('─── 响应对象 ───')
    console.log('role:', response.role)
    console.log('content 长度:', (response.content || '').length)
    console.log('reasoning_content 长度:', (response.reasoning_content || '').length)
    console.log('tool_calls 数量:', (response.tool_calls || []).length)
    console.log('content 前 200 字:', (response.content || '').slice(0, 200))
  } catch (err) {
    const elapsed = Date.now() - startTime
    console.log(`\n\n❌ 流式调用抛错，耗时 ${elapsed}ms`)
    console.log('─── 错误详情 ───')
    console.log('err.message:', err.message)
    console.log('err.status:', err.status)
    console.log('err.code:', err.code)
    console.log('err.response?.status:', err.response?.status)
    console.log('err.response?.data:', JSON.stringify(err.response?.data).slice(0, 500))
    console.log('err.stack:', err.stack?.slice(0, 800))
  }
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
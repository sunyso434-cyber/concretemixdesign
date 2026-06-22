/**
 * verify-thinking-conflict.js
 * 验证根因假设：deepseek-v4-flash + thinking enabled 是否冲突
 *
 * 用法：
 *   1. 关闭 Electron 应用（避免数据库锁）
 *   2. node scripts/verify-thinking-conflict.js
 *
 * 脚本会从老板数据库读取 API Key（不硬编码），跑 3 个测试：
 *   - 测试 1：deepseek-v4-flash + thinking enabled  （当前 bug 配置）
 *   - 测试 2：deepseek-v4-flash + thinking disabled （正确配置）
 *   - 测试 3：deepseek-v4-pro + thinking enabled   （老板之前用的配置）
 */

const path = require('path')
const os = require('os')
const axios = require('axios')

// 老板的数据库路径
const DB_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'concrete-mixdesign', 'concrete-mixdesign.db')

async function getApiKeyFromDb() {
  // 用 sql.js 直接读 SQLite（不依赖 Electron 的 sequelize）
  const initSqlJs = require('sql.js')
  const fs = require('fs')
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  const result = db.exec("SELECT paramValue FROM systemParams WHERE paramName = 'deepseekApiKey'")
  db.close()
  if (!result.length || !result[0].values.length) {
    throw new Error(`数据库里没找到 deepseekApiKey: ${DB_PATH}`)
  }
  return result[0].values[0][0]
}

async function callDeepSeek(apiKey, body) {
  try {
    const res = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 30000
      }
    )
    return { ok: true, status: res.status, data: res.data }
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  验证根因：deepseek-v4-flash + thinking enabled 是否冲突')
  console.log('═══════════════════════════════════════════════════════\n')

  let apiKey
  try {
    apiKey = await getApiKeyFromDb()
    console.log(`✅ 从数据库读到 API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}\n`)
  } catch (e) {
    console.error(`❌ 读取数据库失败: ${e.message}`)
    console.error(`   请确认数据库路径: ${DB_PATH}`)
    console.error(`   请确认 Electron 应用已关闭（避免数据库锁）`)
    process.exit(1)
  }

  // 老板应用的真实配置：max_tokens=32768，stream=true
  const realMessage = '帮我设计C30配合比，坍落度180mm'

  const cases = [
    {
      name: '测试A: deepseek-v4-flash + thinking enabled + max_tokens=32768 + 非流式（老板当前配置）',
      body: { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: realMessage }], max_tokens: 32768, thinking: { type: 'enabled' } }
    },
    {
      name: '测试B: deepseek-v4-flash + thinking disabled + max_tokens=32768 + 非流式',
      body: { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: realMessage }], max_tokens: 32768, thinking: { type: 'disabled' } }
    },
    {
      name: '测试C: deepseek-v4-pro + thinking enabled + max_tokens=32768 + 非流式（老板之前用的）',
      body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: realMessage }], max_tokens: 32768, thinking: { type: 'enabled' } }
    }
  ]

  for (const c of cases) {
    console.log(`\n─── ${c.name} ───`)
    console.log(`请求: ${JSON.stringify(c.body).slice(0, 200)}...`)
    const r = await callDeepSeek(apiKey, c.body)
    if (r.ok) {
      const choice = r.data.choices?.[0]
      const msg = choice?.message || {}
      console.log(`✅ HTTP ${r.status}`)
      console.log(`   finish_reason: ${choice?.finish_reason}`)
      console.log(`   content 长度: ${(msg.content || '').length}`)
      console.log(`   reasoning_content 长度: ${(msg.reasoning_content || '').length}`)
      console.log(`   tool_calls 数量: ${(msg.tool_calls || []).length}`)
      console.log(`   content 前 100 字: ${(msg.content || '').slice(0, 100)}`)
      console.log(`   usage: ${JSON.stringify(r.data.usage)}`)
    } else {
      console.log(`❌ HTTP ${r.status || 'NO_STATUS'}`)
      console.log(`   错误: ${JSON.stringify(r.data).slice(0, 500) || r.message}`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  结论分析（关注 finish_reason 和 content/reasoning_content）：')
  console.log('  - 如果 content 长度=0 且 finish_reason="length"，说明 max_tokens 全给思考用')
  console.log('  - 如果 finish_reason="tool_calls"，说明 LLM 想调工具但没调成功')
  console.log('  - 如果 finish_reason="stop"，说明 LLM 正常回答')
  console.log('═══════════════════════════════════════════════════════')
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
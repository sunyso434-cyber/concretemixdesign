/**
 * repro-session-zj39.js
 * 复现老板的 bug：session-1782119952474-zj39 聊两轮就报 "AI连续响应失败"
 *
 * 策略：
 *   场景 1 (基线)：只发当前 user 消息，不带历史 → 应成功
 *   场景 2 (复现)：带完整历史 → 看具体 API 错误
 *   场景 3 (降级)：带前 1 轮 user/assistant → 验证是哪条历史触发的
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const TARGET_SESSION_ID = process.env.TARGET_SESSION || 'session-1782132248359-xqlh'
const TRIGGER_USER_MSG = process.env.TRIGGER_MSG || '那你为什么说没有'

// ============ 1. 数据库连接（sql.js 纯 JS，不依赖 native binding） ============

function openDb() {
  const initSqlJs = require('sql.js')
  const DB_PATH = path.join(__dirname, '..', 'db', 'development.sqlite')
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('找不到开发数据库: ' + DB_PATH)
  }
  return { SQL: null, db: null, DB_PATH }
}

async function loadDb() {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  // Electron 应用真实数据库路径（Windows 下 %APPDATA%/<productName>/）
  // productName 在 package.json 里 = "com.massconcrete.app"
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'com.massconcrete.app', 'concrete-mixdesign.db'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'concrete-mixdesign', 'concrete-mixdesign.db'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Concrete Mixdesign', 'concrete-mixdesign.db'),
    path.join(__dirname, '..', 'db', 'development.sqlite')  // fallback
  ]
  let DB_PATH = null
  for (const p of candidates) {
    if (fs.existsSync(p)) { DB_PATH = p; break }
  }
  if (!DB_PATH) throw new Error('找不到老板的数据库，候选路径:\n' + candidates.join('\n'))
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  return { SQL, db, DB_PATH }
}

function query(db, sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

// ============ 2. 读取老板真实的配置 + agent.md ============

function loadConfig(db) {
  const rows = query(db, "SELECT paramName, paramValue FROM systemParams")
  const params = {}
  for (const r of rows) params[r.paramName] = r.paramValue
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
    apiKey: strVal('deepseekApiKey', null),
    model: strVal('deepseekModel', 'deepseek-v4-flash'),
    maxTokens: numVal('deepseekMaxTokens', 32768),
    timeout: numVal('deepseekTimeout', 120000),
    thinkingEnabled: boolVal('deepseekThinkingEnabled', true),
    agentMaxSteps: numVal('agentMaxSteps', 10),
    messageTrimmerTokenBudget: numVal('messageTrimmerTokenBudget', 30000)
  }
}

function loadAgentMd() {
  const p = path.join(os.homedir(), '.concrete-mixdesign', 'agent.md')
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8')
  return ''
}

// 计算 messages 数组的总字符数
function totalCharsOf(messages) {
  let total = 0
  for (const m of messages) {
    total += (m.content || '').length
    if (m.tool_calls) total += JSON.stringify(m.tool_calls).length
    if (m.reasoning_content) total += m.reasoning_content.length
  }
  return total
}

// ============ 3. 读取老板真实的会话历史 ============

function loadSessionHistory(db, sessionId) {
  // 按 createdAt 升序
  const rows = query(
    db,
    `SELECT id, role, content, toolCallId, toolCalls, metadata, createdAt
     FROM chat_history WHERE sessionId = ? ORDER BY createdAt ASC, id ASC`,
    [sessionId]
  )
  return rows
}

// 把数据库行转换成 UnifiedStrategy 喂给 LLM 的 messages 格式
// 参照 AgentMemoryService.buildHistoryMessages 的逻辑
function dbRowToMessage(row) {
  const msg = { role: row.role }
  // toolCalls 可能是 JSON 字符串
  let toolCalls = null
  if (row.toolCalls) {
    toolCalls = typeof row.toolCalls === 'string'
      ? (() => { try { return JSON.parse(row.toolCalls) } catch { return null } })()
      : row.toolCalls
  }
  // 如果有 toolCalls，content 可以为 null（DeepSeek API 允许）
  if (toolCalls) {
    msg.content = row.content || null
  } else {
    msg.content = row.content || ''
  }
  if (row.toolCallId) msg.tool_call_id = row.toolCallId
  if (toolCalls) msg.tool_calls = toolCalls
  // metadata 中的 name 字段（不保留 reasoning_content，避免历史消息触发 400）
  let meta = row.metadata
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta) } catch { meta = null }
  }
  if (meta && meta.name) msg.name = meta.name
  return msg
}

// ============ 4. 28 个工具 schema（v8.0.6 时代，含规范工具） ============
// 老板失败的会话是在 v8.1.0 之前创建的，所以使用 28 个工具 schema
const TOOLS_V8_0_6 = [
  { type: 'function', function: { name: 'compare_materials', description: '对比不同材料对配合比结果的影响', parameters: { type: 'object', properties: { strength: { type: 'string' }, compareType: { type: 'string' }, baseParams: { type: 'object' } }, required: ['strength', 'compareType', 'baseParams'] } } },
  { type: 'function', function: { name: 'check_compliance', description: '检查配合比是否合规', parameters: { type: 'object', properties: { mixDesignId: { type: 'integer' } }, required: ['mixDesignId'] } } },
  { type: 'function', function: { name: 'query_compliance_check', description: '查询合规检查结果', parameters: { type: 'object', properties: { checkId: { type: 'integer' } }, required: ['checkId'] } } },
  { type: 'function', function: { name: 'optimize_mix_cost', description: '网格搜索找出最低成本方案', parameters: { type: 'object', properties: { strength: { type: 'string' }, cementId: { type: 'integer' }, sandIds: { type: 'array' }, stoneIds: { type: 'array' } }, required: ['strength', 'cementId', 'sandIds', 'stoneIds'] } } },
  { type: 'function', function: { name: 'create_skill', description: '创建一个自定义技能', parameters: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' } }, required: ['name', 'code'] } } },
  { type: 'function', function: { name: 'query_design_history', description: '查询历史配合比设计', parameters: { type: 'object', properties: { limit: { type: 'integer' } }, required: [] } } },
  { type: 'function', function: { name: 'list_available_materials', description: '查询材料库可用原材料', parameters: { type: 'object', properties: { type: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'calculate_mix_design', description: '计算混凝土配合比', parameters: { type: 'object', properties: { strength: { type: 'string' }, slump: { type: 'number' }, cementId: { type: 'integer' }, sandIds: { type: 'array' }, stoneIds: { type: 'array' } }, required: ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds'] } } },
  { type: 'function', function: { name: 'predict_performance', description: '预测混凝土性能', parameters: { type: 'object', properties: { mixDesignId: { type: 'integer' } }, required: ['mixDesignId'] } } },
  
  
  { type: 'function', function: { name: 'save_mix_design', description: '保存配合比设计', parameters: { type: 'object', properties: { design: { type: 'object' } }, required: ['design'] } } },
  { type: 'function', function: { name: 'save_sales_quote', description: '保存销售报价', parameters: { type: 'object', properties: { quote: { type: 'object' } }, required: ['quote'] } } },
  { type: 'function', function: { name: 'manage_skills', description: '管理技能', parameters: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'list_standards', description: '列出规范', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'query_standards', description: '查询规范', parameters: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] } } },
  { type: 'function', function: { name: 'concrete_innovation_brainstorm', description: '混凝土创新头脑风暴', parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } } },
  { type: 'function', function: { name: 'material_query', description: '材料查询', parameters: { type: 'object', properties: { name: { type: 'string' } } } } },
  { type: 'function', function: { name: 'workspace_search', description: '搜索工作区', parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'integer' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'workspace_readPage', description: '读 wiki 页', parameters: { type: 'object', properties: { wikiPath: { type: 'string' } }, required: ['wikiPath'] } } },
  { type: 'function', function: { name: 'workspace_ingest', description: '入库文件', parameters: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] } } },
  { type: 'function', function: { name: 'workspace_writeFile', description: '写文件到工作区', parameters: { type: 'object', properties: { type: { type: 'string' }, filename: { type: 'string' }, payload: { type: 'object' } }, required: ['type', 'filename', 'payload'] } } },
  { type: 'function', function: { name: 'workspace_listFiles', description: '列工作区文件', parameters: { type: 'object', properties: { subdir: { type: 'string' } } } } },
  { type: 'function', function: { name: 'workspace_lint', description: '工作区健康检查', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'workspace_searchGraph', description: '查询知识图谱', parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'integer' } }, required: ['query'] } } }
]

// ============ 5. 主流程 ============

async function runScenario(name, messages, tools, apiKey, config) {
  console.log('')
  console.log('═══════════════════════════════════════════════════')
  console.log('  场景 ' + name)
  console.log('═══════════════════════════════════════════════════')
  console.log('  messages 数量: ' + messages.length)
  console.log('  tools 数量: ' + tools.length)
  let totalChars = 0
  for (const m of messages) {
    totalChars += (m.content || '').length
    if (m.reasoning_content) totalChars += m.reasoning_content.length
    if (m.tool_calls) totalChars += JSON.stringify(m.tool_calls).length
  }
  console.log('  消息总字符数: ' + totalChars + ' (~' + Math.ceil(totalChars / 1.5) + ' tokens)')
  console.log('  model=' + config.model + ', thinkingEnabled=' + config.thinkingEnabled)
  console.log('')

  // 跳过实际的 LLM 调用，除非老板显式开启
  if (process.env.SKIP_LLM === '1') {
    console.log('  [SKIP_LLM=1 已设置，仅打印 messages，跳过实际 API 调用]')
    console.log('')
    messages.forEach((m, i) => {
      console.log('  --- message[' + i + '] role=' + m.role + ' ---')
      if (m.content) console.log('  content 前 200 字: ' + String(m.content).slice(0, 200))
      if (m.tool_calls) console.log('  tool_calls: ' + JSON.stringify(m.tool_calls).slice(0, 300))
      if (m.tool_call_id) console.log('  tool_call_id: ' + m.tool_call_id)
      if (m.reasoning_content) console.log('  reasoning_content: ' + m.reasoning_content.slice(0, 100))
      console.log('')
    })
    return
  }

  const DeepSeekService = require('../src/main/services/DeepSeekService.js')
  // mock systemService：直接返回老板真实配置
  const ds = new DeepSeekService(apiKey, {
    async getAgentConfig() {
      return {
        deepseekModel: config.model,
        deepseekMaxTokens: config.maxTokens,
        deepseekTimeout: config.timeout,
        deepseekThinkingEnabled: config.thinkingEnabled,
        agentMaxSteps: config.agentMaxSteps,
        messageTrimmerTokenBudget: config.messageTrimmerTokenBudget,
        deepseekApiKey: apiKey
      }
    }
  })

  console.log('  --- 调 chatWithToolsStream ---')
  const startTime = Date.now()
  try {
    const response = await ds.chatWithToolsStream(messages, tools, () => {})
    const elapsed = Date.now() - startTime
    console.log('')
    console.log('  ✅ SUCCESS，耗时 ' + elapsed + 'ms')
    console.log('  content 长度: ' + (response.content || '').length)
    console.log('  reasoning_content 长度: ' + (response.reasoning_content || '').length)
    console.log('  tool_calls 数量: ' + (response.tool_calls || []).length)
    if (response.content) {
      console.log('  content 前 200 字: ' + response.content.slice(0, 200))
    }
  } catch (err) {
    const elapsed = Date.now() - startTime
    console.log('')
    console.log('  ❌ FAILED，耗时 ' + elapsed + 'ms（< 1s 说明 API 立即拒绝）')
    console.log('  --- 错误详情 ---')
    console.log('  err.message: ' + err.message)
    console.log('  err.status: ' + err.status)
    console.log('  err.code: ' + err.code)
    if (err.response) {
      console.log('  err.response.status: ' + err.response.status)
      console.log('  err.response.data: ' + JSON.stringify(err.response.data).slice(0, 1500))
    }
    if (err.stack) {
      console.log('  err.stack 前 1000 字: ' + err.stack.slice(0, 1000))
    }
  }
}

async function main() {
  console.log('========== repro-session-zj39.js ==========')
  const { db } = await loadDb()
  console.log('DB 已打开')

  const config = loadConfig(db)
  const agentMd = loadAgentMd()

  if (!config.apiKey) {
    console.error('❌ 没找到 deepseekApiKey，请检查 systemParams 表')
    process.exit(1)
  }
  console.log('API Key: ' + config.apiKey.slice(0, 8) + '...' + config.apiKey.slice(-4))
  console.log('Model: ' + config.model)
  console.log('Thinking: ' + config.thinkingEnabled)
  console.log('agent.md: ' + agentMd.length + ' 字符')

  // 构造 system prompt
  const skillNames = TOOLS_V8_0_6.map(t => t.function.name)
  const { buildSystemPrompt } = require('../src/main/agent/systemPromptBuilder.js')
  const systemPrompt = buildSystemPrompt({
    memoryContext: '',
    skillNames,
    agentMdRules: agentMd
  })
  console.log('System prompt: ' + systemPrompt.length + ' 字符 (~' + Math.ceil(systemPrompt.length / 2) + ' tokens)')

  // 读取目标会话历史
  const rows = loadSessionHistory(db, TARGET_SESSION_ID)
  console.log('')
  console.log('会话 ' + TARGET_SESSION_ID + ' 共有 ' + rows.length + ' 条消息：')
  rows.forEach((r, i) => {
    const toolMark = r.toolCalls ? ' [有 toolCalls]' : ''
    const len = (r.content || '').length
    console.log('  [' + i + '] ' + r.role + ' (' + len + ' 字符)' + toolMark + ' | ' + (r.content || '').slice(0, 60).replace(/\n/g, '\\n'))
  })

  // 转换历史为 messages 格式
  const historyMessages = rows.map(dbRowToMessage)
  console.log('')
  console.log('转换后 history messages 数量: ' + historyMessages.length)

  // ============ 场景 1：基线（不带历史，只发当前 user 消息） ============
  await runScenario(
    '1 (基线：无历史)',
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: TRIGGER_USER_MSG }
    ],
    TOOLS_V8_0_6,
    config.apiKey,
    config
  )

  // ============ 场景 2：精确复现老板失败时的真实历史 ============
  // 老板失败时，会话历史只到 readPage 最后一条 tool（67961/65209 字符），
  // 触发失败的新 user message 已保存但会被 buildHistoryMessages pop 掉
  const idxOfLastReadPageTool = (() => {
    let lastIdx = -1
    for (let i = 0; i < historyMessages.length; i++) {
      const m = historyMessages[i]
      if (m.role === 'tool' && m.tool_call_id && m.content && m.content.length > 5000) {
        lastIdx = i
      }
    }
    return lastIdx
  })()
  console.log('')
  console.log('老板失败时的真实历史边界：保留到 historyMessages[' + idxOfLastReadPageTool + '] (最后一条 readPage tool)')
  console.log('  历史消息总条数: ' + historyMessages.length + ' → 截断到 ' + (idxOfLastReadPageTool + 1) + ' 条')

  // ===== 关键修复：调用 UnifiedStrategy 的完整流程，包括 trim() =====
  // 老板失败的真实路径：UnifiedStrategy.execute() 构造 messages → trim() → chatWithToolsStream()
  // 我之前的脚本跳过了 trim，所以发的是未截断的 95424 tokens 请求（碰巧 DeepSeek 接受了）
  // 老板实际发的是 trim 后的请求（约 5500 tokens，但可能 trim 有 bug 产生非法消息）
  const { trim: trimMessages } = require('../src/main/agent/messageTrimmer.js')

  // 构造 messages（精确复现 UnifiedStrategy.execute line 90-94 + 107）
  const rawMessages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages.slice(0, idxOfLastReadPageTool + 1),
    { role: 'user', content: TRIGGER_USER_MSG }
  ]
  // 模拟 buildHistoryMessages 的 pop：如果最后一条是 user 就 pop
  if (rawMessages.length > 0 && rawMessages[rawMessages.length - 1].role === 'user') {
    rawMessages.pop()
  }
  // 重新加当前 user
  rawMessages.push({ role: 'user', content: TRIGGER_USER_MSG })

  // 调 trim
  const trimmedMessages = trimMessages(rawMessages, { tokenBudget: config.messageTrimmerTokenBudget })

  await runScenario(
    '2 (精确复现：trim 后的真实请求)',
    trimmedMessages,
    TOOLS_V8_0_6,
    config.apiKey,
    config
  )

  // 场景 2 跑完后 rawMessages 已经被 trim 原地修改了，场景 3 不能再 trim
  // 改用 rawMessages（即 trim 后的状态）做诊断
  const scenario2Messages = rawMessages

  // ============ 场景 3：trim 后诊断（不动 API，只分析 messages） ============
  console.log('')
  console.log('═══════════════════════════════════════════════════')
  console.log('  场景 3 (诊断：trim 后 messages 校验)')
  console.log('═══════════════════════════════════════════════════')
  const { trim } = require('../src/main/agent/messageTrimmer.js')
  const trimmed = trim(scenario2Messages, { tokenBudget: config.messageTrimmerTokenBudget })
  let trimmedChars = 0
  for (const m of trimmed) {
    trimmedChars += (m.content || '').length
    if (m.tool_calls) trimmedChars += JSON.stringify(m.tool_calls).length
  }
  console.log('  trim 前: ' + scenario2Messages.length + ' 条消息, ' + totalCharsOf(scenario2Messages) + ' 字符')
  console.log('  trim 后: ' + trimmed.length + ' 条消息, ' + trimmedChars + ' 字符 (~' + Math.ceil(trimmedChars / 1.5) + ' tokens)')
  console.log('')
  console.log('  trim 后每条消息：')
  trimmed.forEach((m, i) => {
    const tcIds = m.tool_calls ? m.tool_calls.map(tc => tc.id).join(',') : ''
    console.log('    [' + i + '] ' + m.role + ' content=' + (m.content || '').length + ' 字符' +
      (m.tool_call_id ? ' tool_call_id=' + m.tool_call_id : '') +
      (tcIds ? ' tool_calls=[' + tcIds + ']' : ''))
  })

  // 关键诊断：检查 assistant(tool_calls) 是否有悬空引用
  console.log('')
  console.log('  ⚠️ 诊断 assistant(tool_calls) 是否有悬空引用：')
  const toolCallIdsInKept = new Set(trimmed.filter(m => m.role === 'tool').map(m => m.tool_call_id))
  let danglingCount = 0
  for (const m of trimmed) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        const ok = toolCallIdsInKept.has(tc.id)
        if (!ok) danglingCount++
        console.log('    ' + (ok ? '✓' : '❌ 悬空！') + ' assistant.tool_calls: ' + tc.id +
          (ok ? ' → 有对应 tool 消息' : ' → 没有对应 tool 消息（DeepSeek API 会拒绝）'))
      }
    }
  }
  if (danglingCount > 0) {
    console.log('')
    console.log('  🎯 根因确认：trim() 保留了部分 tool 子消息但丢了其他子消息，')
    console.log('     导致父 assistant 的 tool_calls 包含悬空引用，DeepSeek API 立即 400。')
  } else {
    console.log('  ✅ 没有悬空引用，问题在别处')
  }

  db.close()
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
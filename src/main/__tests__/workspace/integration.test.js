/**
 * P3 集成测试 - 完整 ingest → search → writeFile → chat-history 闭环
 * Task 3.5-3.6 (P3 第 5 个 task)
 *
 * 设计目标：
 * - 端到端验证 P3 全部 4 个核心模块协作：
 *   1. WikiEngine.ingest + search（v4.9.4 I-1 修 + Task 3.4 chat-history 扩展）
 *   2. write-handler + 3 writers（docx/xlsx/md，Task 3.2）
 *   3. ChatHistorySync + Exporter（v1.5.3 拆分 + Task 3.4 chatBM25 增量更新）
 *   4. WorkspaceManager 状态机（open/close/attachSync）
 *
 * 测试策略：
 * - 真 WorkspaceManager + 真 fs tmp 目录
 * - 模拟 db/database（避免启动 sqlite）
 * - 模拟 sequelize Op
 * - 每个测试用独立 tmp 目录（afterEach 清理）
 * - 不引入新依赖
 */

const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')

// ==================== Mocks ====================

// Mock db/database —— 用内存 mock 替代真 sqlite
const mockChatHistoryStore = []  // {id, sessionId, role, content, createdAt, toolCalls, metadata, workspacePath}
let nextChatHistoryId = 1
const mockChatSessionStore = []  // {sessionId, sessionName, createdAt, lastActivity, workspacePath}

const mockChatHistory = {
  findAll: jest.fn(async ({ where, order } = {}) => {
    let rows = mockChatHistoryStore.slice()
    if (where && where.sessionId) {
      rows = rows.filter(r => r.sessionId === where.sessionId)
    }
    if (where && where.workspacePath) {
      rows = rows.filter(r => r.workspacePath === where.workspacePath)
    }
    if (order) {
      for (const [field, dir] of order) {
        rows.sort((a, b) => {
          if (a[field] < b[field]) return dir === 'ASC' ? -1 : 1
          if (a[field] > b[field]) return dir === 'ASC' ? 1 : -1
          return 0
        })
      }
    }
    return rows
  }),
  update: jest.fn(async ({ workspacePath }, { where }) => {
    let updated = 0
    for (const r of mockChatHistoryStore) {
      if (r.sessionId === where.sessionId) {
        r.workspacePath = workspacePath
        updated++
      }
    }
    return [updated]
  })
}

const mockChatSession = {
  findAll: jest.fn(async ({ where, attributes, group, raw } = {}) => {
    let rows = mockChatSessionStore.slice()
    if (where) {
      // 顺序无关：先把所有可能的过滤条件都处理
      // 1) workspacePath：可能是字符串（精确匹配）或对象（含 Op.gt 时间过滤）
      if (where.workspacePath !== undefined && where.workspacePath !== null) {
        const target = where.workspacePath
        if (target && typeof target === 'object') {
          // Op.gt 对象 → lastActivity > cutoff（不按 workspacePath 过滤）
          const cutoff = target[Symbol.for('gt')]
          if (cutoff) {
            rows = rows.filter(r => r.lastActivity && new Date(r.lastActivity) > cutoff)
          }
        } else {
          // 字符串 → 精确匹配
          const targetNorm = target.replace(/\\/g, '/')
          rows = rows.filter(r => r.workspacePath && r.workspacePath.replace(/\\/g, '/') === targetNorm)
        }
      }
      // 2) sessionId
      if (where.sessionId) rows = rows.filter(r => r.sessionId === where.sessionId)
    }
    if (group) {
      const seen = new Set()
      rows = rows.filter(r => {
        const key = group.map(g => r[g]).join('|')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    if (raw) return rows
    return rows.map(r => ({ ...r }))
  }),
  update: jest.fn(async ({ workspacePath }, { where }) => {
    let updated = 0
    for (const r of mockChatSessionStore) {
      if (r.sessionId === where.sessionId) {
        r.workspacePath = workspacePath
        updated++
      }
    }
    return [updated]
  })
}

jest.mock('../../db/database', () => ({
  ChatHistory: mockChatHistory,
  ChatSession: mockChatSession
}))

jest.mock('sequelize', () => ({
  Op: { gt: Symbol('gt') }
}))

// ==================== 真实模块 ====================

const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { ChatHistorySync } = require('../../workspace/ChatHistorySync')
const { ChatHistoryExporter } = require('../../workspace/ChatHistoryExporter')
const { writeFile } = require('../../workspace/write-handler')

// ==================== 工具 ====================

async function mkTmpDir(label) {
  const id = `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const p = path.join(__dirname, 'fixtures', id)
  await fs.mkdir(p, { recursive: true })
  return p
}

async function rmTmpDir(p) {
  await fs.rm(p, { recursive: true, force: true }).catch(() => {})
}

function clearMockStores() {
  mockChatHistoryStore.length = 0
  mockChatSessionStore.length = 0
  nextChatHistoryId = 1
}

function makeSession(sessionId, workspacePath) {
  return {
    sessionId,
    sessionName: 'Test Session',
    createdAt: new Date(),
    lastActivity: new Date(),
    workspacePath
  }
}

function makeMessage(sessionId, role, content, workspacePath) {
  const msg = {
    id: nextChatHistoryId++,
    sessionId,
    role,
    content,
    createdAt: new Date(),
    toolCalls: null,
    metadata: null,
    workspacePath
  }
  mockChatHistoryStore.push(msg)
  return msg
}

// 验证 Buffer 是合法 zip（docx/xlsx 都是 zip 格式）
function isValidZip(buf) {
  if (!Buffer.isBuffer(buf)) return false
  if (buf.length < 4) return false
  // zip local file header: PK\x03\x04
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

// 解析 zip central directory 找 sheet 名（xlsx 用）
// 简化版：用 Node 内置的"扫 PK\x03\x04 local file header + filename"
function listZipEntries(buf) {
  const entries = []
  let offset = 0
  while (offset < buf.length - 4) {
    if (buf[offset] === 0x50 && buf[offset + 1] === 0x4b &&
        buf[offset + 2] === 0x03 && buf[offset + 3] === 0x04) {
      // local file header
      const nameLen = buf.readUInt16LE(offset + 26)
      const extraLen = buf.readUInt16LE(offset + 28)
      const name = buf.slice(offset + 30, offset + 30 + nameLen).toString('utf-8')
      entries.push(name)
      // skip header + name + extra + compressed size（未知，跳到 name+extra 之后）
      offset += 30 + nameLen + extraLen
      // 不解压数据，简单按 compressed size 跳
      // 但我们不知道 compressed size（需要再读 4 字节），简化跳过 4 字节
      if (offset + 4 <= buf.length) {
        const compSize = buf.readUInt32LE(offset)
        offset += 4 + compSize
      } else {
        break
      }
    } else {
      offset++
    }
  }
  return entries
}

// ==================== 测试 ====================

describe('P3 集成测试（Task 3.5-3.6：ingest→search→writeFile→chat-history 闭环）', () => {
  let testPath
  let mgr, wiki, sync, exporter

  beforeEach(async () => {
    clearMockStores()
    jest.clearAllMocks()
    testPath = await mkTmpDir('p3-int')
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
    exporter = new ChatHistoryExporter()
    sync = new ChatHistorySync({ workspace: mgr, exporter })
    mgr.attachSync(sync)
  })

  afterEach(async () => {
    await mgr.close().catch(() => {})
    await rmTmpDir(testPath)
  })

  // ==================== Test 1: ingest .md → search 命中 ====================

  test('Test 1: ingest .md → search 命中（wiki 闭环）', async () => {
    // 1) 准备源文件
    await fs.writeFile(
      path.join(testPath, '抗渗.md'),
      '# 抗渗混凝土\n\n抗渗混凝土水胶比不应大于 0.45。'
    )

    // 2) ingest
    const ingestResult = await wiki.ingest({ filename: '抗渗.md' })
    expect(ingestResult.status).toBe('ok')
    // 中文文件名触发 fnv1a 后缀（WikiEngine.js line 89-91）：sources/抗渗-<6hex>.md
    expect(ingestResult.pagesCreated.length).toBe(1)
    expect(ingestResult.pagesCreated[0]).toMatch(/^sources\/抗渗-[0-9a-f]{6}\.md$/)
    expect(ingestResult.bm25TokensAdded).toBeGreaterThan(0)

    // 3) 验证 wiki 页已落盘
    const wikiPageRel = ingestResult.pagesCreated[0]  // 'sources/抗渗-<hash>.md'
    const wikiPagePath = path.join(testPath, 'wiki', wikiPageRel)
    const wikiPageContent = await fs.readFile(wikiPagePath, 'utf-8')
    expect(wikiPageContent).toContain('抗渗混凝土')
    expect(wikiPageContent).toContain('---')  // 应该有 frontmatter 分隔符

    // 4) search 命中
    const results = await wiki.search('抗渗', 5)
    expect(results.length).toBeGreaterThan(0)
    const topHit = results[0]
    expect(topHit.path).toBe(wikiPageRel)
    expect(topHit.sourceType).toBe('wiki')
    expect(topHit.snippet).toContain('抗渗')
    expect(topHit.score).toBeGreaterThan(0)
  })

  // ==================== Test 2: ingest .md → writeFile 写 reports/out.docx ====================

  test('Test 2: ingest → writeFile 写 reports/out.docx（生成闭环）', async () => {
    // 1) ingest 一个源文件（建立工作区状态）
    await fs.writeFile(path.join(testPath, '混凝土.md'), '# 混凝土\n\n配合比设计。')
    await wiki.ingest({ filename: '混凝土.md' })

    // 2) LLM 模拟：调 writeFile 生成报告
    const result = await writeFile({
      workspaceManager: mgr,
      type: 'docx',
      filename: 'report.docx',
      payload: {
        title: '混凝土配合比报告',
        sections: [
          { type: 'h1', content: '一、设计参数' },
          { type: 'p', content: '水胶比 0.45，坍落度 180mm。' },
          { type: 'table', rows: [['材料', '用量(kg/m³)'], ['水泥', '400'], ['水', '180']] }
        ]
      }
    })

    // 3) 返回值结构（用 mgr.current().path 已 normalize 的路径）
    const expectedPath = path.posix.join(mgr.current().path, 'reports', 'report.docx')
    expect(result.path).toBe(expectedPath)
    expect(result.size).toBeGreaterThan(1000)
    expect(result.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // 4) 文件真实落盘 + 是合法 docx（zip 头）
    const stat = await fs.stat(result.path)
    expect(stat.size).toBe(result.size)
    const buf = await fs.readFile(result.path)
    expect(isValidZip(buf)).toBe(true)
  })

  // ==================== Test 3: saveMessage 模拟 → 5s debounce → chat-history 磁盘导出 ====================

  test('Test 3: saveMessage 模拟 → 5s debounce → chat-history 磁盘有 session.md', async () => {
    // 1) 模拟 AgentMemoryService.saveMessage → 直接 push 到 mock store
    const sessionId = 'p3-int-sess-001'
    mockChatSessionStore.push(makeSession(sessionId, testPath))
    makeMessage(sessionId, 'user', '老板：抗渗混凝土水胶比怎么定？', testPath)
    makeMessage(sessionId, 'assistant', '一般不大于 0.45。', testPath)

    // 2) 用真实 setTimeout 跑 debounce（不 mock timers，避免 fake 与真 IO 竞态）
    sync.markPending(sessionId)
    expect(sync.pendingQueue.has(sessionId)).toBe(true)

    // 3) 5 秒内不能导出（debounce）—— 同步等待 4.5s
    await new Promise(r => setTimeout(r, 4500))
    const slug = sessionId.substring(0, 8)
    const mdPath = path.join(testPath, 'wiki', 'chat-history', slug, 'session.md')
    expect(fsSync.existsSync(mdPath)).toBe(false)

    // 4) 等待到 5.5s（debounce 应已触发 + IO 完成）
    await new Promise(r => setTimeout(r, 1000))

    // 5) 磁盘有 session.md
    expect(fsSync.existsSync(mdPath)).toBe(true)
    const content = await fs.readFile(mdPath, 'utf-8')
    expect(content).toContain('抗渗混凝土')
    expect(content).toContain('水胶比')
    // frontmatter 校验
    expect(content).toMatch(/^---/)
    expect(content).toContain(`sessionId: ${sessionId}`)

    // 6) JSONL 也存在
    const jsonlPath = path.join(testPath, 'wiki', 'chat-history', slug, 'session.jsonl')
    expect(fsSync.existsSync(jsonlPath)).toBe(true)
    const jsonlContent = await fs.readFile(jsonlPath, 'utf-8')
    expect(jsonlContent).toContain('抗渗混凝土')
  }, 10000)  // 10s timeout

  // ==================== Test 4: chat-history session.md → WikiEngine.search sourceType='chatHistory' ====================

  test('Test 4: chat-history session.md → search sourceType="chatHistory"（跨域闭环）', async () => {
    // 1) 先 ingest 一个 wiki 页（让 search 工作）
    await fs.writeFile(path.join(testPath, '抗冻.md'), '# 抗冻融\n\n抗冻融混凝土水胶比。')
    await wiki.ingest({ filename: '抗冻.md' })

    // 2) 模拟"saveMessage → 5s → 导出"后，session.md 在磁盘
    const sessionId = 'p3-int-sess-002'
    mockChatSessionStore.push(makeSession(sessionId, testPath))
    makeMessage(sessionId, 'user', '聊到 抗渗 水胶比 0.45 配合比设计', testPath)
    makeMessage(sessionId, 'assistant', '抗渗等级 P8 推荐 0.45 水胶比。', testPath)

    await sync.exportSession(sessionId, testPath)

    // 3) chatBM25Index 应该已被 updateChatBM25Index 写入
    const { loadIndex } = require('../../workspace/index-store')
    const index = await loadIndex(testPath)
    expect(index.chatBM25Index).toBeDefined()
    expect(index.chatBM25Index.totalDocs).toBeGreaterThan(0)

    // 4) search 命中 chat-history（query 是"抗渗"——chat-history session.md 含此关键词）
    const results = await wiki.search('抗渗', 5)
    const chatHits = results.filter(r => r.sourceType === 'chatHistory')
    expect(chatHits.length).toBeGreaterThan(0)
    expect(chatHits[0].path).toContain('chat-history')
    expect(chatHits[0].path).toContain('session.md')

    // 5) 搜一个混合词：同时匹配 wiki + chat-history
    // "抗冻" → wiki（抗冻.md 含"抗冻融"，tokenize 得"抗冻"/"冻融"）
    // "抗渗" → chat-history（session.md 含"抗渗"）
    // 用 topK=10 合并两边各一搜
    const wikiOnly = await wiki.search('抗冻', 5)
    expect(wikiOnly.length).toBeGreaterThan(0)
    expect(wikiOnly[0].sourceType).toBe('wiki')

    const chatOnly = await wiki.search('抗渗', 5)
    expect(chatOnly.length).toBeGreaterThan(0)
    expect(chatOnly.some(r => r.sourceType === 'chatHistory')).toBe(true)

    // 合并两边：直接合并 wiki + chat 命中，验证两个 sourceType 都覆盖
    const combined = [...wikiOnly, ...chatOnly]
    const combinedTypes = new Set(combined.map(r => r.sourceType))
    expect(combinedTypes.has('wiki')).toBe(true)
    expect(combinedTypes.has('chatHistory')).toBe(true)
  })

  // ==================== Test 5: writeFile 生成 xlsx → 验证 zip 结构 + sheet 名 ====================

  test('Test 5: writeFile 生成 xlsx → 验证 zip 结构 + sheet 名 + 内容可被 xlsx 库读回', async () => {
    // 1) ingest 一个源（建立工作区）
    await fs.writeFile(path.join(testPath, '数据.md'), '# 数据\n\n基础数据。')
    await wiki.ingest({ filename: '数据.md' })

    // 2) writeFile 生成 xlsx
    const result = await writeFile({
      workspaceManager: mgr,
      type: 'xlsx',
      filename: 'data.xlsx',
      payload: {
        title: '配合比数据表',
        sections: [
          { type: 'table', sheetName: '配合比', rows: [
            ['材料', '用量'],
            ['水泥', 400],
            ['水', 180]
          ]},
          { type: 'table', sheetName: '抗压强度', rows: [
            ['龄期', '强度(MPa)'],
            ['7d', 28.5]
          ]}
        ]
      }
    })

    // 3) 文件存在 + 是合法 zip
    const expectedPath = path.posix.join(mgr.current().path, 'reports', 'data.xlsx')
    expect(result.path).toBe(expectedPath)
    const buf = await fs.readFile(result.path)
    expect(isValidZip(buf)).toBe(true)

    // 4) zip 内含 xl/workbook.xml（xlsx 必有）
    // 用 buffer.indexOf 扫描 PK\x03\x04 后跟 'xl/workbook.xml'
    const searchBuf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml')])
    const foundIdx = buf.indexOf(searchBuf.slice(4))  // 'xl/workbook.xml' 直接搜
    // 更稳：找 'xl/workbook.xml' 字符串（xlsx 必含）
    expect(buf.toString('binary').includes('xl/workbook.xml')).toBe(true)

    // 5) 用 xlsx 库读回（验证真能反序列化）
    const xlsx = require('xlsx')
    const wb = xlsx.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toContain('配合比')
    expect(wb.SheetNames).toContain('抗压强度')

    // 6) sheet 内容正确
    const sheet1 = wb.Sheets['配合比']
    const aoa1 = xlsx.utils.sheet_to_json(sheet1, { header: 1 })
    expect(aoa1[0]).toEqual(['材料', '用量'])
    expect(aoa1[1]).toEqual(['水泥', 400])
  })

  // ==================== 附加：完整闭环（综合 1+2+3+4）====================

  test('完整闭环：ingest → search → writeFile + chat-history 导出 → 跨域 search', async () => {
    // Stage 1: ingest 一个知识源
    await fs.writeFile(path.join(testPath, '设计.md'), '# 设计参数\n\n水胶比 0.45。')
    await wiki.ingest({ filename: '设计.md' })

    // Stage 2: search 命中 wiki
    const wikiHits = await wiki.search('水胶比', 3)
    expect(wikiHits.length).toBeGreaterThan(0)

    // Stage 3: writeFile 生成报告
    const report = await writeFile({
      workspaceManager: mgr,
      type: 'md',
      filename: 'final.md',
      payload: {
        title: '最终报告',
        metadata: { project: 'C30' },
        sections: [
          { type: 'h1', content: '结论' },
          { type: 'p', content: '水胶比 0.45 满足设计要求。' }
        ]
      }
    })
    expect(report.path).toContain('reports/final.md')
    const mdBuf = await fs.readFile(report.path)
    const mdText = mdBuf.toString('utf-8')
    expect(mdText).toContain('水胶比')
    expect(mdText).toContain('project: C30')

    // Stage 4: saveMessage 模拟 → markPending + 立即 flush
    const sessionId = 'p3-int-sess-final'
    mockChatSessionStore.push(makeSession(sessionId, mgr.current().path))
    makeMessage(sessionId, 'user', '水胶比 0.45 是否合理？', mgr.current().path)
    makeMessage(sessionId, 'assistant', '合理。', mgr.current().path)

    // markPending 让 flushPendingExports 直接 exportAllPending
    sync.markPending(sessionId)
    expect(sync.pendingQueue.has(sessionId)).toBe(true)
    await sync.flushPendingExports()

    const slug = sessionId.substring(0, 8)
    const chatMdPath = path.join(testPath, 'wiki', 'chat-history', slug, 'session.md')
    expect(fsSync.existsSync(chatMdPath)).toBe(true)

    // Stage 5: search 同时命中 wiki + chat-history
    const final = await wiki.search('水胶比', 10)
    const finalTypes = new Set(final.map(r => r.sourceType))
    expect(finalTypes.has('wiki')).toBe(true)
    expect(finalTypes.has('chatHistory')).toBe(true)
  })
})
// src/main/__tests__/workspace/WikiEngine.ingest.parallel.test.js
// ingest 并行调度（KG + 摘要）+ sections 预计算集成测试

const path = require('path')
const fs = require('fs').promises
const matter = require('gray-matter')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { createTestWikiPage } = require('./helpers')

describe('WikiEngine.ingest（并行 KG + 摘要）', () => {
  let tmpDir, mgr

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), '.tmp', `ingest-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    for (const sub of ['wiki', 'reports', 'chat-history']) {
      await fs.mkdir(path.join(tmpDir, sub), { recursive: true })
    }
    // 预建一个已有页面（供 existingPages 列表用）
    await createTestWikiPage(path.join(tmpDir, 'wiki', 'sources'), 'existing.md', '# 已有页面\n水泥材料')
    // 创建测试源文件
    const testContent = '水泥强度 48.6MPa\n初凝时间 185min'
    await fs.writeFile(path.posix.join(tmpDir, 'test.txt'), testContent, 'utf-8')
    mgr = new WorkspaceManager()
    await mgr.open(tmpDir)
  })

  afterEach(async () => {
    await mgr.close()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  function makeEngine(mockLLM, kgSchema) {
    const { KGExtractor } = require('../../workspace/KGExtractor')
    const { SummaryExtractor } = require('../../workspace/SummaryExtractor')
    return new WikiEngine({
      workspace: mgr,
      kgExtractor: kgSchema ? new KGExtractor({ llmClient: mockLLM, schema: kgSchema }) : null,
      deepseekService: mockLLM,
      summaryExtractor: new SummaryExtractor({ deepseekService: mockLLM })
    })
  }

  test('正常 ingest → frontmatter 含 summary + keyPoints + sections + type + confidence', async () => {
    const mockLLM = {
      invoke: jest.fn()
        // 第一次：KG 提取
        .mockResolvedValueOnce(JSON.stringify({
          entities: [{ name: '水泥', type: 'Material' }],
          relations: [{
            subject: '水泥', predicate: 'has_strength', object: '48.6MPa',
            evidence: '水泥强度 48.6MPa，初凝时间 185min，这是一个足够长的证据片段',
            confidence: 0.9
          }]
        }))
        // 第二次：摘要生成
        .mockResolvedValueOnce(JSON.stringify({
          summary: '检测水泥强度',
          keyPoints: ['强度 48.6MPa', '初凝 185min'],
          tags: ['水泥'],
          confidence: 0.9,
          relatedLinks: []
        }))
    }
    const engine = makeEngine(mockLLM, { entityTypes: ['Material'], relationTypes: ['has_strength'] })
    const result = await engine.ingest({ filename: 'test.txt' })
    expect(result.status).toBe('ok')
    expect(result.pagesCreated).toHaveLength(1)

    const wikiPath = path.join(tmpDir, 'wiki', result.pagesCreated[0])
    const { data: fm } = matter(await fs.readFile(wikiPath, 'utf-8'))

    // OKF 必填字段
    expect(fm.type).toBe('wiki-source-page')
    expect(fm.title).toBeDefined()
    expect(fm.source).toBe('test.txt')
    // 摘要层
    expect(fm.summary).toBe('检测水泥强度')
    expect(fm.keyPoints).toHaveLength(2)
    expect(fm.confidence).toBe(0.9)
    // 段落层
    expect(fm.sections).toBeDefined()
    expect(fm.sections.length).toBeGreaterThan(0)
    expect(fm.sections[0]).toHaveProperty('startLine')
    expect(fm.sections[0]).toHaveProperty('endLine')
    expect(fm.sections_version).toBeGreaterThanOrEqual(1)
  })

  test('KG 成功 + 摘要失败 → KG 写入，summary = null', async () => {
    const mockLLM = {
      invoke: jest.fn()
        .mockResolvedValueOnce(JSON.stringify({
          entities: [{ name: '水泥', type: 'Material' }],
          relations: [{
            subject: '水泥', predicate: 'has_strength', object: '48.6MPa',
            evidence: '水泥强度 48.6MPa，初凝时间 185min，这是一个足够长的证据片段',
            confidence: 0.9
          }]
        }))
        .mockRejectedValueOnce(new Error('TIMEOUT'))
    }
    const engine = makeEngine(mockLLM, { entityTypes: ['Material'], relationTypes: ['has_strength'] })
    const result = await engine.ingest({ filename: 'test.txt' })
    const wikiPath = path.join(tmpDir, 'wiki', result.pagesCreated[0])
    const { data: fm } = matter(await fs.readFile(wikiPath, 'utf-8'))
    expect(fm.summary).toBeNull()
    expect(fm.keyPoints).toEqual([])
    expect(result.kgMerge).toBeDefined()
  })

  test('KG 失败 + 摘要成功 → summary 写入，不写 kg/', async () => {
    const mockLLM = {
      invoke: jest.fn()
        .mockRejectedValueOnce(new Error('KG FAIL'))
        .mockResolvedValueOnce(JSON.stringify({
          summary: '测试', keyPoints: ['强度 48.6MPa'], tags: ['水泥'],
          confidence: 0.85, relatedLinks: []
        }))
    }
    const engine = makeEngine(mockLLM, { entityTypes: [] })
    const result = await engine.ingest({ filename: 'test.txt' })
    const wikiPath = path.join(tmpDir, 'wiki', result.pagesCreated[0])
    const { data: fm } = matter(await fs.readFile(wikiPath, 'utf-8'))
    expect(fm.summary).toBe('测试')
    expect(fm.keyPoints).toHaveLength(1)
    // KG 失败 → kg/sources/ 不应该创建
    await expect(fs.access(path.join(tmpDir, 'wiki', 'kg', 'sources')))
      .rejects.toThrow()
  })

  test('两个都失败 → wiki 页只有原始内容 + 基础字段', async () => {
    const mockLLM = { invoke: jest.fn().mockRejectedValue(new Error('ALL FAIL')) }
    const engine = makeEngine(mockLLM, null)
    const result = await engine.ingest({ filename: 'test.txt' })
    const wikiPath = path.join(tmpDir, 'wiki', result.pagesCreated[0])
    const { data: fm } = matter(await fs.readFile(wikiPath, 'utf-8'))
    expect(fm.summary).toBeNull()
    expect(fm.type).toBe('wiki-source-page')
  })

  test('sections 和 _splitIntoSegments 返回一致（回归）', async () => {
    const mockLLM = {
      invoke: jest.fn()
        .mockResolvedValueOnce(JSON.stringify({ entities: [], relations: [] }))
        .mockResolvedValueOnce(JSON.stringify({
          summary: '测试', keyPoints: ['测试'], confidence: 0.85, relatedLinks: []
        }))
    }
    const engine = makeEngine(mockLLM, { entityTypes: [] })
    const result = await engine.ingest({ filename: 'test.txt' })
    const wikiPath = path.join(tmpDir, 'wiki', result.pagesCreated[0])
    const { data: fm, content } = matter(await fs.readFile(wikiPath, 'utf-8'))
    const segments = engine._splitIntoSegments(content)
    expect(segments.length).toBe(fm.sections.length)
    for (let i = 0; i < segments.length; i++) {
      expect(segments[i].startLine).toBe(fm.sections[i].startLine)
      expect(segments[i].endLine).toBe(fm.sections[i].endLine)
    }
  })

  test('entities 从 KG 结果填充（不写空）', async () => {
    const mockLLM = {
      invoke: jest.fn()
        .mockResolvedValueOnce(JSON.stringify({
          entities: [
            { name: '水泥', type: 'Material' },
            { name: '抗压强度', type: 'Property' }
          ],
          relations: []
        }))
        .mockResolvedValueOnce(JSON.stringify({
          summary: '测试', keyPoints: ['测试'], confidence: 0.85, relatedLinks: []
        }))
    }
    const engine = makeEngine(mockLLM, { entityTypes: ['Material', 'Property'] })
    const result = await engine.ingest({ filename: 'test.txt' })
    const wikiPath = path.join(tmpDir, 'wiki', result.pagesCreated[0])
    const { data: fm } = matter(await fs.readFile(wikiPath, 'utf-8'))
    expect(fm.entities).toContain('水泥')
    expect(fm.entities).toContain('抗压强度')
  })
})

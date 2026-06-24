// src/main/__tests__/workspace/WikiEngine.batchUpgrade.test.js
// batchUpgrade 批量升级测试

const path = require('path')
const fs = require('fs').promises
const matter = require('gray-matter')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { createTestWikiPage } = require('./helpers')

describe('WikiEngine.batchUpgrade', () => {
  let tmpDir, mgr, engine, mockLLM

  beforeEach(async () => {
    tmpDir = path.join(process.cwd(), '.tmp', `batchupgrade-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    for (const sub of ['wiki', 'wiki/sources', 'reports', 'chat-history']) {
      await fs.mkdir(path.join(tmpDir, sub), { recursive: true })
    }
    // 创建 3 个旧页面（无 summary/keyPoints/sections）
    for (let i = 1; i <= 3; i++) {
      await createTestWikiPage(path.join(tmpDir, 'wiki', 'sources'), `page${i}.md`, `# page${i}\n水泥检测数据 ${i}`, {
        summary: null, keyPoints: [], sections: [], sections_version: 0
      })
    }
    mgr = new WorkspaceManager()
    await mgr.open(tmpDir)
    mockLLM = {
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        summary: `摘要`, keyPoints: [`关键点`], tags: ['测试'], confidence: 0.85, relatedLinks: []
      }))
    }
    const { SummaryExtractor } = require('../../workspace/SummaryExtractor')
    engine = new WikiEngine({
      workspace: mgr,
      deepseekService: mockLLM,
      summaryExtractor: new SummaryExtractor({ deepseekService: mockLLM })
    })
  })

  afterEach(async () => {
    if (mgr) await mgr.close().catch(() => {})
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  test('有 3 个旧页面 → 全部升级', async () => {
    const r = await engine.batchUpgrade(tmpDir, {
      summaryExtractor: engine.summaryExtractor,
      computeSections: engine.computeSections.bind(engine)
    })
    expect(r.upgraded).toBe(3)
    expect(r.failed).toBe(0)
    // 验证升级后的 page1
    const raw = await fs.readFile(path.join(tmpDir, 'wiki', 'sources', 'page1.md'), 'utf-8')
    const { data: fm } = matter(raw)
    expect(fm.summary).toBeDefined()
    expect(fm.keyPoints).toHaveLength(1)
    expect(fm.sections).toBeDefined()
    expect(fm.sections.length).toBeGreaterThan(0)
    expect(fm.sections_version).toBeGreaterThanOrEqual(1)
  })

  test('已有 summary → 跳过', async () => {
    await engine.batchUpgrade(tmpDir, {
      summaryExtractor: engine.summaryExtractor,
      computeSections: engine.computeSections.bind(engine)
    })
    const r2 = await engine.batchUpgrade(tmpDir, {
      summaryExtractor: engine.summaryExtractor,
      computeSections: engine.computeSections.bind(engine)
    })
    expect(r2.upgraded).toBe(0)
  })

  test('半写状态（summary 有但 sections 缺失）→ 强制重跑', async () => {
    await createTestWikiPage(path.join(tmpDir, 'wiki', 'sources'), 'half-page.md', '# half-page\n半写内容', {
      summary: '已有摘要', keyPoints: ['有关键点'], sections: [], sections_version: 0
    })
    const r = await engine.batchUpgrade(tmpDir, {
      summaryExtractor: engine.summaryExtractor,
      computeSections: engine.computeSections.bind(engine)
    })
    expect(r.upgraded).toBe(4)  // 3 旧页 + half-page，全部成功
    expect(r.failed).toBe(0)
  })

  test('_batchUpdateRelatedPages 同一批次只调用一次', async () => {
    const spy = jest.spyOn(engine, '_batchUpdateRelatedPages').mockResolvedValue(undefined)
    await engine.batchUpgrade(tmpDir, {
      summaryExtractor: engine.summaryExtractor,
      computeSections: engine.computeSections.bind(engine)
    })
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

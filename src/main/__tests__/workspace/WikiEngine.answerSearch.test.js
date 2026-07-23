// WikiEngine.search 收录 answers 命中并按可配置系数降权（知识库刷新 Task 2）
// - recordAnswer 写入的 answer 文档可被 search 搜到
// - sourceType === 'answer'
// - score 已乘 demoteFactor（默认 0.8），不会超过 demoteFactor * 1
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine search 收录 answers（降权）', () => {
  let mgr, wiki, testPath
  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-answerSearch-test')
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })
  afterEach(async () => {
    await mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('用不同措辞能搜到 recordAnswer 存的知识，且标 sourceType=answer', async () => {
    await wiki.recordAnswer('抗渗混凝土的水胶比上限是多少', '抗渗混凝土水胶比不应大于 0.45。', [])
    const hits = await wiki.search('水胶比 抗渗 限值', 5)
    const answerHit = hits.find(h => h.sourceType === 'answer')
    expect(answerHit).toBeDefined()
    expect(answerHit.path).toMatch(/^answers\//)
    expect(answerHit.score).toBeGreaterThan(0)
    expect(answerHit.score).toBeLessThanOrEqual(0.8) // 已降权（<= demoteFactor * 1）
  })
})
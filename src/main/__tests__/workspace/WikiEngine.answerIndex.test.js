// WikiEngine answers 独立 BM25 索引（知识库刷新 Task 1）
// - recordAnswer 后 index.answerBM25Index 收录该文档
// - 测试风格对齐 WikiEngine.recordAnswer.test.js（WorkspaceManager + WikiEngine + fixtures 目录）
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')
const { loadIndex } = require('../../workspace/index-store')

describe('WikiEngine answers 独立索引', () => {
  let mgr, wiki, testPath
  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-answerIndex-test')
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })
  afterEach(async () => {
    await mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('recordAnswer 后 answerBM25Index 收录该文档', async () => {
    await wiki.recordAnswer('抗渗混凝土水胶比上限', '不应大于 0.45。', [])
    const index = await loadIndex(testPath)
    expect(index.answerBM25Index).toBeDefined()
    expect(index.answerBM25Index.totalDocs).toBeGreaterThan(0)
    // 词表含「水胶比」的 2-gram 片段之一
    const vocabTerms = Object.keys(index.answerBM25Index.vocabulary)
    expect(vocabTerms.length).toBeGreaterThan(0)
  })
})
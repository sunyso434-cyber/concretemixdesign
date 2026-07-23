// WikiEngine recordAnswer upsert（知识库刷新 Task 3）
// - 同一问题措辞高度相似 → 覆盖更新（answers 目录只保留一个文件）
// - 不相关新问题 → 新建第二个文件
// - 判据：2-gram Jaccard 相似度 ≥ upsertThreshold（默认 0.75）
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine recordAnswer upsert', () => {
  let mgr, wiki, testPath
  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-answerUpsert-test')
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })
  afterEach(async () => {
    await mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('同一问题存两次 → answers 目录只保留一个文件，内容为最新', async () => {
    await wiki.recordAnswer('抗渗混凝土水胶比上限是多少', '旧答案：不大于 0.50。', [])
    await wiki.recordAnswer('抗渗混凝土水胶比上限是多少', '新答案：不应大于 0.45。', [])

    const answersDir = path.join(testPath, 'wiki', 'answers')
    const files = (await fs.readdir(answersDir)).filter(f => f.endsWith('.md'))
    expect(files.length).toBe(1)
    const raw = await fs.readFile(path.join(answersDir, files[0]), 'utf-8')
    expect(raw).toContain('新答案：不应大于 0.45')
    expect(raw).not.toContain('旧答案')
  })

  test('不相关的新问题 → 新建，不覆盖', async () => {
    await wiki.recordAnswer('抗渗混凝土水胶比上限', '不应大于 0.45。', [])
    await wiki.recordAnswer('混凝土坍落度损失如何控制', '掺缓凝型减水剂。', [])
    const answersDir = path.join(testPath, 'wiki', 'answers')
    const files = (await fs.readdir(answersDir)).filter(f => f.endsWith('.md'))
    expect(files.length).toBe(2)
  })
})
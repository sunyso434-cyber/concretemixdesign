// WikiEngine.recordAnswer (Task 2.9) 测试
// - 把重要问答回填到 wiki/answers/<timestamp>.md
// - 更新 wiki/index.md（追加链接）
// - 加 log（写到 wiki/log.md，schema §4 格式）
// - 不重建 BM25（answer 文档不入索引）
// - 工作区未打开 → NOT_OPEN
const path = require('path')
const fs = require('fs').promises
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine.recordAnswer (Task 2.9)', () => {
  let mgr, wiki, testPath

  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-recordAnswer-test')
    await fs.mkdir(testPath, { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })

  afterEach(async () => {
    await mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  test('基本调用 → 写 wiki/answers/<timestamp>.md（含 question/answered_at/refs）', async () => {
    const result = await wiki.recordAnswer(
      '抗渗混凝土水胶比上限是多少？',
      '不应大于 0.45。',
      ['[[sources/jtg-3420-2020]]']
    )
    expect(result.status).toBe('ok')
    expect(result.answerPath).toMatch(/^answers\/\d{4}-\d{2}-\d{2}T[\d-]+Z\.md$/)

    // answer 文件存在，含 frontmatter + 正文
    const answerAbs = path.join(testPath, 'wiki', result.answerPath)
    const raw = await fs.readFile(answerAbs, 'utf-8')
    expect(raw).toContain('question:')
    expect(raw).toContain('抗渗混凝土水胶比上限是多少')
    expect(raw).toContain('answered_at:')
    expect(raw).toContain('refs:')
    expect(raw).toContain('sources/jtg-3420-2020')
    // 正文是 answer 文本
    expect(raw).toContain('不应大于 0.45')
  })

  test('NOT_OPEN 抛 WorkspaceError', async () => {
    await mgr.close()
    await expect(
      wiki.recordAnswer('q', 'a', [])
    ).rejects.toMatchObject({ code: 'NOT_OPEN' })
  })

  test('log.md 追加一行（schema §4 格式）', async () => {
    await wiki.recordAnswer('抗渗混凝土水胶比上限是多少？', '不应大于 0.45。', [])

    const logAbs = path.join(testPath, 'wiki', 'log.md')
    const logRaw = await fs.readFile(logAbs, 'utf-8')
    // 格式：`## [YYYY-MM-DD HH:mm] answer | <subject>`
    expect(logRaw).toMatch(/^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] answer \| 抗渗混凝土水胶比上限是多少？$/m)
  })

  test('index.md 更新（追加问答链接）', async () => {
    await wiki.recordAnswer('抗渗混凝土水胶比上限是多少？', '不应大于 0.45。', [])

    const indexAbs = path.join(testPath, 'wiki', 'index.md')
    const indexRaw = await fs.readFile(indexAbs, 'utf-8')
    // 含「## 问答」节，且有 answers/ 链接
    expect(indexRaw).toMatch(/## 问答/)
    expect(indexRaw).toMatch(/\[.*\]\(answers\/\d{4}-\d{2}-\d{2}T[\d-]+Z\.md\)/)
  })
})

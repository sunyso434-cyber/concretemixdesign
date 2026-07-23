// WikiEngine 交叉引用清悬空 + 语义保真（知识库刷新 Task 6）
// - 反驳关系 → 旧页记「被反驳」而非「被引用」
// - 重导时先清除本文件贡献的旧反向条目（避免悬空链接）
// - 未知 relation 回退「被引用」
const path = require('path')
const fs = require('fs').promises
const matter = require('gray-matter')
const { WorkspaceManager } = require('../../workspace/WorkspaceManager')
const { WikiEngine } = require('../../workspace/WikiEngine')

describe('WikiEngine 交叉引用清悬空 + 语义保真', () => {
  let mgr, wiki, testPath
  beforeEach(async () => {
    testPath = path.join(__dirname, 'fixtures/wiki-crossref-test')
    await fs.mkdir(path.join(testPath, 'wiki', 'sources'), { recursive: true })
    mgr = new WorkspaceManager()
    await mgr.open(testPath)
    wiki = new WikiEngine({ workspace: mgr })
  })
  afterEach(async () => {
    await mgr.close()
    await fs.rm(testPath, { recursive: true, force: true }).catch(() => {})
  })

  async function writePage(rel, relatedPages) {
    const fm = { type: 'wiki-source-page', title: rel, relatedPages: relatedPages || [] }
    await fs.writeFile(path.join(testPath, 'wiki', rel), matter.stringify('正文', fm), 'utf-8')
  }
  async function readRelated(rel) {
    const raw = await fs.readFile(path.join(testPath, 'wiki', rel), 'utf-8')
    // 传 {} 绕过 gray-matter 模块级缓存（同 file.content 字符串二次调用会拿旧值）
    return matter(raw, {}).data.relatedPages || []
  }

  test('反驳关系 → 旧页记「被反驳」而非「被引用」', async () => {
    await writePage('sources/b.md', [])
    await wiki._updateReverseLinks('sources/a.md', [{ page: 'sources/b.md', relation: '反驳', confidence: 0.9 }])
    const rel = await readRelated('sources/b.md')
    expect(rel.find(r => r.page === 'sources/a.md').relation).toBe('被反驳')
  })

  test('重导时先清除本文件贡献的旧反向条目', async () => {
    // b 页已有一条来自 a 的旧「被引用」
    await writePage('sources/b.md', [{ page: 'sources/a.md', relation: '被引用', confidence: 0.8 }])
    // a 重导，这次不再关联 b（relatedLinks 为空）
    await wiki._purgeReverseLinks('sources/a.md')
    const rel = await readRelated('sources/b.md')
    expect(rel.find(r => r.page === 'sources/a.md')).toBeUndefined()
  })

  test('未知 relation 回退「被引用」', async () => {
    await writePage('sources/b.md', [])
    await wiki._updateReverseLinks('sources/a.md', [{ page: 'sources/b.md', relation: '未知类型', confidence: 0.9 }])
    const rel = await readRelated('sources/b.md')
    expect(rel.find(r => r.page === 'sources/a.md').relation).toBe('被引用')
  })
})
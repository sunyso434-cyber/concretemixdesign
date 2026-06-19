// markdown writer 测试
// - 5 元素类型（h1/p/table/list/code）正确渲染
// - 带 frontmatter（gray-matter.stringify）
// - 不带 sections 时只有 frontmatter
const { write } = require('../../../workspace/writers/markdown')
const { detectMarkdownFrontmatter } = require('./helpers')

describe('markdown writer', () => {
  test('生成带 frontmatter + 5 元素类型 markdown', async () => {
    const buf = await write({
      title: '测试报告',
      metadata: { author: '老板', version: '1.0' },
      sections: [
        { type: 'h1', content: '章节1' },
        { type: 'p', content: '段落内容' },
        { type: 'table', rows: [['列1', '列2'], ['a', 'b']] },
        { type: 'list', items: ['项1', '项2'] },
        { type: 'code', language: 'js', code: 'const x = 1' }
      ]
    })
    expect(buf).toBeInstanceOf(Buffer)
    const text = buf.toString('utf-8')
    // frontmatter 必须有 title + author + version
    const { hasFrontmatter, frontmatter } = detectMarkdownFrontmatter(text)
    expect(hasFrontmatter).toBe(true)
    expect(frontmatter.title).toBe('测试报告')
    expect(frontmatter.author).toBe('老板')
    expect(frontmatter.version).toBe(1.0)
    // body 部分包含 5 种类型
    expect(text).toMatch(/# 章节1/)        // h1
    expect(text).toMatch(/段落内容/)       // p
    expect(text).toMatch(/\| 列1 \| 列2 \|/) // table
    expect(text).toMatch(/- 项1/)          // list
    expect(text).toMatch(/```js\nconst x = 1\n```/) // code
  })

  test('h2 标题渲染为 ##', async () => {
    const buf = await write({
      title: 't',
      sections: [
        { type: 'h1', content: '一级' },
        { type: 'h2', content: '二级' }
      ]
    })
    const text = buf.toString('utf-8')
    expect(text).toMatch(/^# 一级$/m)
    expect(text).toMatch(/^## 二级$/m)
  })

  test('空 sections 只生成 frontmatter', async () => {
    const buf = await write({ title: '空文档', sections: [] })
    const text = buf.toString('utf-8')
    expect(text).toMatch(/^---\n/)
    expect(text).toMatch(/title: 空文档/)
  })

  test('无 metadata 时 frontmatter 仅有 title', async () => {
    const buf = await write({
      title: '仅标题',
      sections: [{ type: 'p', content: '正文' }]
    })
    const text = buf.toString('utf-8')
    const { frontmatter } = detectMarkdownFrontmatter(text)
    expect(frontmatter.title).toBe('仅标题')
    expect(text).toContain('正文')
  })
})
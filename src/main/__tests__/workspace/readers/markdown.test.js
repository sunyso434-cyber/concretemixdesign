const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { read } = require('../../../workspace/readers/markdown')
const { WorkspaceError } = require('../../../workspace/WorkspaceError')

describe('markdown reader', () => {
  // 在测试目录里临时创建一个带 frontmatter 的 fixture（不改 generate.js）
  let frontmatterPath
  beforeAll(() => {
    frontmatterPath = path.join(__dirname, 'fixtures', 'sample-frontmatter.md')
    const content = [
      '---',
      'title: 混凝土规范',
      'version: "1.0"',
      'tags:',
      '  - 配合比',
      '  - 水胶比',
      '---',
      '',
      '# 混凝土规范',
      '',
      '水胶比不大于 0.45'
    ].join('\n')
    fs.writeFileSync(frontmatterPath, content, 'utf-8')
  })

  afterAll(() => {
    if (frontmatterPath && fs.existsSync(frontmatterPath)) {
      fs.unlinkSync(frontmatterPath)
    }
  })

  test('读取 .md 文件（无 frontmatter）返回完整正文', async () => {
    const fp = path.join(__dirname, 'fixtures/sample.md')
    const result = await read(fp)
    // content 是完整文件正文（无 frontmatter）
    expect(result.content).toContain('# 混凝土规范')
    expect(result.content).toContain('水胶比不大于 0.45')
    // metadata 反映无 frontmatter
    expect(result.metadata.frontmatter).toEqual({})
    expect(result.metadata.hasFrontmatter).toBe(false)
    expect(result.metadata.encoding).toBe('utf-8')
  })

  test('读取 .md 文件（有 frontmatter）分离 frontmatter 和 body', async () => {
    const result = await read(frontmatterPath)
    // content 不应包含 --- 标记和 frontmatter 字段
    expect(result.content).not.toContain('---')
    expect(result.content).not.toContain('title:')
    expect(result.content).not.toContain('version:')
    // content 应包含纯 body
    expect(result.content).toContain('# 混凝土规范')
    expect(result.content).toContain('水胶比不大于 0.45')
    // metadata.frontmatter 是解析后的 YAML
    expect(result.metadata.frontmatter).toMatchObject({
      title: '混凝土规范',
      version: '1.0'
    })
    expect(result.metadata.frontmatter.tags).toEqual(['配合比', '水胶比'])
    expect(result.metadata.hasFrontmatter).toBe(true)
    expect(result.metadata.encoding).toBe('utf-8')
  })

  test('> 200MB 触发 SIZE_EXCEEDED', async () => {
    const spy = jest.spyOn(fsp, 'stat').mockResolvedValueOnce({ size: 201 * 1024 * 1024 })
    try {
      await expect(read('huge.md')).rejects.toMatchObject({
        code: 'SIZE_EXCEEDED'
      })
    } finally {
      spy.mockRestore()
    }
  })

  test('不存在的文件触发 READ_FAIL', async () => {
    const fp = path.join(__dirname, 'fixtures/__not_exists__.md')
    try {
      await read(fp)
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceError)
      expect(err.code).toBe('READ_FAIL')
      expect(err.retryable).toBe(true)
    }
  })
})
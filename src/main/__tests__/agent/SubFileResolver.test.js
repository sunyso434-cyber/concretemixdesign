const SubFileResolver = require('../../agent/SubFileResolver')
const path = require('path')
const fs = require('fs')
const os = require('os')

describe('SubFileResolver', () => {
  let tmpDir, resolver

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subfile-'))
    resolver = new SubFileResolver()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('parseSubFileRefs 提取 [xxx.md](xxx.md) 链接', () => {
    const body = `理论背景见 [reference.md](reference.md)。
[examples.md](examples.md) 给了示例。`
    const refs = resolver.parseSubFileRefs(body)
    expect(refs).toEqual(expect.arrayContaining(['reference.md', 'examples.md']))
  })

  test('parseSubFileRefs 不重复提取同名引用', () => {
    const body = '[ref.md](ref.md) 又见 [ref.md](ref.md) 还有 [ref.md](ref.md)'
    const refs = resolver.parseSubFileRefs(body)
    expect(refs).toHaveLength(1)
  })

  test('loadSubFile 文件存在返回 content', async () => {
    fs.mkdirSync(path.join(tmpDir, 'brainstorm'))
    fs.writeFileSync(path.join(tmpDir, 'brainstorm', 'reference.md'), '# ref content')

    const result = await resolver.loadSubFile('brainstorm', 'reference.md', tmpDir)
    expect(result.success).toBe(true)
    expect(result.content).toBe('# ref content')
  })

  test('loadSubFile 文件不存在返回 success=false', async () => {
    const result = await resolver.loadSubFile('brainstorm', 'missing.md', tmpDir)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('loadSubFile 子目录不存在返回 success=false', async () => {
    const result = await resolver.loadSubFile('no_dir_skill', 'ref.md', tmpDir)
    expect(result.success).toBe(false)
  })
})

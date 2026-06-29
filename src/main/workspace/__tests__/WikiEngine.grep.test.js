const { WikiEngine } = require('../WikiEngine')
const fs = require('fs').promises
const path = require('path')
const os = require('os')

describe('WikiEngine.grep', () => {
  let tmpDir
  let engine

  async function setupWorkspace(files) {
    // files: { 'test-page.md': '正文内容', 'other.md': '...' }
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-grep-'))
    const wikiSourcesDir = path.join(tmpDir, 'wiki', 'sources')
    await fs.mkdir(wikiSourcesDir, { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      const md = `---
title: "${name.replace(/\.md$/, '')}"
source: "${name}"
ingested_at: "2026-01-01T00:00:00Z"
updated_at: "2026-01-01T00:00:00Z"
quality: "high"
---

${body}`
      await fs.writeFile(path.join(wikiSourcesDir, name), md, 'utf-8')
    }
    engine = new WikiEngine({ workspace: { current: () => ({ path: tmpDir, status: 'ready' }) } })
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      tmpDir = null
    }
  })

  test('工作区未打开 → NOT_OPEN', async () => {
    const eng = new WikiEngine({ workspace: { current: () => null } })
    await expect(eng.grep('foo')).rejects.toMatchObject({ code: 'NOT_OPEN' })
  })

  test('pattern 为空 → READ_FAIL', async () => {
    await setupWorkspace({ 'a.md': '内容' })
    await expect(engine.grep('')).rejects.toMatchObject({ code: 'READ_FAIL' })
    await expect(engine.grep(null)).rejects.toMatchObject({ code: 'READ_FAIL' })
  })

  test('无效正则 → READ_FAIL', async () => {
    await setupWorkspace({ 'a.md': '内容' })
    await expect(engine.grep('[unclosed')).rejects.toMatchObject({ code: 'READ_FAIL' })
  })

  test('精确字符串匹配 → 返回行号 + 上下文', async () => {
    await setupWorkspace({
      'a.md': '# 标题\n\n水胶比不宜大于0.60。\n\n其他内容。\n\n耐久性要求。'
    })
    const result = await engine.grep('水胶比')
    expect(result.total).toBe(1)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].path).toBe('sources/a.md')
    // gray-matter 解析后 content 前有一个空行：line1='', line2='# 标题', line3='', line4='水胶比...'
    expect(result.matches[0].lineNumber).toBe(4)
    expect(result.matches[0].line).toContain('水胶比')
    expect(result.matches[0].before).toHaveLength(2)  // 默认 B=2：line2='# 标题', line3=''
    expect(result.matches[0].after).toHaveLength(2)   // 默认 A=2：line5='', line6='其他内容。'
  })

  test('多关键字 OR（正则 | 分隔）', async () => {
    await setupWorkspace({
      'a.md': '水胶比0.45\n耐久性等级\n水泥用量'
    })
    const result = await engine.grep('水胶比|耐久性')
    expect(result.total).toBe(2)
    expect(result.matches.map(m => m.line)).toEqual(
      expect.arrayContaining(['水胶比0.45', '耐久性等级'])
    )
  })

  test('忽略大小写', async () => {
    await setupWorkspace({ 'a.md': 'Concrete Mix\nC30 concrete' })
    const r1 = await engine.grep('concrete')
    expect(r1.total).toBe(1)   // 仅 'C30 concrete' 命中
    const r2 = await engine.grep('concrete', { ignore_case: true })
    expect(r2.total).toBe(2)
  })

  test('上下文行数 A/B 控制', async () => {
    await setupWorkspace({ 'a.md': 'l1\nl2\nl3命中\nl4\nl5' })
    const r = await engine.grep('l3命中', { A: 1, B: 0 })
    expect(r.matches[0].before).toHaveLength(0)
    expect(r.matches[0].after).toHaveLength(1)
    expect(r.matches[0].after[0]).toBe('l4')
  })

  test('A/B 超过 50 → 被钳制为 50', async () => {
    await setupWorkspace({ 'a.md': '命中\n' + 'x\n'.repeat(60) })
    const r = await engine.grep('命中', { A: 999, B: 999 })
    expect(r.matches[0].after.length).toBeLessThanOrEqual(50)
  })

  test('glob 文件过滤', async () => {
    await setupWorkspace({
      'a.md': '关键词',
      'b.json': '{"关键词":1}'
    })
    const r1 = await engine.grep('关键词', { glob: '*.md' })
    expect(r1.matches.every(m => m.path.endsWith('.md'))).toBe(true)
    const r2 = await engine.grep('关键词', { glob: '*.json' })
    expect(r2.matches.every(m => m.path.endsWith('.json'))).toBe(true)
    const r3 = await engine.grep('关键词', { glob: '*.{md,json}' })
    expect(r3.total).toBe(2)
  })

  test('output_mode = files_with_matches', async () => {
    await setupWorkspace({
      'a.md': '关键词\n关键词',
      'b.md': '关键词'
    })
    const r = await engine.grep('关键词', { output_mode: 'files_with_matches' })
    expect(r.total).toBe(2)
    expect(r.matches).toHaveLength(2)
    expect(r.matches.find(m => m.path === 'sources/a.md').matchCount).toBe(2)
    expect(r.matches.find(m => m.path === 'sources/b.md').matchCount).toBe(1)
  })

  test('output_mode = count', async () => {
    await setupWorkspace({
      'a.md': '关键词\n关键词\n关键词',
      'b.md': '关键词'
    })
    const r = await engine.grep('关键词', { output_mode: 'count' })
    const a = r.matches.find(m => m.path === 'sources/a.md')
    const b = r.matches.find(m => m.path === 'sources/b.md')
    expect(a.count).toBe(3)
    expect(b.count).toBe(1)
  })

  test('head_limit 截断', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `命中${i}`).join('\n')
    await setupWorkspace({ 'a.md': lines })
    const r = await engine.grep('命中', { head_limit: 5 })
    expect(r.matches).toHaveLength(5)
    expect(r.total).toBe(50)
    expect(r.truncated).toBe(true)
  })

  test('无命中 → 空结果', async () => {
    await setupWorkspace({ 'a.md': '没有相关内容' })
    const r = await engine.grep('不存在的词')
    expect(r.total).toBe(0)
    expect(r.matches).toHaveLength(0)
    expect(r.scannedFiles).toBe(1)
  })

  test('frontmatter 不被搜索', async () => {
    // frontmatter 里有一个 "ingested_at"，正文里没有
    await setupWorkspace({ 'a.md': '正文内容' })
    const r = await engine.grep('ingested_at')
    expect(r.total).toBe(0)   // frontmatter 被剥离，不会命中
  })

  test('空目录 → 空结果', async () => {
    await setupWorkspace({})
    const r = await engine.grep('foo')
    expect(r.total).toBe(0)
    expect(r.scannedFiles).toBe(0)
  })

  test('中文正则匹配', async () => {
    await setupWorkspace({ 'a.md': '混凝土强度C30\n砂浆强度M10' })
    const r = await engine.grep('强度\\w*\\d+')
    expect(r.total).toBe(2)
  })

  test('scope=all 同时搜 sources 和 answers', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-grep-'))
    const sourcesDir = path.join(tmpDir, 'wiki', 'sources')
    const answersDir = path.join(tmpDir, 'wiki', 'answers')
    await fs.mkdir(sourcesDir, { recursive: true })
    await fs.mkdir(answersDir, { recursive: true })
    await fs.writeFile(path.join(sourcesDir, 'a.md'), '---\ntitle: "a"\n---\n关键词', 'utf-8')
    await fs.writeFile(path.join(answersDir, 'b.md'), '---\nquestion: "q"\n---\n关键词', 'utf-8')
    engine = new WikiEngine({ workspace: { current: () => ({ path: tmpDir, status: 'ready' }) } })

    const r1 = await engine.grep('关键词', { path: 'sources' })
    expect(r1.total).toBe(1)
    const r2 = await engine.grep('关键词', { path: 'answers' })
    expect(r2.total).toBe(1)
    const r3 = await engine.grep('关键词', { path: 'all' })
    expect(r3.total).toBe(2)
  })
})

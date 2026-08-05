const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-'))
const wsRoot = path.join(tmp, 'ws')
const userDir = path.join(tmp, 'skills')
fs.mkdirSync(wsRoot, { recursive: true })
fs.mkdirSync(userDir, { recursive: true })
fs.writeFileSync(path.join(wsRoot, 'a.md'), '# 标题\n正文', 'utf-8')

const { isAllowedPath, atomicWrite, readMd, writeMd, MAX_SIZE } = require('../../ipcHandlers/markdownHandler')

describe('isAllowedPath', () => {
  test('接受工作区根内的 .md', async () => {
    const r = await isAllowedPath(path.join(wsRoot, 'a.md'), { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.ok).toBe(true)
  })
  test('拒绝非 .md 后缀', async () => {
    const r = await isAllowedPath(path.join(wsRoot, 'a.txt'), { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.ok).toBe(false)
  })
  test('拒绝工作区根外路径（含 .. 越界）', async () => {
    const outside = path.join(tmp, 'secret.md')
    fs.writeFileSync(outside, 'x', 'utf-8')
    const r = await isAllowedPath(outside, { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.ok).toBe(false)
  })
  test('接受 skill 目录内的 .md', async () => {
    fs.writeFileSync(path.join(userDir, 'skill.md'), 'x', 'utf-8')
    const r = await isAllowedPath(path.join(userDir, 'skill.md'), { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.ok).toBe(true)
  })
  test('文件不存在返回错误', async () => {
    const r = await isAllowedPath(path.join(wsRoot, 'nope.md'), { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.ok).toBe(false)
  })
})

describe('readMd', () => {
  test('返回完整原文 + body（保留 frontmatter）', async () => {
    fs.writeFileSync(path.join(wsRoot, 'fm.md'), '---\ntitle: x\n---\n正文', 'utf-8')
    const r = await readMd(path.join(wsRoot, 'fm.md'), { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.content).toContain('---\ntitle: x')
    expect(r.body).toBe('正文')
    expect(r.metadata.hasFrontmatter).toBe(true)
    expect(typeof r.mtimeMs).toBe('number')
  })
  test('白名单外抛错', async () => {
    await expect(readMd(path.join(tmp, 'secret.md'), { workspaceRoot: wsRoot, skillUserDir: userDir })).rejects.toThrow()
  })
})

describe('atomicWrite', () => {
  test('写入成功且无残留 tmp 文件', async () => {
    const target = path.join(wsRoot, 'a.md')
    await atomicWrite(target, '# 新标题\n')
    expect(fs.readFileSync(target, 'utf-8')).toBe('# 新标题\n')
    expect(fs.existsSync(target + '.md-reader.tmp')).toBe(false)
  })
})

describe('writeMd', () => {
  test('正常写入返回 ok + 新 body，frontmatter 保留', async () => {
    const target = path.join(wsRoot, 'w.md')
    fs.writeFileSync(target, '---\ntitle: old\n---\n旧正文', 'utf-8')
    const r = await writeMd(target, '---\ntitle: new\n---\n新正文', { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.ok).toBe(true)
    expect(r.body).toBe('新正文')
    expect(fs.readFileSync(target, 'utf-8')).toBe('---\ntitle: new\n---\n新正文')
  })
  test('非字符串内容被拒绝', async () => {
    const r = await writeMd(path.join(wsRoot, 'a.md'), 12345, { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.error).toBe('内容必须为字符串')
    expect(r.ok).toBeUndefined()
  })
  test('内容超过 200MB 上限被拒绝（不落盘）', async () => {
    const before = fs.readFileSync(path.join(wsRoot, 'a.md'), 'utf-8')
    const huge = 'a'.repeat(MAX_SIZE + 1)
    const r = await writeMd(path.join(wsRoot, 'a.md'), huge, { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.error).toBe('内容超过 200MB 上限')
    expect(fs.readFileSync(path.join(wsRoot, 'a.md'), 'utf-8')).toBe(before) // 未被写入
  })
  test('白名单外拒绝', async () => {
    fs.writeFileSync(path.join(tmp, 'outside.md'), 'x', 'utf-8')
    const r = await writeMd(path.join(tmp, 'outside.md'), '新内容', { workspaceRoot: wsRoot, skillUserDir: userDir })
    expect(r.error).toBeDefined()
    expect(fs.readFileSync(path.join(tmp, 'outside.md'), 'utf-8')).toBe('x') // 未被写入
  })
})

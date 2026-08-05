const fs = require('fs')
const os = require('os')
const path = require('path')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reader-'))
const wsRoot = path.join(tmp, 'ws')
const userDir = path.join(tmp, 'skills')
fs.mkdirSync(wsRoot, { recursive: true })
fs.mkdirSync(userDir, { recursive: true })
fs.writeFileSync(path.join(wsRoot, 'a.md'), '# 标题\n正文', 'utf-8')

const { isAllowedPath, atomicWrite, readMd } = require('../../ipcHandlers/markdownHandler')

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

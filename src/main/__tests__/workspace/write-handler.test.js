/**
 * write-handler 测试（Task 3.2 + v9.1.0 防御性补充）
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

const writeHandler = require('../../workspace/write-handler')
const { WorkspaceError } = require('../../workspace/WorkspaceError')

describe('write-handler（Task 3.2）', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-write-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeWM(opts = {}) {
    return {
      current: () => ({ path: tmpDir, ...opts })
    }
  }

  test('写 md 报告成功（docx writer 已迁移 officecli，writeFile 仅支持 md）', async () => {
    const result = await writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'md',
      filename: 'test-report.md',
      payload: {
        title: '测试',
        sections: [
          { type: 'h1', content: '标题1' },
          { type: 'p', content: '正文' }
        ]
      }
    })
    expect(result.path).toContain('test-report.md')
    expect(result.size).toBeGreaterThan(0)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  test('工作区未打开 → 抛 WorkspaceError(NOT_OPEN)', async () => {
    const wm = { current: () => null }
    await expect(writeHandler.writeFile({
      workspaceManager: wm,
      type: 'md',
      filename: 'x.md',
      payload: { title: 'x', sections: [] }
    })).rejects.toMatchObject({ code: 'NOT_OPEN' })
  })

  test('未知 type → 抛 WorkspaceError(WRITE_FAIL)', async () => {
    await expect(writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'unknown',
      filename: 'x.unknown',
      payload: { title: 'x', sections: [] }
    })).rejects.toMatchObject({ code: 'WRITE_FAIL' })
  })
})

// v9.1.0 防御性测试：老板历史 bug 复现
describe('write-handler v9.1.0 防御性', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-write-def-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeWM(opts = {}) {
    return {
      current: () => ({ path: tmpDir, ...opts })
    }
  }

  test('缺 type 时返回清晰 E-PARAM-MISSING 错误', async () => {
    const result = writeHandler.writeFile({
      workspaceManager: makeWM(),
      filename: 'report.md',
      payload: { title: 'x', sections: [] }
    })
    await expect(result).rejects.toBeInstanceOf(WorkspaceError)
    await expect(result).rejects.toMatchObject({
      code: 'E-PARAM-MISSING',
      message: expect.stringContaining('type')
    })
  })

  test('缺 filename 时返回清晰错误', async () => {
    const result = writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'md',
      payload: { title: 'x', sections: [] }
    })
    await expect(result).rejects.toMatchObject({
      code: 'E-PARAM-MISSING',
      message: expect.stringContaining('filename')
    })
  })

  test('缺 payload 时返回清晰错误（老板历史 bug）', async () => {
    const result = writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'docx',
      filename: 'report.docx'
      // payload 故意漏传
    })
    await expect(result).rejects.toMatchObject({
      code: 'E-PARAM-MISSING',
      message: expect.stringContaining('payload')
    })
  })

  test('payload.sections 不是数组时返回清晰错误', async () => {
    const result = writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'docx',
      filename: 'report.md',
      payload: { title: 'x', sections: 'not array' }
    })
    await expect(result).rejects.toMatchObject({
      code: 'E-PARAM-INVALID-TYPE',
      message: expect.stringContaining('sections')
    })
  })

  test('payload.sections 是 null 时也报错', async () => {
    const result = writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'docx',
      filename: 'report.md',
      payload: { title: 'x', sections: null }
    })
    await expect(result).rejects.toMatchObject({
      code: 'E-PARAM-INVALID-TYPE'
    })
  })

  test('reports/ 目录不存在时自动创建（v9.1.0 防御性 mkdir）', async () => {
    // 故意删掉 reports/ 目录
    const reportsDir = path.join(tmpDir, 'reports')
    if (fs.existsSync(reportsDir)) fs.rmdirSync(reportsDir)
    expect(fs.existsSync(reportsDir)).toBe(false)

    const result = await writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'md',
      filename: 'test.md',
      payload: { title: '测试', sections: [{ type: 'p', content: '正文' }] }
    })
    expect(result.path).toContain('test.md')
    expect(fs.existsSync(reportsDir)).toBe(true)
    expect(fs.existsSync(result.path)).toBe(true)
  })
})

// v2026-08-03：归档文件夹（folder 参数）测试
describe('write-handler 归档文件夹（folder 参数）', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-write-folder-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeWM(opts = {}) {
    return {
      current: () => ({ path: tmpDir, ...opts })
    }
  }

  test('folder 参数：写入 reports/<folder>/<filename>，自动建目录', async () => {
    const result = await writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'md',
      filename: 'report.md',
      folder: 'XX项目',
      payload: { title: '测试', sections: [{ type: 'p', content: '正文' }] }
    })
    // write-handler 用 posix.join 拼路径（正斜杠），Windows 下 fs 可正常读写
    expect(result.path).toContain(path.posix.join('reports', 'XX项目', 'report.md'))
    expect(fs.existsSync(result.path)).toBe(true)
  })

  test('folder 支持多级（如 项目A/2026）', async () => {
    const result = await writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'md',
      filename: 'report.md',
      folder: '项目A/2026',
      payload: { title: '测试', sections: [{ type: 'p', content: '正文' }] }
    })
    expect(result.path).toContain(path.posix.join('reports', '项目A', '2026', 'report.md'))
    expect(fs.existsSync(result.path)).toBe(true)
  })

  test('folder 非法（.. / 绝对路径 / 反斜杠）→ 抛 E-PARAM-INVALID，不落盘', async () => {
    for (const bad of ['..', '../evil', '/abs', 'C:\\x', 'a\\b', 'a/../b']) {
      const p = writeHandler.writeFile({
        workspaceManager: makeWM(),
        type: 'md',
        filename: 'report.md',
        folder: bad,
        payload: { title: 'x', sections: [{ type: 'p', content: 'y' }] }
      })
      await expect(p).rejects.toMatchObject({ code: 'E-PARAM-INVALID' })
    }
    // 无越界文件产生
    expect(fs.existsSync(path.join(tmpDir, 'evil'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, '..', 'report.md'))).toBe(false)
  })

  test('patches 模式支持 folder（读已有文件并局部修改）', async () => {
    const wm = makeWM()
    // 先写入带 folder 的文件
    await writeHandler.writeFile({
      workspaceManager: wm,
      type: 'md',
      filename: 'report.md',
      folder: 'XX项目',
      payload: { title: '测试', sections: [{ type: 'p', content: '旧内容' }] }
    })
    // patches 修改
    const result = await writeHandler.writeFile({
      workspaceManager: wm,
      type: 'md',
      filename: 'report.md',
      folder: 'XX项目',
      patches: [{ find: '旧内容', replace: '新内容' }]
    })
    expect(result.success).toBe(true)
    const content = fs.readFileSync(path.join(tmpDir, 'reports', 'XX项目', 'report.md'), 'utf-8')
    expect(content).toContain('新内容')
  })

  test('patches 模式 folder 指向不存在的文件 → FILE_NOT_FOUND', async () => {
    await expect(writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'md',
      filename: 'missing.md',
      folder: 'XX项目',
      patches: [{ find: 'a', replace: 'b' }]
    })).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' })
  })

  test('normalizeReportFolder：合法多级返回 posix 路径，非法返回 null', () => {
    const { normalizeReportFolder } = writeHandler
    expect(normalizeReportFolder('XX项目')).toBe('XX项目')
    expect(normalizeReportFolder(' 项目A/2026 ')).toBe('项目A/2026')
    expect(normalizeReportFolder('')).toBe('')
    expect(normalizeReportFolder(null)).toBe('')
    expect(normalizeReportFolder('..')).toBeNull()
    expect(normalizeReportFolder('a/../b')).toBeNull()
    expect(normalizeReportFolder('C:\\x')).toBeNull()
    expect(normalizeReportFolder('a\\b')).toBeNull()
    expect(normalizeReportFolder('/abs')).toBeNull()
    expect(normalizeReportFolder('a?b')).toBeNull()
  })
})
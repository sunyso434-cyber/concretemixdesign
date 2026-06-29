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

  test('写 docx 报告成功', async () => {
    const result = await writeHandler.writeFile({
      workspaceManager: makeWM(),
      type: 'docx',
      filename: 'test-report.docx',
      payload: {
        title: '测试',
        sections: [
          { type: 'h1', content: '标题1' },
          { type: 'p', content: '正文' }
        ]
      }
    })
    expect(result.path).toContain('test-report.docx')
    expect(result.size).toBeGreaterThan(0)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  test('工作区未打开 → 抛 WorkspaceError(NOT_OPEN)', async () => {
    const wm = { current: () => null }
    await expect(writeHandler.writeFile({
      workspaceManager: wm,
      type: 'docx',
      filename: 'x.docx',
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
      filename: 'report.docx',
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
      type: 'docx',
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
      filename: 'report.docx',
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
      filename: 'report.docx',
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
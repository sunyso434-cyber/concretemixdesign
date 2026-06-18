// pdf reader 测试
// - 正常 PDF → 返回 content + metadata.pageCount
// - 损坏 PDF → PARSE_FAIL
// - > 200MB → SIZE_EXCEEDED
// - 文件不存在 → READ_FAIL
const fs = require('fs').promises
const path = require('path')
const { read } = require('../../../workspace/readers/pdf')
const { WorkspaceError } = require('../../../workspace/WorkspaceError')

describe('pdf reader', () => {
  test('读取正常 PDF 返回 content + metadata.pageCount', async () => {
    const fp = path.join(__dirname, 'fixtures/sample.pdf')
    const result = await read(fp)
    expect(result.content).toContain('混凝土')
    expect(result.metadata.pageCount).toBeGreaterThan(0)
  })

  test('损坏 PDF 触发 PARSE_FAIL', async () => {
    const fp = path.join(__dirname, 'fixtures/broken.pdf')
    await expect(read(fp)).rejects.toMatchObject({ code: 'PARSE_FAIL' })
  })

  test('> 200MB 触发 SIZE_EXCEEDED', async () => {
    jest.spyOn(fs, 'stat').mockResolvedValueOnce({ size: 201 * 1024 * 1024 })
    await expect(read('huge.pdf')).rejects.toMatchObject({ code: 'SIZE_EXCEEDED' })
  })

  test('文件不存在触发 READ_FAIL', async () => {
    const fp = path.join(__dirname, 'fixtures/does-not-exist.pdf')
    await expect(read(fp)).rejects.toMatchObject({ code: 'READ_FAIL' })
  })
})
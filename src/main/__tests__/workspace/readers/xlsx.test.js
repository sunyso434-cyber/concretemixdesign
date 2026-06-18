// xlsx reader 测试
// - 正常 xlsx → 返回 markdown 表格 + metadata.sheetNames/sheetCount
// - > 200MB → SIZE_EXCEEDED
// - 文件不存在 → READ_FAIL
// - 损坏 xlsx → PARSE_FAIL
const fs = require('fs').promises
const path = require('path')
const { read } = require('../../../workspace/readers/xlsx')
const { WorkspaceError } = require('../../../workspace/WorkspaceError')

describe('xlsx reader', () => {
  test('读取正常 xlsx 返回 markdown 表格 + metadata', async () => {
    const fp = path.join(__dirname, 'fixtures/sample.xlsx')
    const result = await read(fp)
    // 必须包含 markdown 表格语法
    expect(result.content).toContain('|')
    // 必须包含至少一个 sheet 的 heading
    expect(result.content).toMatch(/## Sheet: /)
    // 必须包含 sheet1 里的中文表头（材料/用量/水泥/砂）
    expect(result.content).toMatch(/材料|用量|水泥|砂/)
    // 必须包含 sheet2 里的强度等级或水胶比
    expect(result.content).toMatch(/强度等级|水胶比|C30|C40/)
    // sheetNames 必须是数组
    expect(Array.isArray(result.metadata.sheetNames)).toBe(true)
    // sample.xlsx 有 2 个 sheet
    expect(result.metadata.sheetNames.length).toBe(2)
    expect(result.metadata.sheetCount).toBe(result.metadata.sheetNames.length)
    expect(result.metadata.sheetCount).toBe(2)
    // metadata 必须有 encoding
    expect(result.metadata.encoding).toBe('utf-8')
  })

  test('每个 sheet 渲染为标准 markdown 表格（header + separator + data）', async () => {
    const fp = path.join(__dirname, 'fixtures/sample.xlsx')
    const result = await read(fp)
    // 必须含分隔行 `|---` 或 `|:---`
    expect(result.content).toMatch(/\|[-:]+/);
    // 必须含表格头行 `| ` 开头
    const lines = result.content.split(/\r?\n/)
    expect(lines.some(line => /^\|\s/.test(line))).toBe(true)
  })

  test('> 200MB 触发 SIZE_EXCEEDED', async () => {
    jest.spyOn(fs, 'stat').mockResolvedValueOnce({ size: 201 * 1024 * 1024 })
    await expect(read('huge.xlsx')).rejects.toMatchObject({ code: 'SIZE_EXCEEDED' })
  })

  test('文件不存在触发 READ_FAIL', async () => {
    const fp = path.join(__dirname, 'fixtures/does-not-exist.xlsx')
    await expect(read(fp)).rejects.toMatchObject({ code: 'READ_FAIL' })
  })

  test('损坏 xlsx 触发 PARSE_FAIL', async () => {
    // xlsx 本质是 zip。用 PK 起始但内容残缺的字节序列，
    // xlsx 库会在解析 zip 内部结构时抛错 → 我们捕获并包成 PARSE_FAIL。
    const tmpDir = path.join(__dirname, 'fixtures')
    const tmpPath = path.join(tmpDir, 'broken.xlsx')
    // PK\x03\x04 (local file header) + 残缺的剩余字节
    const broken = Buffer.from([
      0x50, 0x4b, 0x03, 0x04,
      0x14, 0x00, 0x00, 0x00, 0x08, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff, 0xff, 0xff, 0xff
    ])
    await fs.writeFile(tmpPath, broken)
    try {
      await expect(read(tmpPath)).rejects.toMatchObject({ code: 'PARSE_FAIL' })
    } finally {
      // 清理临时文件（不影响 generate.js 后续调用）
      try { await fs.unlink(tmpPath) } catch (_) { /* ignore */ }
    }
  })
})
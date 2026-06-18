// docx reader 测试
// - 正常 docx → 返回 content (markdown) + metadata.warnings
// - 损坏 docx → PARSE_FAIL
// - > 200MB → SIZE_EXCEEDED
// - 文件不存在 → READ_FAIL
//
// sample.docx 内容（由 fixtures/generate.js 生成）：
//   段落 1: "Concrete Mix Design 混凝土配合比设计报告"
//   段落 2: "C30 Mix Design 本报告涵盖 C30 配合比计算"
// 测试用 ASCII 兜底（"Concrete" / "C30" / "Mix Design"）— 中文提取依赖
// mammoth 解析，与字体/版本无关；ASCII 匹配保证跨环境稳定。
const fs = require('fs').promises
const path = require('path')
const { read } = require('../../../workspace/readers/docx')
const { WorkspaceError } = require('../../../workspace/WorkspaceError')

describe('docx reader', () => {
  test('读取正常 docx 返回 content + metadata.warnings', async () => {
    const fp = path.join(__dirname, 'fixtures/sample.docx')
    const result = await read(fp)
    // ASCII 兜底（任何环境都能解析）+ 中文（mammoth 对 UTF-8 docx 一般能解出）
    expect(result.content).toMatch(/混凝土|Concrete Mix Design|C30 Mix Design/)
    // metadata.warnings 必须是 number（mammoth messages 数组长度）
    expect(typeof result.metadata.warnings).toBe('number')
    expect(result.metadata.warnings).toBeGreaterThanOrEqual(0)
  })

  test('损坏 docx 触发 PARSE_FAIL', async () => {
    // broken.docx 不在 fixture 里，临时写一个 0 字节"假 docx"
    const brokenPath = path.join(__dirname, 'fixtures/_broken_runtime.docx')
    await fs.writeFile(brokenPath, 'this is not a real docx')
    try {
      await expect(read(brokenPath)).rejects.toMatchObject({ code: 'PARSE_FAIL' })
    } finally {
      await fs.unlink(brokenPath).catch(() => {})
    }
  })

  test('> 200MB 触发 SIZE_EXCEEDED', async () => {
    jest.spyOn(fs, 'stat').mockResolvedValueOnce({ size: 201 * 1024 * 1024 })
    await expect(read('huge.docx')).rejects.toMatchObject({ code: 'SIZE_EXCEEDED' })
  })

  test('文件不存在触发 READ_FAIL', async () => {
    const fp = path.join(__dirname, 'fixtures/does-not-exist.docx')
    await expect(read(fp)).rejects.toMatchObject({ code: 'READ_FAIL' })
  })
})
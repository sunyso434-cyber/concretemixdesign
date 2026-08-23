// writers 调度器测试
// - 按 type 选 writer
// - 未知 type 抛错
// 2026-08-23 清理：docx/xlsx writer 已迁移 officecli（调度器仅支持 markdown），
// 对应旧用例随功能移除；writers/docx.js 死文件一并删除
const { write, listTypes } = require('../../../workspace/writers')

describe('writers dispatcher', () => {
  test('按 type 选 markdown writer', async () => {
    const buf = await write('markdown', {
      title: 't',
      sections: [{ type: 'p', content: 'hello' }]
    })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.toString('utf-8')).toContain('hello')
  })

  test('md 是 markdown 的别名', async () => {
    const buf = await write('md', {
      title: 't',
      sections: [{ type: 'p', content: 'world' }]
    })
    expect(buf.toString('utf-8')).toContain('world')
  })

  test('未知 type 抛错（docx/xlsx 已迁移 officecli，不再由 writer 支持）', async () => {
    await expect(write('docx', { title: 't', sections: [] }))
      .rejects.toThrow(/unknown writer type/i)
    await expect(write('pdf', { title: 't', sections: [] }))
      .rejects.toThrow(/unknown writer type/i)
  })

  test('listTypes 返回支持的 writer 类型', () => {
    const types = listTypes()
    expect(types).toEqual(expect.arrayContaining(['markdown', 'md']))
    expect(types).not.toContain('docx')
    expect(types).not.toContain('xlsx')
  })
})

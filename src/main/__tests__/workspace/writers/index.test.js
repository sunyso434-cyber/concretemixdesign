// writers 调度器测试
// - 按 type 选 writer
// - 未知 type 抛错
const { write, listTypes } = require('../../../workspace/writers')

describe('writers dispatcher', () => {
  test('按 type 选 docx writer', async () => {
    const buf = await write('docx', {
      title: 't',
      sections: [{ type: 'h1', content: 'hi' }]
    })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(1000)
  })

  test('按 type 选 xlsx writer', async () => {
    const buf = await write('xlsx', {
      title: 't',
      sections: [{ type: 'table', rows: [['a', 'b']] }]
    })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf[0]).toBe(0x50) // PK
  })

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

  test('未知 type 抛错', async () => {
    await expect(write('pdf', { title: 't', sections: [] }))
      .rejects.toThrow(/unknown writer type/i)
  })

  test('listTypes 返回支持的 writer 类型', () => {
    const types = listTypes()
    expect(types).toEqual(expect.arrayContaining(['docx', 'xlsx', 'markdown', 'md']))
  })
})
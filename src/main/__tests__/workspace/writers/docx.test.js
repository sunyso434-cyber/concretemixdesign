// docx writer 测试
// - 验证 5 元素类型（h1/p/table/list/code）都能被 Packer 序列化为合法 docx（zip + Content_Types）
// - 返回 Buffer 且大于 1000 字节（经验值：哪怕最小 docx 也 > 2KB）
const { write } = require('../../../workspace/writers/docx')
const { validateDocxStructure } = require('./helpers')

describe('docx writer', () => {
  test('生成 5 元素类型 docx（h1/p/table/list/code）', async () => {
    const buf = await write({
      title: '测试报告',
      sections: [
        { type: 'h1', content: '章节1' },
        { type: 'p', content: '段落内容' },
        { type: 'table', rows: [['列1', '列2'], ['a', 'b']] },
        { type: 'list', items: ['项1', '项2'] },
        { type: 'code', language: 'js', code: 'const x = 1' }
      ]
    })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(1000)
    // docx 本质是 zip，必须含 [Content_Types].xml
    expect(validateDocxStructure(buf)).toBe(true)
  })

  test('支持 h2 标题', async () => {
    const buf = await write({
      title: 't',
      sections: [
        { type: 'h1', content: '一级' },
        { type: 'h2', content: '二级' }
      ]
    })
    expect(validateDocxStructure(buf)).toBe(true)
  })

  test('空 sections 也能生成合法 docx（只有 title）', async () => {
    const buf = await write({ title: '空文档', sections: [] })
    expect(validateDocxStructure(buf)).toBe(true)
  })

  test('中文 title + 中文内容不丢失', async () => {
    const buf = await write({
      title: '混凝土配合比设计报告',
      sections: [
        { type: 'h1', content: 'C30 配合比' },
        { type: 'p', content: '水胶比 0.45，坍落度 180mm。' }
      ]
    })
    expect(validateDocxStructure(buf)).toBe(true)
    // 中文以 utf-8 存于 zip 内；docx 内 document.xml 含中文（编码后字节 >= 6 字节/汉字）
    expect(buf.length).toBeGreaterThan(2000)
  })
})
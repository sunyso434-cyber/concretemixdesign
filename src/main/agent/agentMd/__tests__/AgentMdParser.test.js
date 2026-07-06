const { AgentMdParser } = require('../AgentMdParser')

describe('AgentMdParser v2', () => {
  test('parse 简单 ## section + 列表项', () => {
    const content = `# 我的规则

## 回复规范
- 中文回复
- 称呼老板
`
    const result = AgentMdParser.parse(content)
    expect(result.version).toBe(2)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].title).toBe('回复规范')
    expect(result.sections[0].subSections).toHaveLength(1)
    expect(result.sections[0].subSections[0].title).toBeNull()
    expect(result.sections[0].subSections[0].items).toEqual(['中文回复', '称呼老板'])
  })

  test('parse ## section + ### subSection 嵌套', () => {
    const content = `## 业务规则
### 材料
- P.O42.5
### 砂率
- 36-40%
`
    const result = AgentMdParser.parse(content)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].subSections).toHaveLength(2)
    expect(result.sections[0].subSections[0].title).toBe('材料')
    expect(result.sections[0].subSections[0].items).toEqual(['P.O42.5'])
    expect(result.sections[0].subSections[1].title).toBe('砂率')
  })

  test('parse 老 YAML code block 当 rawText 不解析', () => {
    const content = `## 专业偏好
\`\`\`yaml
materials:
  - category: 水泥
\`\`\`
`
    const result = AgentMdParser.parse(content)
    expect(result.sections[0].title).toBe('专业偏好')
    // 老 YAML 不解析进 items，作为 rawText 保留
    expect(result.sections[0].subSections[0].items).toEqual([])
    expect(result.sections[0].subSections[0].rawText).toContain('materials')
  })

  test('parse 老 KV 行（key: value）忽略不解析', () => {
    const content = `## 回复风格
- 语气: 专业
- 单位: 公制
`
    const result = AgentMdParser.parse(content)
    // v2 不识别 KV，整行作为 item 原样保留
    expect(result.sections[0].subSections[0].items).toEqual(['语气: 专业', '单位: 公制'])
  })

  test('parse 空内容返回默认空结构', () => {
    const result = AgentMdParser.parse('')
    expect(result.version).toBe(2)
    expect(result.sections).toEqual([])
  })

  test('format 双向不丢数据（幂等性）', () => {
    const original = `## 回复规范
- 中文回复
### 子规则
- 子项1
`
    const parsed = AgentMdParser.parse(original)
    const formatted = AgentMdParser.formatToMarkdown(parsed)
    const reparsed = AgentMdParser.parse(formatted)
    expect(reparsed).toEqual(parsed)
  })
})

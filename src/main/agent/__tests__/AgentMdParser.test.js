const { AgentMdParser } = require('../agentMd/AgentMdParser')

describe('AgentMdParser', () => {
  test('应解析完整示例', () => {
    const content = `---
version: 1
---

# 我的智能助手规则

## 回复风格
- 语气：专业但亲切
- 称呼：王工

## 专业偏好
- 默认强度：C30
- 常用水泥：P.O 42.5

## 工作流程
1. 先确认工程部位
2. 再确认强度等级

## 自定义知识
- 我们公司内部规范要求水胶比不超过0.45
`
    const result = AgentMdParser.parse(content)
    expect(result.version).toBe(1)
    expect(result.replyStyle['语气']).toBe('专业但亲切')
    expect(result.replyStyle['称呼']).toBe('王工')
    // v1 兼容路径：默认强度被丢弃，常用水泥被映射成 material
    expect(result.professionalPrefs).toEqual({
      materials: [{ category: '水泥', dimension: '厂家', value: 'P.O 42.5' }],
      method: null
    })
    expect(result.unknownV1Keys).toEqual([])
    expect(result.workflow).toEqual(['先确认工程部位', '再确认强度等级'])
    expect(result.customKnowledge).toEqual(['我们公司内部规范要求水胶比不超过0.45'])
    expect(result.unknownSections).toEqual({})
  })

  test('文件为空时应返回空对象（带默认 version）', () => {
    const result = AgentMdParser.parse('')
    expect(result.version).toBe(1)
    expect(result.replyStyle).toEqual({})
    expect(result.professionalPrefs).toEqual({ materials: [], method: null })
    expect(result.workflow).toEqual([])
    expect(result.customKnowledge).toEqual([])
    expect(result.unknownSections).toEqual({})
  })

  test('无 frontmatter 时按 version 1 处理', () => {
    const content = `## 回复风格
- 语气：简洁
`
    const result = AgentMdParser.parse(content)
    expect(result.version).toBe(1)
    expect(result.replyStyle['语气']).toBe('简洁')
  })

  test('未知类别应独立保留', () => {
    const content = `## 回复风格
- 语气：专业

## 我的特殊章节
这是一些自定义的注意事项内容
可以有多行
`
    const result = AgentMdParser.parse(content)
    expect(result.replyStyle['语气']).toBe('专业')
    expect(result.unknownSections['我的特殊章节']).toContain('这是一些自定义的注意事项内容')
    expect(result.unknownSections['我的特殊章节']).toContain('可以有多行')
  })

  test('格式错误行应忽略，不影响其他行', () => {
    const content = `## 回复风格
- 语气：专业
- 这是一行没有冒号的错误行
- 称呼：王工
- 错误的键值：
`
    const result = AgentMdParser.parse(content)
    expect(result.replyStyle['语气']).toBe('专业')
    expect(result.replyStyle['称呼']).toBe('王工')
  })

  test('应自动剥离 UTF-8 BOM', () => {
    const content = `﻿## 回复风格
- 语气：友好
`
    const result = AgentMdParser.parse(content)
    expect(result.replyStyle['语气']).toBe('友好')
  })

  test('formatToMarkdown 应能往返（v2 YAML 格式）', () => {
    const original = `---
version: 2
---

# 我的智能助手规则

## 回复风格
- 语气：友好
- 称呼：王工

## 专业偏好

\`\`\`yaml
materials:
  - { category: 水泥, dimension: 厂家, value: 拉法基 }
  - { category: 掺合料, dimension: 种类, values: [粉煤灰, 锂渣] }
method: 体积法
\`\`\`

## 已忽略的建议类型
- material_performance

## 工作流程
1. 第一步
2. 第二步

## 自定义知识
- 知识条目一
`
    const parsed = AgentMdParser.parse(original)
    const formatted = AgentMdParser.formatToMarkdown(parsed)
    const reparsed = AgentMdParser.parse(formatted)
    expect(reparsed.version).toBe(2)
    expect(reparsed.replyStyle).toEqual(parsed.replyStyle)
    expect(reparsed.professionalPrefs).toEqual({
      materials: [
        { category: '水泥', dimension: '厂家', value: '拉法基' },
        { category: '掺合料', dimension: '种类', values: ['粉煤灰', '锂渣'] }
      ],
      method: '体积法'
    })
    expect(reparsed.workflow).toEqual(parsed.workflow)
    expect(reparsed.customKnowledge).toEqual(parsed.customKnowledge)
    expect(reparsed.ignoredSuggestionTypes).toEqual(['material_performance'])
  })
})

describe('AgentMdParser v2 YAML 格式', () => {
  test('应解析 ## 专业偏好 中的 fenced YAML code block', () => {
    const content = `---
version: 2
---

# 我的智能助手规则

## 专业偏好

\`\`\`yaml
materials:
  - { category: 水泥,   dimension: 厂家, value: 拉法基 }
  - { category: 掺合料, dimension: 种类, values: [粉煤灰, 锂渣] }
  - { category: 细骨料, dimension: 性能, metric: 细度模数, value: 2.7 }
method: 体积法
\`\`\`

## 已忽略的建议类型
- material_performance

## 回复风格
- 语气: 专业但亲切
`
    const result = AgentMdParser.parse(content)
    expect(result.version).toBe(2)
    expect(result.professionalPrefs).toEqual({
      materials: [
        { category: '水泥', dimension: '厂家', value: '拉法基' },
        { category: '掺合料', dimension: '种类', values: ['粉煤灰', '锂渣'] },
        { category: '细骨料', dimension: '性能', metric: '细度模数', value: 2.7 }
      ],
      method: '体积法'
    })
  })

  test('空 YAML code block 应返回空结构', () => {
    const content = `---
version: 2
---

## 专业偏好

\`\`\`yaml
materials: []
method: null
\`\`\`
`
    const result = AgentMdParser.parse(content)
    expect(result.professionalPrefs).toEqual({ materials: [], method: null })
  })
})

describe('AgentMdParser v1 扁平兼容', () => {
  test('应将 "- 常用水泥: P.O 42.5" 映射为 materials 项', () => {
    const content = `---
version: 1
---

## 专业偏好
- 常用水泥: P.O 42.5
- 常用粉煤灰: 粉煤灰
`
    const result = AgentMdParser.parse(content)
    expect(result.professionalPrefs.materials).toEqual([
      { category: '水泥', dimension: '厂家', value: 'P.O 42.5' },
      { category: '掺合料', dimension: '种类', value: '粉煤灰' }
    ])
    expect(result.professionalPrefs.method).toBeNull()
  })

  test('应丢弃 "- 默认强度: C30" 不出现在 materials', () => {
    const content = `## 专业偏好
- 默认强度: C30
- 常用水泥: P.O 42.5
`
    const result = AgentMdParser.parse(content)
    expect(result.professionalPrefs.materials).toEqual([
      { category: '水泥', dimension: '厂家', value: 'P.O 42.5' }
    ])
    // 默认强度不计入 unknownV1Keys
    expect(result.unknownV1Keys).toEqual([])
  })

  test('未知 v1 键应进入 unknownV1Keys', () => {
    const content = `## 专业偏好
- 自定义规则: 严禁水胶比超过0.5
- 常用水泥: P.O 42.5
`
    const result = AgentMdParser.parse(content)
    expect(result.professionalPrefs.materials).toEqual([
      { category: '水泥', dimension: '厂家', value: 'P.O 42.5' }
    ])
    expect(result.unknownV1Keys).toContain('自定义规则')
  })

  test('空数据（materials: [] / method: null）应正常序列化', () => {
    const parsed = AgentMdParser.parse('')
    parsed.version = 2
    const md = AgentMdParser.formatToMarkdown(parsed)
    expect(md).toContain('## 专业偏好')
    expect(md).toContain('```yaml')
    // 重新解析后 materials 应该是空数组
    const reparsed = AgentMdParser.parse(md)
    expect(reparsed.professionalPrefs.materials).toEqual([])
  })
})

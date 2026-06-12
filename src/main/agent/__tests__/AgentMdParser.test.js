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
    expect(result.professionalPrefs['默认强度']).toBe('C30')
    expect(result.professionalPrefs['常用水泥']).toBe('P.O 42.5')
    expect(result.workflow).toEqual(['先确认工程部位', '再确认强度等级'])
    expect(result.customKnowledge).toEqual(['我们公司内部规范要求水胶比不超过0.45'])
    expect(result.unknownSections).toEqual({})
  })

  test('文件为空时应返回空对象（带默认 version）', () => {
    const result = AgentMdParser.parse('')
    expect(result.version).toBe(1)
    expect(result.replyStyle).toEqual({})
    expect(result.professionalPrefs).toEqual({})
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

  test('formatToMarkdown 应能往返', () => {
    const original = `---
version: 1
---

# 我的智能助手规则

## 回复风格
- 语气：友好
- 称呼：王工

## 专业偏好
- 默认强度：C30

## 工作流程
1. 第一步
2. 第二步

## 自定义知识
- 知识条目一
`
    const parsed = AgentMdParser.parse(original)
    const formatted = AgentMdParser.formatToMarkdown(parsed)
    const reparsed = AgentMdParser.parse(formatted)
    expect(reparsed.version).toBe(parsed.version)
    expect(reparsed.replyStyle).toEqual(parsed.replyStyle)
    expect(reparsed.professionalPrefs).toEqual(parsed.professionalPrefs)
    expect(reparsed.workflow).toEqual(parsed.workflow)
    expect(reparsed.customKnowledge).toEqual(parsed.customKnowledge)
  })
})

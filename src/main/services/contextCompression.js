const { messagesToText, DEFAULT_CONTEXT_LIMIT } = require('../../shared/utils/contextStats')

const MIN_PRESERVE_RECENT_TOKENS = 2000
const MAX_PRESERVE_RECENT_TOKENS = 8000

const COMPRESS_SYSTEM_PROMPT = `你是一个混凝土配合比设计领域的专业对话摘要助手。
你的任务是把一段长对话历史压缩成结构化摘要，供后续 AI agent 继续工作时参考。
摘要必须保留所有可执行的关键信息：用户需求、关键参数、已完成步骤、待办事项。`

function buildCompressUserPrompt(messagesText, previousSummary) {
  const base = `请将以下对话历史压缩为结构化摘要，严格按以下模板：

---
## Goal

[用户想要达成的目标是什么？]

## Instructions

- [用户给出过哪些关键指令、约束、偏好？]
- [如果有配合比/方案相关的参数（强度等级、坍落度、材料用量），必须保留具体数值]
- [如果用户引用了规范条文（GB/T、JGJ 等），必须保留条文编号]

## Discoveries

- [对话过程中发现了哪些关键事实？（已验证的假设、隐藏的约束、可复用的数据）]

## Accomplished

- ✅ 已完成：[...具体完成的动作、生成的方案、调用的工具]
- 🔄 进行中：[...未完成的步骤]
- ⏳ 待办：[...接下来需要做的事]

## Relevant data

- 配合比参数：[...所有具体数值，包括水胶比、砂率、外加剂掺量等]
- 引用规范：[...所有用到的规范编号]
- 文件/方案 ID：[...相关的方案 ID、材料 ID、文件路径]
---

对话历史：
"""
${messagesText}
"""`

  const summaryHint = previousSummary
    ? `\n\n补充：以下是之前的摘要，请把新对话的内容合并进去：\n${previousSummary}\n`
    : ''

  return `${base}${summaryHint}\n\n只输出摘要内容，不要任何额外解释。`
}

function selectTail(messages, budget) {
  const turns = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i] && messages[i].role === 'user') {
      let end = messages.length
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j] && messages[j].role === 'user') {
          end = j
          break
        }
      }
      turns.push({ start: i, end })
    }
  }
  if (turns.length === 0) return { head: messages, tail: [] }

  let total = 0
  let tailStartIdx = null
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = messages.slice(turns[i].start, turns[i].end)
    const turnTokens = Math.ceil(
      turn.reduce((sum, message) => (
        sum + ((message && message.content && message.content.length) || 0)
      ), 0) / 4
    )
    if (total + turnTokens > budget && tailStartIdx !== null) break
    total += turnTokens
    tailStartIdx = turns[i].start
  }

  if (tailStartIdx === null) return { head: messages, tail: [] }
  return {
    head: messages.slice(0, tailStartIdx),
    tail: messages.slice(tailStartIdx)
  }
}

module.exports = {
  messagesToText,
  DEFAULT_CONTEXT_LIMIT,
  MIN_PRESERVE_RECENT_TOKENS,
  MAX_PRESERVE_RECENT_TOKENS,
  COMPRESS_SYSTEM_PROMPT,
  buildCompressUserPrompt,
  selectTail
}

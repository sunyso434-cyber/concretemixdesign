// src/renderer/utils/slashCommandParser.js

const SYSTEM_COMMANDS = {
  model: { name: 'model', description: '切换 AI 模型', usage: '/model <模型名>' },
  rounds: { name: 'rounds', description: '设置工具调用循环最大次数（1-30）', usage: '/rounds <次数>' },
  clear: { name: 'clear', description: '清空当前对话', usage: '/clear' },
  help:  { name: 'help',  description: '显示所有命令', usage: '/help' }
}

function buildAllCommandNames(skills = []) {
  const names = Object.values(SYSTEM_COMMANDS).map(c => c.name)
  skills.forEach(s => {
    if (s && s.name && !names.includes(s.name)) {
      names.push(s.name)
    }
  })
  return names.sort()
}

function isChinese(ch) {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (code >= 0x4e00 && code <= 0x9fff) ||
         (code >= 0x3400 && code <= 0x4dbf)
}

function isCommandStart(input, pos) {
  if (pos === 0) return true
  const prev = input[pos - 1]
  if (prev === ' ') return true
  if (isChinese(prev)) return true
  return false
}

function parseMixedMessage(input) {
  if (!input || !input.includes('/')) {
    const trimmed = (input || '').trim()
    return trimmed ? [{ type: 'text', content: trimmed }] : []
  }

  const parts = []
  let buffer = ''
  let i = 0

  while (i < input.length) {
    if (input[i] === '/' && isCommandStart(input, i)) {
      const trimmedBuf = buffer.trim()
      if (trimmedBuf) parts.push({ type: 'text', content: buffer })
      buffer = ''

      let j = i + 1
      while (j < input.length) {
        if (input[j] === '/' && input[j - 1] === ' ') break
        j++
      }
      const cmdSegment = input.slice(i, j)
      const spaceIdx = cmdSegment.indexOf(' ')
      if (spaceIdx === -1) {
        parts.push({ type: 'command', command: cmdSegment.slice(1), param: '' })
      } else {
        parts.push({
          type: 'command',
          command: cmdSegment.slice(1, spaceIdx),
          param: cmdSegment.slice(spaceIdx + 1).trim()
        })
      }
      i = j
    } else {
      buffer += input[i]
      i++
    }
  }

  const trimmedBuf = buffer.trim()
  if (trimmedBuf) parts.push({ type: 'text', content: buffer })
  return parts
}

function isInCommandMode(input, cursorPos) {
  if (!input) return false
  const beforeCursor = input.slice(0, cursorPos)
  const lastSpaceIdx = beforeCursor.lastIndexOf(' ')
  const lastSegment = lastSpaceIdx === -1
    ? beforeCursor
    : beforeCursor.slice(lastSpaceIdx + 1)
  return lastSegment.startsWith('/')
}

function getCommonPrefix(strs) {
  if (strs.length === 0) return ''
  let prefix = strs[0]
  for (let i = 1; i < strs.length; i++) {
    while (strs[i].indexOf(prefix) !== 0) {
      prefix = prefix.slice(0, -1)
      if (prefix === '') return ''
    }
  }
  return prefix
}

function tabComplete(input, cursorPos, allCmdNames) {
  if (!isInCommandMode(input, cursorPos)) {
    return { newInput: input, newCursor: cursorPos }
  }

  const beforeCursor = input.slice(0, cursorPos)
  const afterCursor = input.slice(cursorPos)
  const lastSpaceIdx = beforeCursor.lastIndexOf(' ')
  const cmdSegment = lastSpaceIdx === -1 ? beforeCursor : beforeCursor.slice(lastSpaceIdx + 1)

  const matches = allCmdNames.filter(n =>
    `/${n}` === cmdSegment || `/${n}`.startsWith(cmdSegment)
  )
  if (matches.length === 0) {
    return { newInput: input, newCursor: cursorPos }
  }

  if (matches.length === 1) {
    const completed = `/${matches[0]}`
    const newBefore = beforeCursor.slice(0, beforeCursor.length - cmdSegment.length) + completed
    return { newInput: newBefore + afterCursor, newCursor: newBefore.length }
  }

  const commonPrefix = getCommonPrefix(matches.map(n => `/${n}`))
  if (commonPrefix === cmdSegment) {
    return { newInput: input, newCursor: cursorPos }
  }
  const newBefore = beforeCursor.slice(0, beforeCursor.length - cmdSegment.length) + commonPrefix
  return { newInput: newBefore + afterCursor, newCursor: newBefore.length }
}

module.exports = {
  SYSTEM_COMMANDS,
  buildAllCommandNames,
  parseMixedMessage,
  isInCommandMode,
  tabComplete
}

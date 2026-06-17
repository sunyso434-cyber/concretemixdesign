// src/renderer/utils/__tests__/slashCommandParser.test.js
const {
  parseMixedMessage,
  isInCommandMode,
  tabComplete,
  buildAllCommandNames,
  SYSTEM_COMMANDS
} = require('../slashCommandParser')

describe('parseMixedMessage', () => {
  test('纯命令：/model deepseek-v4-pro', () => {
    const parts = parseMixedMessage('/model deepseek-v4-pro')
    expect(parts).toEqual([
      { type: 'command', command: 'model', param: 'deepseek-v4-pro' }
    ])
  })

  test('文本+命令：你好 /model deepseek-v4-pro（v1.1 保留 buffer 原样）', () => {
    const parts = parseMixedMessage('你好 /model deepseek-v4-pro')
    expect(parts).toEqual([
      { type: 'text', content: '你好 ' },
      { type: 'command', command: 'model', param: 'deepseek-v4-pro' }
    ])
  })

  test('技能命令：/mix-design 帮我设计C30', () => {
    const parts = parseMixedMessage('/mix-design 帮我设计C30')
    expect(parts).toEqual([
      { type: 'command', command: 'mix-design', param: '帮我设计C30' }
    ])
  })

  test('多命令：/model deepseek-v4-pro /clear', () => {
    const parts = parseMixedMessage('/model deepseek-v4-pro /clear')
    expect(parts).toEqual([
      { type: 'command', command: 'model', param: 'deepseek-v4-pro' },
      { type: 'command', command: 'clear', param: '' }
    ])
  })

  test('URL 不误判：https://example.com', () => {
    const parts = parseMixedMessage('https://example.com')
    expect(parts).toEqual([
      { type: 'text', content: 'https://example.com' }
    ])
  })

  test('中文后 / 识别：你好/model（v1.1 文本段保留原样）', () => {
    const parts = parseMixedMessage('你好/model deepseek-v4-pro')
    expect(parts).toEqual([
      { type: 'text', content: '你好' },
      { type: 'command', command: 'model', param: 'deepseek-v4-pro' }
    ])
  })

  test('前后空格：v1.1 文本段保留原样（不 trim）', () => {
    const parts = parseMixedMessage('  你好  /model deepseek-v4-pro  ')
    expect(parts).toEqual([
      { type: 'text', content: '  你好  ' },
      { type: 'command', command: 'model', param: 'deepseek-v4-pro' }
    ])
  })

  test('空字符串', () => {
    expect(parseMixedMessage('')).toEqual([])
  })

  test('无斜杠：普通消息', () => {
    expect(parseMixedMessage('普通消息')).toEqual([
      { type: 'text', content: '普通消息' }
    ])
  })

  test('分数不误判：2/3 + 1/3', () => {
    const parts = parseMixedMessage('2/3 + 1/3')
    expect(parts).toEqual([
      { type: 'text', content: '2/3 + 1/3' }
    ])
  })

  test('未知命令单独：/unknown → 解析为命令段', () => {
    const parts = parseMixedMessage('/unknown')
    expect(parts).toEqual([
      { type: 'command', command: 'unknown', param: '' }
    ])
  })

  test('未知命令 + 文本：/unknown 你好', () => {
    const parts = parseMixedMessage('/unknown 你好')
    expect(parts).toEqual([
      { type: 'command', command: 'unknown', param: '你好' }
    ])
  })
})

describe('isInCommandMode（v1.1 修正测试标注）', () => {
  test('/ → true（光标在 / 后）', () => {
    expect(isInCommandMode('/', 1)).toBe(true)
  })

  test('/mo → true（光标在 /mo 末尾）', () => {
    expect(isInCommandMode('/mo', 3)).toBe(true)
  })

  test('/model → true（光标在 /model 末尾）', () => {
    expect(isInCommandMode('/model', 6)).toBe(true)
  })

  test('/model  → false（光标在空格后，命令段结束）', () => {
    expect(isInCommandMode('/model ', 7)).toBe(false)
  })

  test('你好 /mo → true（中间的命令）', () => {
    expect(isInCommandMode('你好 /mo', 6)).toBe(true)
  })

  test('你好 /model  → false（光标在中间命令的空格后）', () => {
    expect(isInCommandMode('你好 /model ', 10)).toBe(false)
  })

  test('你好 /model d → false（光标在参数 d 上）', () => {
    expect(isInCommandMode('你好 /model d', 11)).toBe(false)
  })

  test('你好 → false', () => {
    expect(isInCommandMode('你好', 2)).toBe(false)
  })
})

describe('tabComplete', () => {
  const allCmds = ['model', 'rounds', 'clear', 'help', 'mix-design', 'cost-optimization']

  test('/mo → /model（mix-design 不以 mo 开头）', () => {
    const result = tabComplete('/mo', 3, allCmds)
    expect(result.newInput).toBe('/model')
    expect(result.newCursor).toBe(6)
  })

  test('/r → /rounds（唯一）', () => {
    const result = tabComplete('/r', 2, allCmds)
    expect(result.newInput).toBe('/rounds')
    expect(result.newCursor).toBe(7)
  })

  test('/c → /c（多个候选，保持原状弹菜单）', () => {
    const result = tabComplete('/c', 2, allCmds)
    expect(result.newInput).toBe('/c')
    expect(result.newCursor).toBe(2)
  })

  test('普通消息 + Tab → 保持原状', () => {
    const result = tabComplete('普通', 2, allCmds)
    expect(result.newInput).toBe('普通')
  })

  test('中间的命令 Tab：你好 /mo → 你好 /model', () => {
    const result = tabComplete('你好 /mo', 6, allCmds)
    expect(result.newInput).toBe('你好 /model')
    expect(result.newCursor).toBe(9)
  })
})

describe('buildAllCommandNames', () => {
  test('合并系统命令 + 技能', () => {
    const names = buildAllCommandNames([
      { name: 'mix-design' },
      { name: 'cost-optimization' }
    ])
    expect(names).toContain('model')
    expect(names).toContain('mix-design')
    expect(names).toContain('cost-optimization')
  })
})

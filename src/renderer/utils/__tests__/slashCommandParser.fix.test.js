// 临时验证测试，跑完即删
const { tabComplete, normalizeCursorPos } = require('../slashCommandParser')

describe('cursorPos 归一化修复（v10.x 任务A）', () => {
  const allCmds = ['model', 'rounds', 'clear', 'help', 'scc_mixdesign', 'hv_analysis']

  describe('normalizeCursorPos', () => {
    test('undefined → input.length', () => {
      expect(normalizeCursorPos('abc', undefined)).toBe(3)
    })
    test('null → input.length', () => {
      expect(normalizeCursorPos('abc', null)).toBe(3)
    })
    test('NaN → input.length', () => {
      expect(normalizeCursorPos('abc', NaN)).toBe(3)
    })
    test('负数 → 0', () => {
      expect(normalizeCursorPos('abc', -1)).toBe(0)
    })
    test('越界 → input.length', () => {
      expect(normalizeCursorPos('abc', 999)).toBe(3)
    })
    test('正常值原样返回', () => {
      expect(normalizeCursorPos('abc', 2)).toBe(2)
    })
    test('空 input + undefined → 0', () => {
      expect(normalizeCursorPos('', undefined)).toBe(0)
    })
  })

  describe('tabComplete: /scc 场景（修复后）', () => {
    test('输入 /scc + Tab (cursorPos=4) → /scc_mixdesign', () => {
      const r = tabComplete('/scc', 4, allCmds)
      expect(r.newInput).toBe('/scc_mixdesign')
      expect(r.newCursor).toBe(14)
    })

    test('输入 "调用 /scc" + Tab (cursorPos=8) → "调用 /scc_mixdesign"', () => {
      const r = tabComplete('调用 /scc', 8, allCmds)
      expect(r.newInput).toBe('调用 /scc_mixdesign')
      expect(r.newCursor).toBe(17)
    })

    test('输入 /scc + Tab (cursorPos=undefined) → /scc_mixdesign（旧 bug 已修）', () => {
      const r = tabComplete('/scc', undefined, allCmds)
      expect(r.newInput).toBe('/scc_mixdesign')
      expect(r.newCursor).toBe(14)
    })

    test('输入 "调用 /scc" + Tab (cursorPos=undefined) → "调用 /scc_mixdesign"（旧 bug 已修）', () => {
      const r = tabComplete('调用 /scc', undefined, allCmds)
      expect(r.newInput).toBe('调用 /scc_mixdesign')
      expect(r.newCursor).toBe(17)
    })

    test('输入 /scc + Tab (cursorPos=999 越界) → /scc_mixdesign', () => {
      const r = tabComplete('/scc', 999, allCmds)
      expect(r.newInput).toBe('/scc_mixdesign')
    })

    test('输入 /scc + Tab (cursorPos=NaN) → /scc_mixdesign', () => {
      const r = tabComplete('/scc', NaN, allCmds)
      expect(r.newInput).toBe('/scc_mixdesign')
    })

    test('输入 /scc + Tab (cursorPos=null) → /scc_mixdesign', () => {
      const r = tabComplete('/scc', null, allCmds)
      expect(r.newInput).toBe('/scc_mixdesign')
    })

    test('输入 /he + Tab → /help（唯一匹配，注意 /h 会同时匹配 help 和 hv_analysis）', () => {
      const r = tabComplete('/he', 3, allCmds)
      expect(r.newInput).toBe('/help')
    })

    test('输入 /h + Tab → /h 保持原状（多候选 help/hv_analysis，公共前缀就是 /h）', () => {
      const r = tabComplete('/h', 2, allCmds)
      expect(r.newInput).toBe('/h')
    })

    test('输入 / + Tab → / 保持原状（多候选，无公共前缀）', () => {
      const r = tabComplete('/', 1, allCmds)
      expect(r.newInput).toBe('/')
    })

    test('普通文本 + Tab → 保持原状', () => {
      const r = tabComplete('普通消息', 4, allCmds)
      expect(r.newInput).toBe('普通消息')
    })
  })
})

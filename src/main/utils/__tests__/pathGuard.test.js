const path = require('path')
const {
  PathGuardError,
  assertSafeSegment,
  assertSafeFileName,
  resolveInside,
  isPathInsideRoot
} = require('../pathGuard')

describe('pathGuard', () => {
  describe('assertSafeSegment（纯标识符：技能名/toolCallId）', () => {
    test('接受中英文、数字、连字符、下划线', () => {
      expect(assertSafeSegment('查询材料')).toBe('查询材料')
      expect(assertSafeSegment('query-material_1')).toBe('query-material_1')
    })

    test.each([
      ['../evil', '路径分隔符'],
      ['a/b', '斜杠'],
      ['a\\b', '反斜杠'],
      ['C:\\evil.js', 'Windows 绝对路径'],
      ['/etc/passwd', 'Unix 绝对路径'],
      ['a..b', '点号'],
      ['', '空串'],
      [null, 'null'],
      [undefined, 'undefined'],
      ['a'.repeat(129), '超长']
    ])('拒绝 %s（%s）', (input) => {
      expect(() => assertSafeSegment(input)).toThrow(PathGuardError)
    })
  })

  describe('assertSafeFileName（报告文件名：允许点保留扩展名）', () => {
    test('接受普通文件名', () => {
      expect(assertSafeFileName('报告.docx')).toBe('报告.docx')
      expect(assertSafeFileName('2026-plan_v2.md')).toBe('2026-plan_v2.md')
    })

    test.each([
      ['../evil.md'],
      ['..\\evil.md'],
      ['sub/evil.md'],
      ['sub\\evil.md'],
      ['/abs/evil.md'],
      ['C:\\abs\\evil.md'],
      ['..'],
      ['a..b.md'],
      [''],
      [null]
    ])('拒绝 %s', (input) => {
      expect(() => assertSafeFileName(input)).toThrow(PathGuardError)
    })
  })

  describe('resolveInside（工作区相对路径收口）', () => {
    const root = path.resolve('/ws/root')

    test('根路径与子目录通过，返回绝对路径', () => {
      expect(resolveInside(root, 'reports/x.md')).toBe(path.resolve(root, 'reports/x.md'))
      expect(resolveInside(root, 'a/b/c.md')).toBe(path.resolve(root, 'a/b/c.md'))
    })

    test.each([
      ['../escape.md'],
      ['a/../../escape.md'],
      ['/etc/passwd'],
      ['C:\\Windows\\evil'],
      [''],
      [null]
    ])('拒绝 %s', (input) => {
      expect(() => resolveInside(root, input)).toThrow(PathGuardError)
    })

    test('root 自身路径不误伤（返回 root）', () => {
      // 子路径恰为 '.' 场景不常见，但边界语义应为允许（root 内）
      expect(resolveInside(root, '.')).toBe(root)
    })
  })

  describe('isPathInsideRoot', () => {
    const root = path.resolve('/ws/root')

    test('root 内返回 true', () => {
      expect(isPathInsideRoot(root, path.join(root, 'a.md'))).toBe(true)
      expect(isPathInsideRoot(root, root)).toBe(true)
    })

    test('root 外与前缀仿冒返回 false', () => {
      expect(isPathInsideRoot(root, path.resolve('/ws/root-evil/a.md'))).toBe(false)
      expect(isPathInsideRoot(root, path.resolve('/other/a.md'))).toBe(false)
      expect(isPathInsideRoot(root, '')).toBe(false)
      expect(isPathInsideRoot(root, null)).toBe(false)
    })
  })
})

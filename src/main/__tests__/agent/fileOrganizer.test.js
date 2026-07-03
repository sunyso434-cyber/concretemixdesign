const {
  classifyByExt,
  getAllTypes,
  getExpectedSubdir,
  isMisclassified,
  buildTargetRelPath,
  UNKNOWN_TYPE
} = require('../../agent/fileOrganizer')

describe('fileOrganizer', () => {
  describe('classifyByExt', () => {
    test('PDF → pdf', () => {
      expect(classifyByExt('规范.pdf')).toBe('pdf')
      expect(classifyByExt('规范.PDF')).toBe('pdf')
    })
    test('Word → docx', () => {
      expect(classifyByExt('报告.docx')).toBe('docx')
    })
    test('Excel/CSV → xlsx', () => {
      expect(classifyByExt('数据.xlsx')).toBe('xlsx')
      expect(classifyByExt('数据.xls')).toBe('xlsx')
      expect(classifyByExt('数据.csv')).toBe('xlsx')
    })
    test('Markdown → md', () => {
      expect(classifyByExt('笔记.md')).toBe('md')
      expect(classifyByExt('笔记.markdown')).toBe('md')
    })
    test('文本 → txt', () => {
      expect(classifyByExt('日志.txt')).toBe('txt')
      expect(classifyByExt('日志.log')).toBe('txt')
    })
    test('图片 → images', () => {
      expect(classifyByExt('图.png')).toBe('images')
      expect(classifyByExt('图.jpg')).toBe('images')
      expect(classifyByExt('图.jpeg')).toBe('images')
      expect(classifyByExt('图.webp')).toBe('images')
    })
    test('JSON → json', () => {
      expect(classifyByExt('配置.json')).toBe('json')
    })
    test('JS → js', () => {
      expect(classifyByExt('脚本.js')).toBe('js')
      expect(classifyByExt('脚本.mjs')).toBe('js')
    })
    test('未知扩展名 → others', () => {
      expect(classifyByExt('未知.xyz')).toBe(UNKNOWN_TYPE)
      expect(classifyByExt('无扩展名')).toBe(UNKNOWN_TYPE)
    })
  })

  describe('getAllTypes', () => {
    test('包含所有预定义类型 + others', () => {
      const types = getAllTypes()
      expect(types).toContain('pdf')
      expect(types).toContain('docx')
      expect(types).toContain('xlsx')
      expect(types).toContain('md')
      expect(types).toContain('txt')
      expect(types).toContain('images')
      expect(types).toContain('others')
    })
  })

  describe('isMisclassified', () => {
    test('放对位置 → false', () => {
      expect(isMisclassified('pdf/规范.pdf')).toBe(false)
      expect(isMisclassified('md/笔记.md')).toBe(false)
      expect(isMisclassified('txt/日志.txt')).toBe(false)
    })
    test('放错位置 → true', () => {
      expect(isMisclassified('pdf/规范.txt')).toBe(true)
      expect(isMisclassified('md/报告.docx')).toBe(true)
      expect(isMisclassified('xlsx/配置.json')).toBe(true)
    })
    test('根目录文件不算错位（无子目录）', () => {
      expect(isMisclassified('规范.pdf')).toBe(false)
      expect(isMisclassified('临时.md')).toBe(false)
    })
    test('深层路径也能判断', () => {
      expect(isMisclassified('pdf/sub/规范.txt')).toBe(true)
      expect(isMisclassified('pdf/sub/规范.pdf')).toBe(false)
    })
  })

  describe('buildTargetRelPath', () => {
    test('无冲突 → 直接放类型目录', () => {
      expect(buildTargetRelPath('规范.pdf')).toBe('pdf/规范.pdf')
      expect(buildTargetRelPath('笔记.md')).toBe('md/笔记.md')
    })
    test('冲突 1 次 → 加 _1 后缀', () => {
      expect(buildTargetRelPath('规范.pdf', 1)).toBe('pdf/规范_1.pdf')
    })
    test('冲突 3 次 → 加 _3 后缀', () => {
      expect(buildTargetRelPath('数据.xlsx', 3)).toBe('xlsx/数据_3.xlsx')
    })
    test('未知类型 → others 目录', () => {
      expect(buildTargetRelPath('未知.xyz')).toBe('others/未知.xyz')
    })
  })

  describe('getExpectedSubdir', () => {
    test('与 classifyByExt 一致', () => {
      expect(getExpectedSubdir('a.pdf')).toBe('pdf')
      expect(getExpectedSubdir('a.txt')).toBe('txt')
      expect(getExpectedSubdir('a.xyz')).toBe(UNKNOWN_TYPE)
    })
  })
})

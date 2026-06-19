/**
 * FileMessageCard 纯函数核心测试
 * 覆盖：basename / formatSize / iconForType / buildActions / validateFile
 *
 * 跑法：npx jest src/renderer/components/__tests__/FileMessageCard.core.test.js
 */

const {
  basename,
  formatSize,
  iconForType,
  buildActions,
  validateFile,
  SUPPORTED_TYPES,
} = require('../FileMessageCard.core')

describe('FileMessageCard.core', () => {
  describe('basename', () => {
    test('Windows 路径（反斜杠）', () => {
      expect(basename('C:\\Users\\admin\\Documents\\报告.docx')).toBe('报告.docx')
    })

    test('POSIX 路径（正斜杠）', () => {
      expect(basename('/home/user/reports/2026-06-19-mix.md')).toBe('2026-06-19-mix.md')
    })

    test('混合分隔符', () => {
      expect(basename('C:/projects\\mix/result.xlsx')).toBe('result.xlsx')
    })

    test('只有文件名', () => {
      expect(basename('data.pdf')).toBe('data.pdf')
    })

    test('空字符串 / 非字符串 / null 返回空串', () => {
      expect(basename('')).toBe('')
      expect(basename(null)).toBe('')
      expect(basename(undefined)).toBe('')
      expect(basename(123)).toBe('')
    })
  })

  describe('formatSize', () => {
    test('0 字节', () => {
      expect(formatSize(0)).toBe('0 B')
    })

    test('字节级', () => {
      expect(formatSize(500)).toBe('500 B')
    })

    test('KB 级（保留 1 位小数）', () => {
      expect(formatSize(1024)).toBe('1.0 KB')
      expect(formatSize(12 * 1024)).toBe('12.0 KB')
      expect(formatSize(12 * 1024 + 512)).toBe('12.5 KB')
    })

    test('MB 级', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB')
      expect(formatSize(3.4 * 1024 * 1024)).toBe('3.4 MB')
    })

    test('非法输入：负数 / NaN / 字符串', () => {
      expect(formatSize(-1)).toBe('0 B')
      expect(formatSize(Number.NaN)).toBe('0 B')
      expect(formatSize('abc')).toBe('0 B')
      expect(formatSize(null)).toBe('0 B')
    })
  })

  describe('iconForType', () => {
    test('4 种支持的扩展名映射到对应 icon', () => {
      expect(iconForType('docx')).toBe('FileTextOutlined')
      expect(iconForType('xlsx')).toBe('FileExcelOutlined')
      expect(iconForType('md')).toBe('FileMarkdownOutlined')
      expect(iconForType('pdf')).toBe('FilePdfOutlined')
    })

    test('大小写不敏感', () => {
      expect(iconForType('DOCX')).toBe('FileTextOutlined')
      expect(iconForType('Xlsx')).toBe('FileExcelOutlined')
    })

    test('未知类型降级为通用 FileOutlined', () => {
      expect(iconForType('unknown')).toBe('FileOutlined')
      expect(iconForType('')).toBe('FileOutlined')
      expect(iconForType(null)).toBe('FileOutlined')
    })

    test('SUPPORTED_TYPES 包含 4 种类型', () => {
      expect(SUPPORTED_TYPES.size).toBe(4)
      expect(SUPPORTED_TYPES.has('docx')).toBe(true)
      expect(SUPPORTED_TYPES.has('xlsx')).toBe(true)
      expect(SUPPORTED_TYPES.has('md')).toBe(true)
      expect(SUPPORTED_TYPES.has('pdf')).toBe(true)
    })
  })

  describe('buildActions', () => {
    test('onOpen 调用 api.openFile 并把 filePath 作为参数', () => {
      const { onOpen } = buildActions()
      const api = { openFile: jest.fn() }
      onOpen(api, 'C:/a/b.docx')
      expect(api.openFile).toHaveBeenCalledWith('C:/a/b.docx')
      expect(api.openFile).toHaveBeenCalledTimes(1)
    })

    test('onShowInFolder 调用 api.showInFolder', () => {
      const { onShowInFolder } = buildActions()
      const api = { showInFolder: jest.fn() }
      onShowInFolder(api, '/tmp/x.pdf')
      expect(api.showInFolder).toHaveBeenCalledWith('/tmp/x.pdf')
    })

    test('onCopyPath 调用 clipboard.writeText', () => {
      const { onCopyPath } = buildActions()
      const cb = { writeText: jest.fn() }
      onCopyPath(cb, 'D:\\report.xlsx')
      expect(cb.writeText).toHaveBeenCalledWith('D:\\report.xlsx')
    })

    test('api 缺失时返回 undefined（不抛错）', () => {
      const { onOpen, onShowInFolder, onCopyPath } = buildActions()
      expect(onOpen(undefined, '/x')).toBeUndefined()
      expect(onShowInFolder({}, '/x')).toBeUndefined()
      expect(onCopyPath(null, '/x')).toBeUndefined()
    })

    test('api 存在但方法缺失时返回 undefined', () => {
      const { onOpen } = buildActions()
      const api = {} // 没有 openFile
      expect(onOpen(api, '/x')).toBeUndefined()
    })
  })

  describe('validateFile', () => {
    test('合法输入', () => {
      expect(validateFile({ path: '/a/b.docx' })).toEqual({ ok: true })
      expect(validateFile({ path: '/a/b.docx', size: 1024, type: 'docx' })).toEqual({ ok: true })
    })

    test('缺失 file 对象', () => {
      expect(validateFile(null)).toEqual({ ok: false, error: 'file 必须是对象' })
      expect(validateFile()).toEqual({ ok: false, error: 'file 必须是对象' })
      expect(validateFile('str')).toEqual({ ok: false, error: 'file 必须是对象' })
    })

    test('缺失 path', () => {
      expect(validateFile({})).toEqual({ ok: false, error: 'file.path 必填且为字符串' })
      expect(validateFile({ path: '' })).toEqual({ ok: false, error: 'file.path 必填且为字符串' })
      expect(validateFile({ path: 123 })).toEqual({ ok: false, error: 'file.path 必填且为字符串' })
    })

    test('size 非法', () => {
      expect(validateFile({ path: '/a', size: -1 })).toEqual({ ok: false, error: 'file.size 必须是非负数' })
      expect(validateFile({ path: '/a', size: 'big' })).toEqual({ ok: false, error: 'file.size 必须是非负数' })
    })

    test('type 非字符串', () => {
      expect(validateFile({ path: '/a', type: 1 })).toEqual({ ok: false, error: 'file.type 必须是字符串' })
    })
  })
})

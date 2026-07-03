const path = require('path')
const os = require('os')
const fs = require('fs').promises
const {
  readRaw,
  isTextFile,
  isBinaryFile,
  isPathExcluded,
  validateRelativePath,
  MAX_SIZE
} = require('../../agent/rawReader')

describe('rawReader', () => {
  let tmpDir

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `rawreader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('isTextFile / isBinaryFile', () => {
    test('文本扩展名识别', () => {
      expect(isTextFile('a.md')).toBe(true)
      expect(isTextFile('a.txt')).toBe(true)
      expect(isTextFile('a.json')).toBe(true)
      expect(isTextFile('a.csv')).toBe(true)
      expect(isTextFile('a.js')).toBe(true)
      expect(isTextFile('a.yaml')).toBe(true)
    })

    test('二进制扩展名识别', () => {
      expect(isBinaryFile('a.pdf')).toBe(true)
      expect(isBinaryFile('a.docx')).toBe(true)
      expect(isBinaryFile('a.xlsx')).toBe(true)
      expect(isBinaryFile('a.png')).toBe(true)
      expect(isBinaryFile('a.zip')).toBe(true)
    })

    test('未知扩展名既不是文本也不是二进制', () => {
      expect(isTextFile('a.xyz')).toBe(false)
      expect(isBinaryFile('a.xyz')).toBe(false)
    })
  })

  describe('isPathExcluded', () => {
    test('排除系统目录', () => {
      expect(isPathExcluded('node_modules/pkg/index.js')).toBe(true)
      expect(isPathExcluded('.git/config')).toBe(true)
      expect(isPathExcluded('.tmp/cache.txt')).toBe(true)
    })

    test('排除内部目录', () => {
      expect(isPathExcluded('wiki/index.md')).toBe(true)
      expect(isPathExcluded('reports/r.docx')).toBe(true)
      expect(isPathExcluded('chat-history/s1.md')).toBe(true)
    })

    test('普通路径不排除', () => {
      expect(isPathExcluded('临时.md')).toBe(false)
      expect(isPathExcluded('raw/md/笔记.md')).toBe(false)
      expect(isPathExcluded('sub/a.txt')).toBe(false)
    })
  })

  describe('validateRelativePath', () => {
    test('空路径拒绝', () => {
      expect(validateRelativePath('').valid).toBe(false)
      expect(validateRelativePath(null).valid).toBe(false)
    })

    test('绝对路径拒绝', () => {
      expect(validateRelativePath('D:/test/a.md').valid).toBe(false)
      expect(validateRelativePath('/home/a.md').valid).toBe(false)
      expect(validateRelativePath('~/a.md').valid).toBe(false)
    })

    test('.. 越界拒绝', () => {
      expect(validateRelativePath('../a.md').valid).toBe(false)
      expect(validateRelativePath('sub/../../a.md').valid).toBe(false)
    })

    test('正常相对路径通过', () => {
      expect(validateRelativePath('a.md').valid).toBe(true)
      expect(validateRelativePath('raw/md/笔记.md').valid).toBe(true)
    })
  })

  describe('readRaw 正常路径', () => {
    test('读 md 文件返回内容', async () => {
      const rel = '笔记.md'
      await fs.writeFile(path.join(tmpDir, rel), '# 标题\n\n正文内容')
      const result = await readRaw(tmpDir, rel)
      expect(result.success).toBe(true)
      expect(result.content).toContain('# 标题')
      expect(result.content).toContain('正文内容')
      expect(result.truncated).toBe(false)
    })

    test('读 txt 文件返回内容', async () => {
      const rel = '临时.txt'
      await fs.writeFile(path.join(tmpDir, rel), '纯文本')
      const result = await readRaw(tmpDir, rel)
      expect(result.success).toBe(true)
      expect(result.content).toBe('纯文本')
    })

    test('读 json 文件返回内容', async () => {
      const rel = '配置.json'
      await fs.writeFile(path.join(tmpDir, rel), '{"a":1}')
      const result = await readRaw(tmpDir, rel)
      expect(result.success).toBe(true)
      expect(result.content).toBe('{"a":1}')
    })

    test('读子目录文件', async () => {
      const rel = 'raw/md/笔记.md'
      await fs.mkdir(path.join(tmpDir, 'raw', 'md'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, rel), '子目录内容')
      const result = await readRaw(tmpDir, rel)
      expect(result.success).toBe(true)
      expect(result.content).toBe('子目录内容')
    })
  })

  describe('readRaw 错误处理', () => {
    test('文件不存在 → NOT_FOUND', async () => {
      const result = await readRaw(tmpDir, '不存在.md')
      expect(result.success).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })

    test('二进制文件 → BINARY_REJECTED', async () => {
      const result = await readRaw(tmpDir, '规范.pdf')
      expect(result.success).toBe(false)
      expect(result.code).toBe('BINARY_REJECTED')
      expect(result.hint).toContain('ingest')
    })

    test('Word 文件 → BINARY_REJECTED', async () => {
      const result = await readRaw(tmpDir, '报告.docx')
      expect(result.success).toBe(false)
      expect(result.code).toBe('BINARY_REJECTED')
    })

    test('不支持的扩展名 → UNSUPPORTED_EXT', async () => {
      const result = await readRaw(tmpDir, '未知.xyz')
      expect(result.success).toBe(false)
      expect(result.code).toBe('UNSUPPORTED_EXT')
    })

    test('绝对路径 → PATH_INVALID', async () => {
      const result = await readRaw(tmpDir, 'D:/test/a.md')
      expect(result.success).toBe(false)
      expect(result.code).toBe('PATH_INVALID')
    })

    test('.. 越界 → PATH_INVALID', async () => {
      const result = await readRaw(tmpDir, '../escape.md')
      expect(result.success).toBe(false)
      expect(result.code).toBe('PATH_INVALID')
    })

    test('排除目录 → PATH_INVALID', async () => {
      const result = await readRaw(tmpDir, 'node_modules/pkg/index.js')
      expect(result.success).toBe(false)
      expect(result.code).toBe('PATH_INVALID')
    })
  })

  describe('readRaw 大文件截断', () => {
    test('超过 MAX_SIZE 截断', async () => {
      const big = 'a'.repeat(MAX_SIZE + 1024)
      await fs.writeFile(path.join(tmpDir, 'big.txt'), big)
      const result = await readRaw(tmpDir, 'big.txt')
      expect(result.success).toBe(true)
      expect(result.truncated).toBe(true)
      expect(result.size).toBeGreaterThan(MAX_SIZE)
      expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(MAX_SIZE)
      expect(result.note).toContain('截断')
    })

    test('刚好等于 MAX_SIZE 不截断', async () => {
      const exact = 'a'.repeat(MAX_SIZE)
      await fs.writeFile(path.join(tmpDir, 'exact.txt'), exact)
      const result = await readRaw(tmpDir, 'exact.txt')
      expect(result.success).toBe(true)
      expect(result.truncated).toBe(false)
    })
  })
})

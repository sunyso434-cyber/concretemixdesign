// write-handler.test.js（Task 3.2）
// 测试 workspace/write-handler.js 薄封装：
//   - 调 dispatcher 生成 Buffer
//   - 写盘到 <workspacePath>/reports/<filename>
//   - 返回 { path, size, savedAt }
//   - 工作区未打开 → 抛 WorkspaceError(NOT_OPEN)
//   - 写盘失败 → 包 WorkspaceError(WRITE_FAIL)
//   - dispatcher 失败（未知 type） → 包 WorkspaceError(WRITE_FAIL)
//
// 设计：write-handler 接受 { workspaceManager, type, filename, payload }，
// fs 通过 jest.mock 注入，便于测试。
const path = require('path')

// Mock fs.promises.writeFile（在 require write-handler 之前）
const mockWriteFile = jest.fn()
jest.mock('fs', () => ({
  promises: {
    writeFile: (...args) => mockWriteFile(...args)
  }
}))

const { WorkspaceError } = require('../../workspace/WorkspaceError')
const { writeFile } = require('../../workspace/write-handler')

function makeWorkspaceManagerMock(currentReturn) {
  return {
    current: jest.fn().mockReturnValue(currentReturn)
  }
}

describe('write-handler（Task 3.2 薄封装）', () => {
  beforeEach(() => {
    mockWriteFile.mockReset()
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('正常路径（3 种 type）', () => {
    test('docx → 写 reports/<name>.docx 并返回 { path, size, savedAt }', async () => {
      const workspacePath = '/ws/test-workspace'
      const managerMock = makeWorkspaceManagerMock({ path: workspacePath, status: 'ready' })

      const result = await writeFile({
        workspaceManager: managerMock,
        type: 'docx',
        filename: 'report.docx',
        payload: { title: 'r', sections: [{ type: 'h1', content: 'h' }] }
      })

      // 写盘路径正确
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
      const [writtenPath, buf] = mockWriteFile.mock.calls[0]
      expect(writtenPath).toBe(path.posix.join(workspacePath, 'reports', 'report.docx'))
      expect(Buffer.isBuffer(buf)).toBe(true)
      expect(buf.length).toBeGreaterThan(1000)
      // 返回结构
      expect(result).toHaveProperty('path', writtenPath)
      expect(result).toHaveProperty('size', buf.length)
      expect(result.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    test('xlsx → 写 reports/<name>.xlsx', async () => {
      const managerMock = makeWorkspaceManagerMock({ path: '/ws', status: 'ready' })

      const result = await writeFile({
        workspaceManager: managerMock,
        type: 'xlsx',
        filename: 'data.xlsx',
        payload: { title: 'd', sections: [{ type: 'table', rows: [['a', 'b']] }] }
      })

      const [writtenPath, buf] = mockWriteFile.mock.calls[0]
      expect(writtenPath).toBe(path.posix.join('/ws', 'reports', 'data.xlsx'))
      expect(Buffer.isBuffer(buf)).toBe(true)
      expect(result.size).toBe(buf.length)
    })

    test('md → 写 reports/<name>.md（content 含 payload）', async () => {
      const managerMock = makeWorkspaceManagerMock({ path: '/ws', status: 'ready' })

      const result = await writeFile({
        workspaceManager: managerMock,
        type: 'md',
        filename: 'note.md',
        payload: { title: 'n', sections: [{ type: 'p', content: 'hello world' }] }
      })

      const [writtenPath, buf] = mockWriteFile.mock.calls[0]
      expect(writtenPath).toBe(path.posix.join('/ws', 'reports', 'note.md'))
      expect(buf.toString('utf-8')).toContain('hello world')
      expect(result.size).toBe(buf.length)
    })
  })

  describe('错误路径', () => {
    test('工作区未打开 → 抛 WorkspaceError(NOT_OPEN, retryable=false)', async () => {
      const managerMock = makeWorkspaceManagerMock(null)  // current() → null

      try {
        await writeFile({
          workspaceManager: managerMock,
          type: 'docx',
          filename: 'r.docx',
          payload: { title: 't', sections: [] }
        })
        throw new Error('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkspaceError)
        expect(err.code).toBe('NOT_OPEN')
        expect(err.retryable).toBe(false)
      }
      // 不应触发写盘
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    test('写盘失败 → 包 WorkspaceError(WRITE_FAIL, retryable=true)', async () => {
      mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'))
      const managerMock = makeWorkspaceManagerMock({ path: '/ws', status: 'ready' })

      try {
        await writeFile({
          workspaceManager: managerMock,
          type: 'md',
          filename: 'n.md',
          payload: { title: 't', sections: [{ type: 'p', content: 'x' }] }
        })
        throw new Error('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkspaceError)
        expect(err.code).toBe('WRITE_FAIL')
        expect(err.retryable).toBe(true)
        expect(err.cause).toBeInstanceOf(Error)
        expect(err.cause.message).toContain('EACCES')
      }
    })

    test('未知 type → dispatcher 抛错 → 包为 WorkspaceError(WRITE_FAIL)', async () => {
      const managerMock = makeWorkspaceManagerMock({ path: '/ws', status: 'ready' })

      try {
        await writeFile({
          workspaceManager: managerMock,
          type: 'pdf',
          filename: 'x.pdf',
          payload: { title: 't', sections: [] }
        })
        throw new Error('应该抛错')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkspaceError)
        expect(err.code).toBe('WRITE_FAIL')
        expect(err.cause).toBeInstanceOf(Error)
        expect(err.cause.message).toMatch(/unknown writer type/i)
      }

      // dispatcher 失败时不应触发写盘
      expect(mockWriteFile).not.toHaveBeenCalled()
    })
  })

  describe('路径处理', () => {
    test('workspaceManager.current() 返回 Windows 风格路径时正确拼接（仍用 / 分隔）', async () => {
      // v4.10.0 WorkspaceManager.open() 已经把 path 转为 '/'
      // write-handler 仍用 path.posix.join 保证跨平台一致
      const managerMock = makeWorkspaceManagerMock({ path: 'C:/ws/test', status: 'ready' })

      await writeFile({
        workspaceManager: managerMock,
        type: 'md',
        filename: 'a.md',
        payload: { title: 't', sections: [{ type: 'p', content: 'x' }] }
      })

      const [writtenPath] = mockWriteFile.mock.calls[0]
      expect(writtenPath).toBe(path.posix.join('C:/ws/test', 'reports', 'a.md'))
      expect(writtenPath).not.toContain('\\')
    })
  })
})
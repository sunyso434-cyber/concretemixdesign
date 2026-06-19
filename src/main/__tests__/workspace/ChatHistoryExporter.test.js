/**
 * ChatHistoryExporter 单元测试
 *
 * 测纯函数转换：formatMD / formatJSONL / parseJSONL，以及 loadSession（IO 读）。
 */

// Mock fs.promises for loadSession IO tests
const mockReadFile = jest.fn()
jest.mock('fs', () => ({
  promises: { readFile: mockReadFile }
}))

const { ChatHistoryExporter } = require('../../workspace/ChatHistoryExporter')

describe('ChatHistoryExporter（纯函数转换）', () => {
  let exporter

  beforeEach(() => {
    exporter = new ChatHistoryExporter()
  })

  // ==================== formatJSONL ====================

  describe('formatJSONL', () => {
    test('空数组返回仅换行', () => {
      expect(exporter.formatJSONL([])).toBe('\n')
    })

    test('单条消息生成一行 JSON', () => {
      const messages = [
        { id: 1, role: 'user', content: '你好', createdAt: '2025-01-01T00:00:00Z' }
      ]
      const result = exporter.formatJSONL(messages)
      expect(result).toContain('"id":1')
      expect(result).toContain('"role":"user"')
      expect(result).toContain('"content":"你好"')
      expect(result.endsWith('\n')).toBe(true)
    })

    test('多条消息生成多行', () => {
      const messages = [
        { id: 1, role: 'user', content: 'hello', createdAt: '2025-01-01T00:00:00Z' },
        { id: 2, role: 'assistant', content: 'hi', createdAt: '2025-01-01T00:00:01Z' }
      ]
      const lines = exporter.formatJSONL(messages).trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]).id).toBe(1)
      expect(JSON.parse(lines[1]).id).toBe(2)
    })

    test('包含 toolCalls 的消息', () => {
      const messages = [
        { id: 1, role: 'assistant', content: '', createdAt: '2025-01-01T00:00:00Z',
          toolCalls: [{ name: 'search', args: { q: 'test' } }] }
      ]
      const result = exporter.formatJSONL(messages)
      const parsed = JSON.parse(result.trim().split('\n')[0])
      expect(parsed.toolCalls).toEqual([{ name: 'search', args: { q: 'test' } }])
    })

    test('包含 attachments 的消息', () => {
      const messages = [
        { id: 1, role: 'user', content: '看图', createdAt: '2025-01-01T00:00:00Z',
          metadata: { attachments: [{ name: 'pic.png', path: '/tmp/pic.png', type: 'image/png' }] } }
      ]
      const result = exporter.formatJSONL(messages)
      const parsed = JSON.parse(result.trim().split('\n')[0])
      expect(parsed.attachments).toEqual([{ name: 'pic.png', path: '/tmp/pic.png', type: 'image/png' }])
    })

    test('toolCalls 为 JSON 字符串时可正常解析', () => {
      const messages = [
        { id: 1, role: 'assistant', content: '', createdAt: '2025-01-01T00:00:00Z',
          toolCalls: JSON.stringify([{ name: 'calc', args: { expr: '1+1' } }]) }
      ]
      const result = exporter.formatJSONL(messages)
      const parsed = JSON.parse(result.trim().split('\n')[0])
      expect(parsed.toolCalls).toEqual([{ name: 'calc', args: { expr: '1+1' } }])
    })
  })

  // ==================== parseJSONL ====================

  describe('parseJSONL', () => {
    test('空字符串返回空数组', () => {
      expect(exporter.parseJSONL('')).toEqual([])
    })

    test('仅空白返回空数组', () => {
      expect(exporter.parseJSONL('  \n  ')).toEqual([])
    })

    test('单行 JSON 解析为单元素数组', () => {
      const jsonl = JSON.stringify({ id: 1, role: 'user' }) + '\n'
      const result = exporter.parseJSONL(jsonl)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })

    test('多行 JSONL 解析', () => {
      const jsonl =
        JSON.stringify({ id: 1, role: 'user' }) + '\n' +
        JSON.stringify({ id: 2, role: 'assistant' }) + '\n'
      const result = exporter.parseJSONL(jsonl)
      expect(result).toHaveLength(2)
      expect(result[1].id).toBe(2)
    })

    test('parseJSONL 是 formatJSONL 的逆运算', () => {
      const messages = [
        { id: 1, role: 'user', content: 'hi', createdAt: '2025-01-01T00:00:00Z' },
        { id: 2, role: 'assistant', content: 'hello', createdAt: '2025-01-01T00:00:01Z' }
      ]
      const jsonl = exporter.formatJSONL(messages)
      const parsed = exporter.parseJSONL(jsonl)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].id).toBe(1)
      expect(parsed[1].id).toBe(2)
    })
  })

  // ==================== formatMD ====================

  describe('formatMD', () => {
    const sessionId = 'test-session-12345678'
    const workspacePath = 'C:\\Users\\test\\workspace'

    test('空消息数组生成含 frontmatter 的 MD', () => {
      const md = exporter.formatMD(sessionId, [], workspacePath)
      expect(md).toContain('---')
      expect(md).toContain('sessionId: test-session-12345678')
      expect(md).toContain('messageCount: 0')
    })

    test('workspacePath 反斜杠转为正斜杠', () => {
      const md = exporter.formatMD(sessionId, [], 'C:\\Users\\test\\ws')
      // gray-matter 对含特殊字符的值加单引号
      expect(md).toContain('C:/Users/test/ws')
    })

    test('用户消息和助手消息分别计数', () => {
      const messages = [
        { id: 1, role: 'user', content: '你好', createdAt: '2025-01-01T00:00:00Z' },
        { id: 2, role: 'assistant', content: '你好！', createdAt: '2025-01-01T00:00:01Z' },
        { id: 3, role: 'user', content: '帮我写代码', createdAt: '2025-01-01T00:00:02Z' }
      ]
      const md = exporter.formatMD(sessionId, messages, workspacePath)
      expect(md).toContain('messageCount: 3')
    })

    test('每条消息包括时间戳和角色标签', () => {
      const messages = [
        { id: 1, role: 'user', content: '测试消息', createdAt: '2025-06-19T10:00:00Z' }
      ]
      const md = exporter.formatMD(sessionId, messages, workspacePath)
      expect(md).toContain('🧑 用户')
      expect(md).toContain('2025-06-19T10:00:00Z')
      expect(md).toContain('测试消息')
    })

    test('助手消息显示机器人标签', () => {
      const messages = [
        { id: 1, role: 'assistant', content: '回复', createdAt: '2025-01-01T00:00:00Z' }
      ]
      const md = exporter.formatMD(sessionId, messages, workspacePath)
      expect(md).toContain('🤖 助手')
    })

    test('toolCalls 生成折叠块', () => {
      const messages = [
        { id: 1, role: 'assistant', content: '我来查一下',
          createdAt: '2025-01-01T00:00:00Z',
          toolCalls: [{ name: 'web_search', args: { query: '混凝土配合比' } }] }
      ]
      const md = exporter.formatMD(sessionId, messages, workspacePath)
      expect(md).toContain('<details>')
      expect(md).toContain('🔧 工具调用：web_search')
      expect(md).toContain('```json')
      expect(md).toContain('"query": "混凝土配合比"')
    })

    test('图片附件生成 markdown 图片', () => {
      const messages = [
        { id: 1, role: 'user', content: '看图',
          createdAt: '2025-01-01T00:00:00Z',
          metadata: { attachments: [{ name: 'photo.png', path: '/tmp/photo.png', type: 'image/png' }] } }
      ]
      const md = exporter.formatMD(sessionId, messages, workspacePath)
      expect(md).toContain('![photo.png](file:///tmp/photo.png)')
    })

    test('非图片附件显示文件路径', () => {
      const messages = [
        { id: 1, role: 'user', content: '文件',
          createdAt: '2025-01-01T00:00:00Z',
          metadata: { attachments: [{ name: 'doc.pdf', path: '/tmp/doc.pdf', type: 'application/pdf' }] } }
      ]
      const md = exporter.formatMD(sessionId, messages, workspacePath)
      expect(md).toContain('📎 附件：')
      expect(md).toContain('/tmp/doc.pdf')
    })

    test('frontmatter 包含 exportedAt', () => {
      const md = exporter.formatMD(sessionId, [], workspacePath)
      expect(md).toContain('exportedAt:')
    })

    test('没有 createdAt 的消息使用当前时间', () => {
      const messages = [
        { id: 1, role: 'user', content: 'test' }
      ]
      const md = exporter.formatMD(sessionId, messages, workspacePath)
      // firstActivity / lastActivity 在 frontmatter 中
      expect(md).toContain('firstActivity:')
      expect(md).toContain('lastActivity:')
    })
  })

  // ==================== loadSession ====================

  describe('loadSession', () => {
    const sessionId = 'test-session-12345678'
    const workspacePath = '/test/workspace'

    beforeEach(() => {
      mockReadFile.mockReset()
    })

    test('读取并解析 JSONL 和 MD 文件', async () => {
      const jsonlContent = JSON.stringify({ id: 1, role: 'user', content: 'hello' }) + '\n' +
                           JSON.stringify({ id: 2, role: 'assistant', content: 'hi' }) + '\n'
      const mdContent = [
        '---',
        'sessionId: test-session-12345678',
        'workspacePath: /test/workspace',
        'messageCount: 2',
        'firstActivity: 2025-01-01T00:00:00.000Z',
        'lastActivity: 2025-01-01T00:00:01.000Z',
        'exportedAt: 2025-01-01T00:00:02.000Z',
        '---',
        '',
        '# 会话内容'
      ].join('\n')

      mockReadFile
        .mockResolvedValueOnce(jsonlContent)  // 第一次：读 JSONL
        .mockResolvedValueOnce(mdContent)      // 第二次：读 MD

      const result = await exporter.loadSession(sessionId, workspacePath)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].id).toBe(1)
      expect(result.messages[0].role).toBe('user')
      expect(result.messages[1].id).toBe(2)
      expect(result.messages[1].role).toBe('assistant')
      expect(result.renderedMd).toBe(mdContent)
      expect(result.summary).toMatchObject({
        sessionId: 'test-session-12345678',
        workspacePath: '/test/workspace',
        messageCount: 2
      })
    })

    test('slng 取 sessionId 前 8 位', async () => {
      mockReadFile
        .mockResolvedValueOnce('{"id":1}\n')
        .mockResolvedValueOnce('---\nsessionId: foo\n---')

      await exporter.loadSession(sessionId, workspacePath)

      // 验证 JSONL 路径包含 slug（前 8 位）: test-sess（跨平台分隔符）
      const call1 = mockReadFile.mock.calls[0][0]
      expect(call1).toMatch(/wiki[/\\]chat-history[/\\]test-ses[/\\]session\.jsonl$/)
      const call2 = mockReadFile.mock.calls[1][0]
      expect(call2).toMatch(/wiki[/\\]chat-history[/\\]test-ses[/\\]session\.md$/)
    })

    test('空 JSONL 返回空消息数组', async () => {
      mockReadFile
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('---\nsessionId: empty\n---')

      const result = await exporter.loadSession(sessionId, workspacePath)

      expect(result.messages).toEqual([])
      expect(result.summary).toMatchObject({ sessionId: 'empty' })
    })

    test('JSONL 一行一条消息', async () => {
      const messages = [
        { id: 1, role: 'user', content: 'a' },
        { id: 2, role: 'assistant', content: 'b', toolCalls: [{ name: 'search', args: {} }] }
      ]
      const jsonl = messages.map(m => JSON.stringify(m)).join('\n') + '\n'

      mockReadFile
        .mockResolvedValueOnce(jsonl)
        .mockResolvedValueOnce('---\nsessionId: multi\n---')

      const result = await exporter.loadSession(sessionId, workspacePath)
      expect(result.messages).toHaveLength(2)
      expect(result.messages[1].toolCalls).toEqual([{ name: 'search', args: {} }])
    })
  })
})

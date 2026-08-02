'use strict'

// RemoteAgentBridge 测试：
//   - agent:run：persistUserMessage:true + sink=fanout；imageRefs → base64 attachments（mimeType 按扩展名映射）
//   - agent:confirm / agent:pause / agent:resume / agent:abort 路由到 executor
//   - todo:list 转发 todo-manage skill 的 list action（与 agentHandler.js:354 相同逻辑）
//   - executor 单例：构造注入 + 未注入时经 agentHandler.getExecutor() 取共享实例
// 全 mock：executor / todo-manage / fs.readFileSync；ws 用 { send: jest.fn() } 替身。

jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return { ...actual, readFileSync: jest.fn() }
})

jest.mock('../../skills/todo-manage', () => ({ execute: jest.fn() }))

// 共享 executor mock（jest.mock 工厂可引用 mock 前缀变量）
const mockExecutor = {
  runAgentSession: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  abort: jest.fn(),
  confirm: jest.fn()
}
let mockGetExecutorResult = mockExecutor
jest.mock('../../ipcHandlers/agentHandler', () => ({ getExecutor: () => mockGetExecutorResult }))

const fs = require('fs')
const RemoteAgentBridge = require('../RemoteAgentBridge')
const todoManage = require('../../skills/todo-manage')

function createWs() {
  return { send: jest.fn() }
}
function createFanout() {
  return { send: jest.fn(), addTarget: jest.fn(), removeTarget: jest.fn() }
}

describe('RemoteAgentBridge', () => {
  let bridge
  let ws
  let fanout

  beforeEach(() => {
    mockExecutor.runAgentSession.mockReset()
    mockExecutor.pause.mockReset()
    mockExecutor.resume.mockReset()
    mockExecutor.abort.mockReset()
    mockExecutor.confirm.mockReset()
    todoManage.execute.mockReset()
    fs.readFileSync.mockReset()
    fs.readFileSync.mockReturnValue(Buffer.from('fake-bytes'))

    mockGetExecutorResult = mockExecutor
    bridge = new RemoteAgentBridge({ executor: mockExecutor })
    ws = createWs()
    fanout = createFanout()
  })

  describe('agent:run', () => {
    test('传 persistUserMessage:true 且 sink=fanout，回最终结果', async () => {
      mockExecutor.runAgentSession.mockResolvedValue({ success: true, result: { reply: '好的' } })

      await bridge.handleMessage(ws, {
        type: 'agent:run',
        requestId: 'req-test-1',
        sessionId: 's1',
        message: '设计C30配合比',
        mode: 'auto'
      }, fanout)

      expect(mockExecutor.runAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          requestId: 'req-test-1',
          message: '设计C30配合比',
          mode: 'auto',
          sink: fanout,
          persistUserMessage: true
        })
      )
      expect(ws.send).toHaveBeenCalledWith('agent:run', expect.objectContaining({
        requestId: 'req-test-1',
        success: true,
        result: { reply: '好的' }
      }))
    })

    test('运行失败回 { success:false, error }', async () => {
      mockExecutor.runAgentSession.mockResolvedValue({ success: false, error: 'API未配置' })

      await bridge.handleMessage(ws, { type: 'agent:run', requestId: 'req-f', sessionId: 's1', message: 'x' }, fanout)

      expect(ws.send).toHaveBeenCalledWith('agent:run', expect.objectContaining({
        requestId: 'req-f',
        success: false,
        error: 'API未配置'
      }))
    })

    test('缺少 sessionId → 不调 executor，回错误', async () => {
      await bridge.handleMessage(ws, { type: 'agent:run', requestId: 'req-x', message: 'x' }, fanout)

      expect(mockExecutor.runAgentSession).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:run', expect.objectContaining({
        requestId: 'req-x',
        success: false
      }))
    })

    test('缺少 message → 回错误', async () => {
      await bridge.handleMessage(ws, { type: 'agent:run', requestId: 'req-y', sessionId: 's1' }, fanout)

      expect(mockExecutor.runAgentSession).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:run', expect.objectContaining({
        requestId: 'req-y',
        success: false
      }))
    })

    test('无 imageRefs → attachments 为空数组', async () => {
      mockExecutor.runAgentSession.mockResolvedValue({ success: true, result: {} })

      await bridge.handleMessage(ws, { type: 'agent:run', requestId: 'req-n', sessionId: 's1', message: 'x' }, fanout)

      expect(mockExecutor.runAgentSession).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] }))
    })
  })

  describe('imageRefs → base64 attachments', () => {
    test('jpg/jpeg/png/webp 按扩展名映射 mimeType 并含 base64', async () => {
      mockExecutor.runAgentSession.mockResolvedValue({ success: true, result: {} })
      fs.readFileSync.mockReturnValue(Buffer.from('img-bytes'))
      const expectedBase64 = Buffer.from('img-bytes').toString('base64')

      await bridge.handleMessage(ws, {
        type: 'agent:run',
        requestId: 'req-img',
        sessionId: 's1',
        message: '看看这张图',
        imageRefs: [
          { path: '/tmp/a.jpg' },
          { path: '/tmp/b.jpeg' },
          { path: '/tmp/c.png' },
          { path: '/tmp/d.webp' }
        ]
      }, fanout)

      expect(mockExecutor.runAgentSession).toHaveBeenCalledWith(expect.objectContaining({
        attachments: [
          { type: 'image', base64: expectedBase64, mimeType: 'image/jpeg', originalName: 'a.jpg' },
          { type: 'image', base64: expectedBase64, mimeType: 'image/jpeg', originalName: 'b.jpeg' },
          { type: 'image', base64: expectedBase64, mimeType: 'image/png', originalName: 'c.png' },
          { type: 'image', base64: expectedBase64, mimeType: 'image/webp', originalName: 'd.webp' }
        ]
      }))
    })

    test('条目缺 path / 读文件失败 → 跳过该图，不阻塞 run', async () => {
      mockExecutor.runAgentSession.mockResolvedValue({ success: true, result: {} })
      fs.readFileSync.mockImplementation((p) => {
        if (p === '/tmp/missing.png') throw new Error('ENOENT')
        return Buffer.from('ok')
      })

      await bridge.handleMessage(ws, {
        type: 'agent:run',
        requestId: 'req-skip',
        sessionId: 's1',
        message: 'x',
        imageRefs: [null, { path: '/tmp/missing.png' }, '/tmp/good.jpg']
      }, fanout)

      expect(mockExecutor.runAgentSession).toHaveBeenCalledWith(expect.objectContaining({
        attachments: [
          { type: 'image', base64: Buffer.from('ok').toString('base64'), mimeType: 'image/jpeg', originalName: 'good.jpg' }
        ]
      }))
    })
  })

  describe('agent:confirm 路由', () => {
    test('confirm 转发 executor.confirm 并回成功', async () => {
      mockExecutor.confirm.mockReturnValue({ success: true })

      await bridge.handleMessage(ws, {
        type: 'agent:confirm',
        requestId: 'req-c',
        sessionId: 's1',
        confirmed: true,
        args: { a: 1 }
      }, fanout)

      expect(mockExecutor.confirm).toHaveBeenCalledWith({ sessionId: 's1', confirmed: true, args: { a: 1 } })
      expect(ws.send).toHaveBeenCalledWith('agent:confirm', expect.objectContaining({ requestId: 'req-c', success: true }))
    })
  })

  describe('agent:pause/resume/abort 路由', () => {
    test.each([
      ['agent:pause', 'pause'],
      ['agent:resume', 'resume'],
      ['agent:abort', 'abort']
    ])('%s → executor.%s', async (channel, method) => {
      mockExecutor[method].mockReturnValue({ success: true })

      await bridge.handleMessage(ws, { type: channel, requestId: 'req-p', sessionId: 's1' }, fanout)

      expect(mockExecutor[method]).toHaveBeenCalledWith({ sessionId: 's1' })
      expect(ws.send).toHaveBeenCalledWith(channel, expect.objectContaining({ requestId: 'req-p', success: true }))
    })
  })

  describe('todo:list', () => {
    test('转发 todo-manage skill 的 list action，回清单', async () => {
      todoManage.execute.mockResolvedValue({
        success: true,
        action: 'list',
        todos: [{ id: 't1', content: '出配合比', status: 'pending' }],
        total: 1,
        completed: 0
      })

      await bridge.handleMessage(ws, { type: 'todo:list', requestId: 'req-t', sessionId: 's1' }, fanout)

      expect(todoManage.execute).toHaveBeenCalledWith(
        { action: 'list' },
        expect.objectContaining({ sessionId: 's1' })
      )
      expect(ws.send).toHaveBeenCalledWith('todo:list', expect.objectContaining({
        requestId: 'req-t',
        success: true,
        total: 1,
        completed: 0
      }))
    })

    test('缺少 sessionId → 回错误清单', async () => {
      await bridge.handleMessage(ws, { type: 'todo:list', requestId: 'req-t0' }, fanout)

      expect(todoManage.execute).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('todo:list', expect.objectContaining({
        requestId: 'req-t0',
        success: false,
        todos: [],
        total: 0,
        completed: 0
      }))
    })
  })

  describe('executor 单例解析', () => {
    test('未注入 executor 时经 agentHandler.getExecutor() 取共享实例', async () => {
      const fallbackBridge = new RemoteAgentBridge()
      mockExecutor.runAgentSession.mockResolvedValue({ success: true, result: {} })

      await fallbackBridge.handleMessage(ws, {
        type: 'agent:run', requestId: 'req-g', sessionId: 's1', message: 'x'
      }, fanout)

      expect(mockExecutor.runAgentSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }))
      expect(ws.send).toHaveBeenCalledWith('agent:run', expect.objectContaining({ requestId: 'req-g', success: true }))
    })

    test('executor 不可用 → 回 EXECUTOR_NOT_READY（不抛错）', async () => {
      mockGetExecutorResult = null
      const noExecBridge = new RemoteAgentBridge()

      await noExecBridge.handleMessage(ws, {
        type: 'agent:run', requestId: 'req-e', sessionId: 's1', message: 'x'
      }, fanout)

      expect(mockExecutor.runAgentSession).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:run', expect.objectContaining({
        requestId: 'req-e',
        success: false,
        error: 'EXECUTOR_NOT_READY'
      }))
    })
  })
})

'use strict'

// RemoteSessionApi 测试（R7）：
//   - 6 个会话通道：agent:listSessions / getSessionMessages / createSession / deleteSession / archiveSession / renameSession
//   - 复用现有逻辑：getSessionMessages/deleteSession 调 AgentMemoryService（mock）；listSessions/archiveSession/renameSession
//     走 db/database 模型 + SessionService；archiveSessionCore 用真实实现验证批量语义（跳过运行中）；
//     ToolResultStore mock 掉避免碰用户主目录
//   - 响应约定与 R6 一致：同通道回 { requestId, success, ... }；requestId 缺省时自动生成
//   - I2：archiveSession 归档后 fanout.send('agent:sessionUpdated', { archived, sessionIds }) 广播
//   - M1：getSessionMessages limit 上限 50；M4：getHistory/deleteSession 抛错路径回 { success:false, error }
// ws 用 { send: jest.fn() } 替身。

const mockExecutor = { isSessionRunning: jest.fn() }
let mockExecutorResult = mockExecutor

jest.mock('../../db/database', () => ({
  ChatSession: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn()
  },
  ChatHistory: {
    findAll: jest.fn(),
    destroy: jest.fn()
  }
}))

jest.mock('../../db/services/SessionService', () => ({
  ensureSession: jest.fn()
}))

// getSessionMessages / deleteSession 复用的服务单例（评审 I1/I3）
jest.mock('../../services/AgentMemoryService', () => ({
  getHistory: jest.fn(),
  deleteSession: jest.fn()
}))

// getExecutor 返回共享 executor（供 archiveSession 的 isSessionRunning）；缺省可整体替换
jest.mock('../../ipcHandlers/agentHandler', () => ({ getExecutor: () => mockExecutorResult }))

// ToolResultStore.clear 会 rmSync 用户主目录缓存，测试中替身化
jest.mock('../../agent/ToolResultStore', () => {
  return class {
    clear() { /* noop */ }
  }
})

const { ChatSession, ChatHistory } = require('../../db/database')
const SessionService = require('../../db/services/SessionService')
const AgentMemoryService = require('../../services/AgentMemoryService')
const RemoteSessionApi = require('../RemoteSessionApi')

function createWs() {
  return { send: jest.fn() }
}
function createFanout() {
  return { send: jest.fn() }
}

describe('RemoteSessionApi', () => {
  let api
  let ws
  let fanout

  beforeEach(() => {
    ChatSession.findAll.mockReset()
    ChatSession.findOne.mockReset()
    ChatSession.update.mockReset()
    ChatSession.destroy.mockReset()
    ChatHistory.findAll.mockReset()
    ChatHistory.destroy.mockReset()
    SessionService.ensureSession.mockReset()
    AgentMemoryService.getHistory.mockReset()
    AgentMemoryService.deleteSession.mockReset()
    mockExecutor.isSessionRunning.mockReset()

    mockExecutorResult = mockExecutor
    api = new RemoteSessionApi()
    ws = createWs()
    fanout = createFanout()
  })

  describe('agent:listSessions', () => {
    test('返回最近会话列表（ChatHistory 聚合 lastActivity + ChatSession 补名）', async () => {
      ChatHistory.findAll.mockResolvedValue([
        { sessionId: 's1', lastActivity: '2026-01-01T00:00:00.000Z' },
        { sessionId: 's2', lastActivity: '2026-01-02T00:00:00.000Z' }
      ])
      ChatSession.findAll.mockResolvedValue([
        { sessionId: 's1', sessionName: '会话A' },
        { sessionId: 's2', sessionName: null }
      ])

      await api.handleMessage(ws, { type: 'agent:listSessions', requestId: 'req-l' })

      expect(ChatHistory.findAll).toHaveBeenCalledWith(expect.objectContaining({
        attributes: expect.any(Array),
        group: ['sessionId'],
        order: expect.any(Array),
        limit: 50
      }))
      expect(ws.send).toHaveBeenCalledWith('agent:listSessions', {
        requestId: 'req-l',
        success: true,
        sessions: [
          { sessionId: 's1', lastActivity: '2026-01-01T00:00:00.000Z', sessionName: '会话A' },
          { sessionId: 's2', lastActivity: '2026-01-02T00:00:00.000Z', sessionName: null }
        ]
      })
    })

    test('requestId 缺省时自动生成（req_<ts>_<rand> 格式）', async () => {
      ChatHistory.findAll.mockResolvedValue([])
      ChatSession.findAll.mockResolvedValue([])

      await api.handleMessage(ws, { type: 'agent:listSessions' })

      const sent = ws.send.mock.calls.find(c => c[0] === 'agent:listSessions')[1]
      expect(sent.requestId).toMatch(/^req_\d+_[a-z0-9]+$/)
    })

    test('归档会话不在列表返回（ChatSession 批量查询带 archived:false 过滤）', async () => {
      ChatHistory.findAll.mockResolvedValue([
        { sessionId: 's1', lastActivity: '2026-01-01T00:00:00.000Z' },
        { sessionId: 's2', lastActivity: '2026-01-02T00:00:00.000Z' }
      ])
      // s2 已归档 → ChatSession.findAll（archived:false）只返回 s1
      ChatSession.findAll.mockResolvedValue([
        { sessionId: 's1', sessionName: '会话A' }
      ])

      await api.handleMessage(ws, { type: 'agent:listSessions', requestId: 'req-ar' })

      expect(ChatSession.findAll).toHaveBeenCalledWith({
        where: { sessionId: ['s1', 's2'], archived: false },
        raw: true
      })
      expect(ws.send).toHaveBeenCalledWith('agent:listSessions', {
        requestId: 'req-ar',
        success: true,
        sessions: [
          { sessionId: 's1', lastActivity: '2026-01-01T00:00:00.000Z', sessionName: '会话A' }
        ]
      })
    })
  })

  describe('agent:getSessionMessages', () => {
    test('缺 sessionId → 回 { success:false } 且不调 AgentMemoryService', async () => {
      await api.handleMessage(ws, { type: 'agent:getSessionMessages', requestId: 'req-m' })

      expect(AgentMemoryService.getHistory).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:getSessionMessages', expect.objectContaining({
        requestId: 'req-m',
        success: false
      }))
    })

    test('复用 AgentMemoryService.getHistory 并剥离 metadata.timeline', async () => {
      const msgNew = {
        id: 2, role: 'assistant', content: '回答', toolCallId: null, toolCalls: null,
        metadata: { timeline: { steps: [] }, tags: ['x'] },
        createdAt: '2026-01-02T00:00:00.000Z'
      }
      const msgOld = {
        id: 1, role: 'user', content: '你好', toolCallId: null, toolCalls: null,
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
      // getHistory 内部已反转正序（DESC 取最新后 reverse），mock 直接给时间正序结果
      AgentMemoryService.getHistory.mockResolvedValue([msgOld, msgNew])

      await api.handleMessage(ws, { type: 'agent:getSessionMessages', requestId: 'req-m', sessionId: 's1' })

      expect(AgentMemoryService.getHistory).toHaveBeenCalledWith('s1', { limit: 20, before: undefined })
      const sent = ws.send.mock.calls.find(c => c[0] === 'agent:getSessionMessages')[1]
      expect(sent.success).toBe(true)
      expect(sent.messages).toEqual([
        { id: 1, role: 'user', content: '你好', toolCallId: null, toolCalls: null, metadata: null, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 2, role: 'assistant', content: '回答', toolCallId: null, toolCalls: null, metadata: { tags: ['x'] }, createdAt: '2026-01-02T00:00:00.000Z' }
      ])
    })

    test('before 参数透传给 AgentMemoryService.getHistory', async () => {
      AgentMemoryService.getHistory.mockResolvedValue([])

      await api.handleMessage(ws, {
        type: 'agent:getSessionMessages',
        requestId: 'req-b',
        sessionId: 's1',
        before: '2026-01-02T00:00:00.000Z'
      })

      expect(AgentMemoryService.getHistory).toHaveBeenCalledWith(
        's1',
        { limit: 20, before: '2026-01-02T00:00:00.000Z' }
      )
    })

    test('M1: limit 超过 50 时截断为 50', async () => {
      AgentMemoryService.getHistory.mockResolvedValue([])

      await api.handleMessage(ws, {
        type: 'agent:getSessionMessages',
        requestId: 'req-l50',
        sessionId: 's1',
        limit: 100
      })

      expect(AgentMemoryService.getHistory).toHaveBeenCalledWith('s1', { limit: 50, before: undefined })
    })

    test('M4: AgentMemoryService.getHistory 抛错 → 回 { success:false, error }', async () => {
      AgentMemoryService.getHistory.mockRejectedValue(new Error('DB_FAIL'))

      await api.handleMessage(ws, { type: 'agent:getSessionMessages', requestId: 'req-me', sessionId: 's1' })

      expect(ws.send).toHaveBeenCalledWith('agent:getSessionMessages', expect.objectContaining({
        requestId: 'req-me',
        success: false,
        error: 'DB_FAIL'
      }))
    })
  })

  describe('agent:createSession', () => {
    test('调用 SessionService.ensureSession（sessionName 显式传）', async () => {
      SessionService.ensureSession.mockResolvedValue({ created: true, session: {} })

      await api.handleMessage(ws, {
        type: 'agent:createSession', requestId: 'req-c', sessionId: 's1', sessionName: '我的会话'
      })

      expect(SessionService.ensureSession).toHaveBeenCalledWith({
        sessionId: 's1', sessionName: '我的会话', workspacePath: null
      })
      expect(ws.send).toHaveBeenCalledWith('agent:createSession', { requestId: 'req-c', success: true })
    })

    test('sessionName 缺省 → 兜底「新对话」标题', async () => {
      SessionService.ensureSession.mockResolvedValue({ created: true, session: {} })

      await api.handleMessage(ws, { type: 'agent:createSession', requestId: 'req-c2', sessionId: 's1' })

      expect(SessionService.ensureSession).toHaveBeenCalledWith(expect.objectContaining({
        sessionName: expect.stringContaining('新对话')
      }))
    })

    test('缺 sessionId → 不调 ensureSession，回 { success:false }', async () => {
      await api.handleMessage(ws, { type: 'agent:createSession', requestId: 'req-c3' })

      expect(SessionService.ensureSession).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:createSession', expect.objectContaining({ success: false }))
    })
  })

  describe('agent:deleteSession', () => {
    test('复用 AgentMemoryService.deleteSession 清理并回 { success:true }', async () => {
      AgentMemoryService.deleteSession.mockResolvedValue()

      await api.handleMessage(ws, { type: 'agent:deleteSession', requestId: 'req-d', sessionId: 's1' })

      expect(AgentMemoryService.deleteSession).toHaveBeenCalledWith('s1')
      expect(ws.send).toHaveBeenCalledWith('agent:deleteSession', { requestId: 'req-d', success: true })
    })

    test('缺 sessionId → 回 { success:false }，不清理', async () => {
      await api.handleMessage(ws, { type: 'agent:deleteSession', requestId: 'req-d2' })

      expect(AgentMemoryService.deleteSession).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:deleteSession', expect.objectContaining({ success: false }))
    })

    test('M4: AgentMemoryService.deleteSession 抛错 → 回 { success:false, error }', async () => {
      AgentMemoryService.deleteSession.mockRejectedValue(new Error('DB_FAIL'))

      await api.handleMessage(ws, { type: 'agent:deleteSession', requestId: 'req-d3', sessionId: 's1' })

      expect(ws.send).toHaveBeenCalledWith('agent:deleteSession', expect.objectContaining({
        requestId: 'req-d3',
        success: false,
        error: 'DB_FAIL'
      }))
    })
  })

  describe('agent:archiveSession', () => {
    test('批量归档：跳过运行中的会话，回 { success:true, updated, skipped }', async () => {
      mockExecutor.isSessionRunning.mockImplementation((sid) => sid === 's1')
      ChatSession.update.mockResolvedValue([2])

      await api.handleMessage(ws, {
        type: 'agent:archiveSession', requestId: 'req-a',
        sessionIds: ['s1', 's2', 's3'], archived: true
      }, fanout)

      expect(mockExecutor.isSessionRunning).toHaveBeenCalledWith('s1')
      expect(ChatSession.update).toHaveBeenCalledWith(
        { archived: true },
        { where: { sessionId: ['s2', 's3'] } }
      )
      expect(ws.send).toHaveBeenCalledWith('agent:archiveSession', {
        requestId: 'req-a', success: true, updated: 2, skipped: ['s1']
      })
    })

    test('恢复（archived:false）不受 isRunning 限制', async () => {
      mockExecutor.isSessionRunning.mockReturnValue(true)
      ChatSession.update.mockResolvedValue([3])

      await api.handleMessage(ws, {
        type: 'agent:archiveSession', requestId: 'req-a2',
        sessionIds: ['s1', 's2', 's3'], archived: false
      }, fanout)

      expect(ChatSession.update).toHaveBeenCalledWith(
        { archived: false },
        { where: { sessionId: ['s1', 's2', 's3'] } }
      )
      expect(ws.send).toHaveBeenCalledWith('agent:archiveSession', {
        requestId: 'req-a2', success: true, updated: 3, skipped: []
      })
    })

    test('I2: 归档后 fanout.send(agent:sessionUpdated, { archived, sessionIds }) 广播', async () => {
      ChatSession.update.mockResolvedValue([2])

      await api.handleMessage(ws, {
        type: 'agent:archiveSession', requestId: 'req-a4',
        sessionIds: ['s1', 's2'], archived: true
      }, fanout)

      expect(fanout.send).toHaveBeenCalledWith('agent:sessionUpdated', { archived: true, sessionIds: ['s1', 's2'] })
    })

    test('缺 sessionIds → 回 { success:false }', async () => {
      await api.handleMessage(ws, { type: 'agent:archiveSession', requestId: 'req-a3' })

      expect(ChatSession.update).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:archiveSession', expect.objectContaining({ success: false }))
    })
  })

  describe('agent:renameSession', () => {
    test('ChatSession.update 改名', async () => {
      ChatSession.update.mockResolvedValue([1])

      await api.handleMessage(ws, {
        type: 'agent:renameSession', requestId: 'req-r', sessionId: 's1', sessionName: '新名字'
      })

      expect(ChatSession.update).toHaveBeenCalledWith(
        { sessionName: '新名字' },
        { where: { sessionId: 's1' } }
      )
      expect(ws.send).toHaveBeenCalledWith('agent:renameSession', { requestId: 'req-r', success: true })
    })

    test('缺 sessionId → 回 { success:false }', async () => {
      await api.handleMessage(ws, { type: 'agent:renameSession', requestId: 'req-r2', sessionName: 'x' })

      expect(ChatSession.update).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:renameSession', expect.objectContaining({ success: false }))
    })
  })

  test('未知通道 → 回 CHANNEL_NOT_ALLOWED', async () => {
    await api.handleMessage(ws, { type: 'agent:foo', requestId: 'req-x' })

    expect(ws.send).toHaveBeenCalledWith('error', { error: 'CHANNEL_NOT_ALLOWED' })
  })
})

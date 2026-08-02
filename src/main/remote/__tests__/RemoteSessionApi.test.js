'use strict'

// RemoteSessionApi 测试（R7）：
//   - 6 个会话通道：agent:listSessions / getSessionMessages / createSession / deleteSession / archiveSession / renameSession
//   - 复用现有逻辑：mock db/database（ChatSession/ChatHistory/SessionSummary）+ SessionService；
//     archiveSessionCore 用真实实现验证批量语义（跳过运行中）；ToolResultStore mock 掉避免碰用户主目录
//   - 响应约定与 R6 一致：同通道回 { requestId, success, ... }；requestId 缺省时自动生成
// ws 用 { send: jest.fn() } 替身。

const { Op } = require('sequelize')

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
  },
  SessionSummary: {
    destroy: jest.fn()
  }
}))

jest.mock('../../db/services/SessionService', () => ({
  ensureSession: jest.fn()
}))

// getExecutor 返回共享 executor（供 archiveSession 的 isSessionRunning）；缺省可整体替换
jest.mock('../../ipcHandlers/agentHandler', () => ({ getExecutor: () => mockExecutorResult }))

// ToolResultStore.clear 会 rmSync 用户主目录缓存，测试中替身化
jest.mock('../../agent/ToolResultStore', () => {
  return class {
    clear() { /* noop */ }
  }
})

const { ChatSession, ChatHistory, SessionSummary } = require('../../db/database')
const SessionService = require('../../db/services/SessionService')
const RemoteSessionApi = require('../RemoteSessionApi')

function createWs() {
  return { send: jest.fn() }
}

describe('RemoteSessionApi', () => {
  let api
  let ws

  beforeEach(() => {
    ChatSession.findAll.mockReset()
    ChatSession.findOne.mockReset()
    ChatSession.update.mockReset()
    ChatSession.destroy.mockReset()
    ChatHistory.findAll.mockReset()
    ChatHistory.destroy.mockReset()
    SessionSummary.destroy.mockReset()
    SessionService.ensureSession.mockReset()
    mockExecutor.isSessionRunning.mockReset()

    mockExecutorResult = mockExecutor
    api = new RemoteSessionApi()
    ws = createWs()
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
  })

  describe('agent:getSessionMessages', () => {
    test('缺 sessionId → 回 { success:false } 且不查 ChatHistory', async () => {
      await api.handleMessage(ws, { type: 'agent:getSessionMessages', requestId: 'req-m' })

      expect(ChatHistory.findAll).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:getSessionMessages', expect.objectContaining({
        requestId: 'req-m',
        success: false
      }))
    })

    test('返回消息（倒序取最新、反转正序、剥离 metadata.timeline）', async () => {
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
      ChatHistory.findAll.mockResolvedValue([msgNew, msgOld])

      await api.handleMessage(ws, { type: 'agent:getSessionMessages', requestId: 'req-m', sessionId: 's1' })

      expect(ChatHistory.findAll).toHaveBeenCalledWith({
        where: { sessionId: 's1' },
        order: [['createdAt', 'DESC']],
        limit: 20
      })
      const sent = ws.send.mock.calls.find(c => c[0] === 'agent:getSessionMessages')[1]
      expect(sent.success).toBe(true)
      expect(sent.messages).toEqual([
        { id: 1, role: 'user', content: '你好', toolCallId: null, toolCalls: null, metadata: null, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 2, role: 'assistant', content: '回答', toolCallId: null, toolCalls: null, metadata: { tags: ['x'] }, createdAt: '2026-01-02T00:00:00.000Z' }
      ])
    })

    test('before 参数 → where.createdAt = Op.lt 过滤', async () => {
      ChatHistory.findAll.mockResolvedValue([])

      await api.handleMessage(ws, {
        type: 'agent:getSessionMessages',
        requestId: 'req-b',
        sessionId: 's1',
        before: '2026-01-02T00:00:00.000Z'
      })

      const call = ChatHistory.findAll.mock.calls[0][0]
      expect(call.where.sessionId).toBe('s1')
      expect(call.where.createdAt[Op.lt]).toEqual(new Date('2026-01-02T00:00:00.000Z'))
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
    test('清理 ChatSession + ChatHistory + SessionSummary', async () => {
      await api.handleMessage(ws, { type: 'agent:deleteSession', requestId: 'req-d', sessionId: 's1' })

      expect(ChatSession.destroy).toHaveBeenCalledWith({ where: { sessionId: 's1' } })
      expect(ChatHistory.destroy).toHaveBeenCalledWith({ where: { sessionId: 's1' } })
      expect(SessionSummary.destroy).toHaveBeenCalledWith({ where: { sessionId: 's1' } })
      expect(ws.send).toHaveBeenCalledWith('agent:deleteSession', { requestId: 'req-d', success: true })
    })

    test('缺 sessionId → 回 { success:false }，不清理', async () => {
      await api.handleMessage(ws, { type: 'agent:deleteSession', requestId: 'req-d2' })

      expect(ChatSession.destroy).not.toHaveBeenCalled()
      expect(ws.send).toHaveBeenCalledWith('agent:deleteSession', expect.objectContaining({ success: false }))
    })

    test('模型抛错 → 回 { success:false, error }', async () => {
      ChatSession.destroy.mockRejectedValue(new Error('DB_FAIL'))

      await api.handleMessage(ws, { type: 'agent:deleteSession', requestId: 'req-d3', sessionId: 's1' })

      expect(ws.send).toHaveBeenCalledWith('agent:deleteSession', expect.objectContaining({ success: false, error: 'DB_FAIL' }))
    })
  })

  describe('agent:archiveSession', () => {
    test('批量归档：跳过运行中的会话，回 { success:true, updated, skipped }', async () => {
      mockExecutor.isSessionRunning.mockImplementation((sid) => sid === 's1')
      ChatSession.update.mockResolvedValue([2])

      await api.handleMessage(ws, {
        type: 'agent:archiveSession', requestId: 'req-a',
        sessionIds: ['s1', 's2', 's3'], archived: true
      })

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
      })

      expect(ChatSession.update).toHaveBeenCalledWith(
        { archived: false },
        { where: { sessionId: ['s1', 's2', 's3'] } }
      )
      expect(ws.send).toHaveBeenCalledWith('agent:archiveSession', {
        requestId: 'req-a2', success: true, updated: 3, skipped: []
      })
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

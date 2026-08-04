/**
 * v0.6.0 Task 1.12 幂等保存测试
 *
 * 覆盖：
 * - AuditLogService.write：传 requestId 时查重命中返回旧记录，不重复 create
 * - SalesQuoteHistoryService.saveQuote：传 requestId 时查重命中返回旧记录，不重复 create
 * - save_mix_design：context.toolCallId → auditLogService.write 的 requestId
 * - save_sales_quote：context.toolCallId → salesQuoteHistory.saveQuote 的 payload.requestId
 * - SkillExecutor：runtimeCtx.toolCallId → context.toolCallId 注入
 *
 * 全程 mock，不连真实数据库（避免 better-sqlite3 native module 在 jest 崩溃）。
 */

// ============================================================
// 模块级 mock 对象（用 mock 前缀，jest.mock 工厂允许引用）
// ============================================================
const mockAuditLog = { findOne: jest.fn(), create: jest.fn() }
const mockSalesQuoteHistory = { findOne: jest.fn(), create: jest.fn() }
const mockAskUser = jest.fn()

jest.mock('../../db/database', () => ({
  AuditLog: mockAuditLog,
  SalesQuoteHistory: mockSalesQuoteHistory
}))
jest.mock('../../skills/ask-user', () => ({ execute: mockAskUser }))

// ============================================================
// 1. AuditLogService.write 幂等
// ============================================================
describe('AuditLogService.write 幂等（Task 1.12）', () => {
  let write
  beforeEach(() => {
    jest.resetModules()
    mockAuditLog.findOne.mockReset()
    mockAuditLog.create.mockReset()
    write = require('../../services/AuditLogService').write
  })

  test('传 requestId 且查重命中 → 返回旧记录，不调 create', async () => {
    const old = { id: 99, action: 'CONFIRM', requestId: 'tc_001' }
    mockAuditLog.findOne.mockResolvedValue(old)
    const r = await write({
      action: 'CONFIRM', targetType: 'mix_design', targetId: 42, requestId: 'tc_001'
    })
    expect(mockAuditLog.findOne).toHaveBeenCalledWith({ where: { requestId: 'tc_001' } })
    expect(mockAuditLog.create).not.toHaveBeenCalled()
    expect(r).toBe(old)
  })

  test('传 requestId 但查重未命中 → 调 create 且写入 requestId', async () => {
    mockAuditLog.findOne.mockResolvedValue(null)
    mockAuditLog.create.mockResolvedValue({ id: 100 })
    const r = await write({
      action: 'UPDATE', targetType: 'mix_design', targetId: 42, requestId: 'tc_002'
    })
    expect(mockAuditLog.findOne).toHaveBeenCalledWith({ where: { requestId: 'tc_002' } })
    expect(mockAuditLog.create).toHaveBeenCalledTimes(1)
    const createArg = mockAuditLog.create.mock.calls[0][0]
    expect(createArg.requestId).toBe('tc_002')
    expect(r.id).toBe(100)
  })

  test('不传 requestId → 不查重，直接 create（兼容旧调用方）', async () => {
    mockAuditLog.create.mockResolvedValue({ id: 101 })
    await write({ action: 'CONFIRM', targetType: 'mix_design', targetId: 42 })
    expect(mockAuditLog.findOne).not.toHaveBeenCalled()
    expect(mockAuditLog.create).toHaveBeenCalledTimes(1)
    expect(mockAuditLog.create.mock.calls[0][0].requestId).toBeNull()
  })
})

// ============================================================
// 2. SalesQuoteHistoryService.saveQuote 幂等
// ============================================================
describe('SalesQuoteHistoryService.saveQuote 幂等（Task 1.12）', () => {
  let saveQuote
  beforeEach(() => {
    jest.resetModules()
    mockSalesQuoteHistory.findOne.mockReset()
    mockSalesQuoteHistory.create.mockReset()
    saveQuote = require('../../services/SalesQuoteHistoryService').saveQuote
  })

  test('传 requestId 且查重命中 → 返回旧记录，不调 create', async () => {
    const old = { id: 88, strengthGrade: 'C30', requestId: 'tc_q1' }
    old.toJSON = () => old
    mockSalesQuoteHistory.findOne.mockResolvedValue(old)
    const r = await saveQuote({ strengthGrade: 'C30', concreteType: '普通', requestId: 'tc_q1' })
    expect(mockSalesQuoteHistory.findOne).toHaveBeenCalledWith({ where: { requestId: 'tc_q1' } })
    expect(mockSalesQuoteHistory.create).not.toHaveBeenCalled()
    expect(r.id).toBe(88)
  })

  test('传 requestId 但查重未命中 → 调 create 且写入 requestId', async () => {
    mockSalesQuoteHistory.findOne.mockResolvedValue(null)
    const created = { id: 89, strengthGrade: 'C30' }
    created.toJSON = () => created
    mockSalesQuoteHistory.create.mockResolvedValue(created)
    const r = await saveQuote({ strengthGrade: 'C30', concreteType: '普通', requestId: 'tc_q2' })
    expect(mockSalesQuoteHistory.findOne).toHaveBeenCalledWith({ where: { requestId: 'tc_q2' } })
    expect(mockSalesQuoteHistory.create).toHaveBeenCalledTimes(1)
    expect(mockSalesQuoteHistory.create.mock.calls[0][0].requestId).toBe('tc_q2')
    expect(r.id).toBe(89)
  })

  test('不传 requestId → 不查重，直接 create（兼容旧调用方）', async () => {
    const created = { id: 90 }
    created.toJSON = () => created
    mockSalesQuoteHistory.create.mockResolvedValue(created)
    await saveQuote({ strengthGrade: 'C30', concreteType: '普通' })
    expect(mockSalesQuoteHistory.findOne).not.toHaveBeenCalled()
    expect(mockSalesQuoteHistory.create).toHaveBeenCalledTimes(1)
    expect(mockSalesQuoteHistory.create.mock.calls[0][0].requestId).toBeNull()
  })
})

// ============================================================
// 3. save_mix_design 传 requestId
// ============================================================
describe('save_mix_design 传 requestId（Task 1.12）', () => {
  let saveMixDesign
  beforeEach(() => {
    jest.resetModules()
    mockAskUser.mockReset()
    mockAskUser.mockResolvedValue({ success: true, values: { name: 'C30-正式' } })
    saveMixDesign = require('../../skills/save-mix-design')
  })

  test('context.toolCallId 存在 → auditLogService.write 收到 requestId', async () => {
    const auditWrite = jest.fn().mockResolvedValue({ id: 1 })
    const ctx = {
      mixDesignService: {
        getMixDesignById: jest.fn().mockResolvedValue({
          id: 42, name: 'C30-草稿', status: '草稿', toJSON() { return this }
        }),
        updateMixDesign: jest.fn().mockResolvedValue({})
      },
      auditLogService: { write: auditWrite },
      logger: { info: jest.fn(), error: jest.fn() },
      toolCallId: 'tc_save_001'
    }
    const r = await saveMixDesign.execute({ schemeId: 42 }, ctx)
    expect(r.success).toBe(true)
    expect(auditWrite).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'tc_save_001' }))
  })

  test('context.toolCallId 缺失 → auditLogService.write 收到 requestId=null（兼容）', async () => {
    const auditWrite = jest.fn().mockResolvedValue({ id: 1 })
    const ctx = {
      mixDesignService: {
        getMixDesignById: jest.fn().mockResolvedValue({
          id: 42, name: 'C30-草稿', status: '草稿', toJSON() { return this }
        }),
        updateMixDesign: jest.fn().mockResolvedValue({})
      },
      auditLogService: { write: auditWrite },
      logger: { info: jest.fn(), error: jest.fn() }
    }
    await saveMixDesign.execute({ schemeId: 42 }, ctx)
    expect(auditWrite).toHaveBeenCalledWith(expect.objectContaining({ requestId: null }))
  })
})

// ============================================================
// 4. save_sales_quote 传 requestId
// ============================================================
describe('save_sales_quote 传 requestId（Task 1.12）', () => {
  let saveSalesQuote
  beforeEach(() => {
    jest.resetModules()
    mockAskUser.mockReset()
    mockAskUser.mockResolvedValue({
      success: true,
      values: { strengthGrade: 'C30', concreteType: '普通', slump: 180, remarks: '' }
    })
    saveSalesQuote = require('../../skills/save-sales-quote')
  })

  test('context.toolCallId 存在 → saveQuote payload 收到 requestId', async () => {
    const saveQuoteFn = jest.fn().mockResolvedValue({ id: 77 })
    const ctx = {
      salesQuoteHistory: { saveQuote: saveQuoteFn },
      logger: { info: jest.fn(), error: jest.fn() },
      toolCallId: 'tc_quote_001'
    }
    const r = await saveSalesQuote.execute({ strengthGrade: 'C30', concreteType: '普通' }, ctx)
    expect(r.success).toBe(true)
    expect(saveQuoteFn).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'tc_quote_001' }))
  })

  test('context.toolCallId 缺失 → saveQuote payload requestId=null（兼容）', async () => {
    const saveQuoteFn = jest.fn().mockResolvedValue({ id: 78 })
    const ctx = {
      salesQuoteHistory: { saveQuote: saveQuoteFn },
      logger: { info: jest.fn(), error: jest.fn() }
    }
    await saveSalesQuote.execute({ strengthGrade: 'C30', concreteType: '普通' }, ctx)
    expect(saveQuoteFn).toHaveBeenCalledWith(expect.objectContaining({ requestId: null }))
  })
})

// ============================================================
// 5. SkillExecutor 注入 toolCallId 到 context
// ============================================================
describe('SkillExecutor 注入 toolCallId（Task 1.12）', () => {
  test('runtimeCtx.toolCallId → context.toolCallId', async () => {
    jest.resetModules()
    const fakeSkill = {
      name: 'fake_save',
      parameters: {},
      execute: jest.fn().mockResolvedValue({ success: true })
    }
    const fakeRegistry = {
      getSkill: jest.fn().mockReturnValue(fakeSkill),
      skillNames: ['fake_save']
    }
    const fakeValidator = { validate: jest.fn().mockReturnValue({ valid: true }) }
    const fakeContextProvider = {
      getForSkill: jest.fn().mockReturnValue({ logger: { info: jest.fn() } })
    }
    const SkillExecutor = require('../../agent/SkillExecutor')
    const executor = new SkillExecutor({ skillRegistry: fakeRegistry, contextProvider: fakeContextProvider })
    executor.validator = fakeValidator

    await executor.execute('fake_save', {}, { sessionId: 's1', toolCallId: 'tc_exec_001' })

    const ctxArg = fakeSkill.execute.mock.calls[0][1]
    expect(ctxArg.toolCallId).toBe('tc_exec_001')
  })

  test('无 toolCallId → context 不含 toolCallId（兼容）', async () => {
    jest.resetModules()
    const fakeSkill = {
      name: 'fake_save',
      parameters: {},
      execute: jest.fn().mockResolvedValue({ success: true })
    }
    const fakeRegistry = {
      getSkill: jest.fn().mockReturnValue(fakeSkill),
      skillNames: ['fake_save']
    }
    const fakeValidator = { validate: jest.fn().mockReturnValue({ valid: true }) }
    const fakeContextProvider = {
      getForSkill: jest.fn().mockReturnValue({ logger: { info: jest.fn() } })
    }
    const SkillExecutor = require('../../agent/SkillExecutor')
    const executor = new SkillExecutor({ skillRegistry: fakeRegistry, contextProvider: fakeContextProvider })
    executor.validator = fakeValidator

    await executor.execute('fake_save', {}, { sessionId: 's1' })

    const ctxArg = fakeSkill.execute.mock.calls[0][1]
    expect(ctxArg.toolCallId).toBeUndefined()
  })
})

/**
 * 方案管理技能测试（v10.10.2 起 BasicMixDesign 库下线，仅覆盖 MixDesign 库）
 *
 * 覆盖：
 * - list_mix_designs：limit/offset/sortBy/sortOrder/keyword/status
 * - get_mix_design：not found
 * - update_mix_design：白名单 5 字段、白名单外忽略
 * - save_mix_design：状态机（草稿→CONFIRM、已确认→UPDATE、其他→INVALID_STATUS）
 * - delete_mix_design：草稿直接删、非草稿弹窗（确认/取消/其他→userIntent）
 * - 审计日志：4 个有副作用技能都写
 *
 * 删除的 list_basic_mix_designs / save_basic_mix_design / delete_basic_mix_design
 * 因 skill 文件下线，连同 describe 块一起移除。
 */

const listMixDesigns = require('../../skills/list-mix-designs')
const getMixDesign = require('../../skills/get-mix-design')
const updateMixDesign = require('../../skills/update-mix-design')
const deleteMixDesign = require('../../skills/delete-mix-design')

// mock ask_user
jest.mock('../../skills/ask-user', () => ({
  execute: jest.fn()
}))
const askUser = require('../../skills/ask-user')

// mock auditLogService
const makeAuditLog = () => ({ write: jest.fn().mockResolvedValue({ id: 1 }) })

// mock services
const makeContext = (overrides = {}) => {
  const all = {
    mixDesignService: {
      getAllMixDesigns: jest.fn().mockResolvedValue([]),
      getMixDesignById: jest.fn(),
      createMixDesign: jest.fn(),
      updateMixDesign: jest.fn().mockResolvedValue({}),
      deleteMixDesign: jest.fn().mockResolvedValue({})
    },
    auditLogService: makeAuditLog(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...overrides
  }
  return all
}

// 构造 fake MixDesign
const fakeMixDesign = (overrides = {}) => ({
  id: 1, name: 'C30-测试', strength: 'C30', status: '草稿',
  projectName: '测试项目', description: '测试描述',
  slump: 180, totalCost: 500, createdAt: new Date(),
  toJSON() { return this },
  ...overrides
})

// ============================================================
// list_mix_designs（测试 #1-#4）
// ============================================================
describe('list_mix_designs', () => {
  test('#1 limit=0 → 用默认 10', async () => {
    const ctx = makeContext({
      mixDesignService: {
        getAllMixDesigns: jest.fn().mockResolvedValue(
          Array.from({ length: 30 }, (_, i) => fakeMixDesign({ id: i + 1, name: `方案${i}` }))
        )
      }
    })
    const r = await listMixDesigns.execute({ limit: 0 }, ctx)
    expect(r.success).toBe(true)
    expect(r.data.items).toHaveLength(10)
    expect(r.data.limit).toBe(10)
    expect(r.data.total).toBe(30)
  })

  test('#2 limit=999 → 截断到 50', async () => {
    const ctx = makeContext({
      mixDesignService: {
        getAllMixDesigns: jest.fn().mockResolvedValue(
          Array.from({ length: 100 }, (_, i) => fakeMixDesign({ id: i + 1, name: `方案${i}` }))
        )
      }
    })
    const r = await listMixDesigns.execute({ limit: 999 }, ctx)
    expect(r.success).toBe(true)
    expect(r.data.items).toHaveLength(50)
  })

  test('#35 status=草稿 → 只返回草稿', async () => {
    const ctx = makeContext({
      mixDesignService: {
        getAllMixDesigns: jest.fn().mockResolvedValue([
          fakeMixDesign({ id: 1, status: '草稿' }),
          fakeMixDesign({ id: 2, status: '已确认' })
        ])
      }
    })
    const r = await listMixDesigns.execute({ status: '草稿' }, ctx)
    expect(r.data.items).toHaveLength(1)
    expect(r.data.items[0].status).toBe('草稿')
  })

  test('#36 keyword=C30 → 模糊匹配 name', async () => {
    const ctx = makeContext({
      mixDesignService: {
        getAllMixDesigns: jest.fn().mockResolvedValue([
          fakeMixDesign({ id: 1, name: 'C30-测试' }),
          fakeMixDesign({ id: 2, name: 'C40-其他' })
        ])
      }
    })
    const r = await listMixDesigns.execute({ keyword: 'c30' }, ctx)
    expect(r.data.items).toHaveLength(1)
    expect(r.data.items[0].name).toBe('C30-测试')
  })

  test('#37 sortBy=name asc → 升序', async () => {
    const ctx = makeContext({
      mixDesignService: {
        getAllMixDesigns: jest.fn().mockResolvedValue([
          fakeMixDesign({ id: 1, name: 'B' }),
          fakeMixDesign({ id: 2, name: 'A' })
        ])
      }
    })
    const r = await listMixDesigns.execute({ sortBy: 'name', sortOrder: 'asc' }, ctx)
    expect(r.data.items[0].name).toBe('A')
  })

  test('#38 offset=10 limit=5 → 第 11-15 条', async () => {
    const ctx = makeContext({
      mixDesignService: {
        getAllMixDesigns: jest.fn().mockResolvedValue(
          Array.from({ length: 20 }, (_, i) => fakeMixDesign({ id: i + 1, name: `方案${i + 1}` }))
        )
      }
    })
    const r = await listMixDesigns.execute({ offset: 10, limit: 5 }, ctx)
    expect(r.data.items).toHaveLength(5)
    expect(r.data.items[0].id).toBe(11)
    expect(r.data.items[4].id).toBe(15)
  })
})

// ============================================================
// get_mix_design（测试 #19）
// ============================================================
describe('get_mix_design', () => {
  test('#19 不存在 id → NOT_FOUND', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(null)
    const r = await getMixDesign.execute({ id: 999 }, ctx)
    expect(r.success).toBe(false)
    expect(r.error.code).toBe('NOT_FOUND')
  })
})

// ============================================================
// update_mix_design（测试 #20, #21, #22）
// ============================================================
describe('update_mix_design', () => {
  beforeEach(() => {
    askUser.execute.mockReset()
  })

  test('#20 传 status → 静默忽略', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, status: '草稿' }))
    const r = await updateMixDesign.execute({ id: 1, name: '新名', status: '已确认' }, ctx)
    expect(r.success).toBe(true)
    expect(r.updatedFields).toEqual(['name'])
    expect(ctx.mixDesignService.updateMixDesign).toHaveBeenCalledWith(1, { name: '新名' })
  })

  test('#21 传 materials → 静默忽略', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1 }))
    const r = await updateMixDesign.execute({ id: 1, name: 'X', materials: { cement: 999 } }, ctx)
    expect(r.success).toBe(true)
    expect(r.updatedFields).toEqual(['name'])
  })

  test('#22 传 name/description/projectName/customerInfo/remarks → 全更新', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, name: 'old' }))
    const r = await updateMixDesign.execute({
      id: 1, name: 'new', description: 'd', projectName: 'p',
      customerInfo: '{"contact":"张总"}', remarks: 'r'
    }, ctx)
    expect(r.success).toBe(true)
    expect(r.updatedFields.sort()).toEqual(['customerInfo', 'description', 'name', 'projectName', 'remarks'])
  })

  test('#42 update 成功 → 写 audit_logs(UPDATE, before+after)', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, name: 'old' }))
    await updateMixDesign.execute({ id: 1, name: 'new' }, ctx)
    expect(ctx.auditLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', targetType: 'mix_design', targetId: 1
    }))
  })
})

// ============================================================
// delete_mix_design（测试 #23, #24, #25, #26, #43）
// ============================================================
describe('delete_mix_design', () => {
  beforeEach(() => {
    askUser.execute.mockReset()
  })

  test('#23 草稿 → 直接删，不弹窗', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, status: '草稿' }))
    const r = await deleteMixDesign.execute({ id: 1 }, ctx)
    expect(r.success).toBe(true)
    expect(r.wasDraft).toBe(true)
    expect(askUser.execute).not.toHaveBeenCalled()
  })

  test('#24 非草稿用户选"确认删除" → 弹窗后删除', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, status: '已确认' }))
    askUser.execute.mockResolvedValue({ success: true, answer: '确认删除' })
    const r = await deleteMixDesign.execute({ id: 1 }, ctx)
    expect(r.success).toBe(true)
    expect(askUser.execute).toHaveBeenCalled()
    expect(ctx.mixDesignService.deleteMixDesign).toHaveBeenCalledWith(1)
  })

  test('#25 非草稿用户选"取消" → 不删', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, status: '已确认' }))
    askUser.execute.mockResolvedValue({ success: true, answer: '取消' })
    const r = await deleteMixDesign.execute({ id: 1 }, ctx)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/取消/)
    expect(ctx.mixDesignService.deleteMixDesign).not.toHaveBeenCalled()
  })

  test('#26 非草稿用户填"先导出再删" → 返回 userIntent', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, status: '已确认' }))
    askUser.execute.mockResolvedValue({ success: true, answer: '先导出再删' })
    const r = await deleteMixDesign.execute({ id: 1 }, ctx)
    expect(r.success).toBe(false)
    expect(r.userIntent).toBe('先导出再删')
    expect(ctx.mixDesignService.deleteMixDesign).not.toHaveBeenCalled()
  })

  test('#43 delete 成功 → 写 audit_logs(DELETE, after=null)', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 1, status: '草稿' }))
    await deleteMixDesign.execute({ id: 1 }, ctx)
    expect(ctx.auditLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', targetType: 'mix_design', targetId: 1, after: null
    }))
  })
})

// ============================================================
// v10.10.2：list_basic_mix_designs / save_basic_mix_design / delete_basic_mix_design
// 因 skill 文件下线，3 个 describe 块已移除
// ============================================================

// ============================================================
// save_mix_design 状态机（测试 #39, #40, #41）
// ============================================================
describe('save_mix_design 状态机（覆盖 #39-#41）', () => {
  const saveMixDesign = require('../../skills/save-mix-design')
  beforeEach(() => {
    askUser.execute.mockReset()
  })

  test('#39 草稿状态 → 弹窗确认后 status→已确认 + 写 audit_logs(CONFIRM)', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 42, status: '草稿', name: 'C30-草稿' }))
    askUser.execute.mockResolvedValue({ success: true, values: { name: 'C30-正式' } })
    const r = await saveMixDesign.execute({ schemeId: 42 }, ctx)
    expect(r.success).toBe(true)
    expect(r.action).toBe('CONFIRM')
    expect(ctx.mixDesignService.updateMixDesign).toHaveBeenCalledWith(42, { status: '已确认', name: 'C30-正式' })
    expect(ctx.auditLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CONFIRM', targetType: 'mix_design', targetId: 42
    }))
  })

  test('#40 已确认状态 → 弹窗改名后只更新 name/updatedAt，不重置 status + 写 audit_logs(UPDATE)', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 42, status: '已确认', name: 'C30-旧名' }))
    askUser.execute.mockResolvedValue({ success: true, values: { name: 'C30-新名' } })
    const r = await saveMixDesign.execute({ schemeId: 42 }, ctx)
    expect(r.success).toBe(true)
    expect(r.action).toBe('UPDATE')
    // patch 不含 status
    const patchArg = ctx.mixDesignService.updateMixDesign.mock.calls[0][1]
    expect(patchArg).not.toHaveProperty('status')
    expect(patchArg).toEqual({ name: 'C30-新名' })
    expect(ctx.auditLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', targetType: 'mix_design', targetId: 42
    }))
  })

  test('#41 其他状态 → INVALID_STATUS', async () => {
    const ctx = makeContext()
    ctx.mixDesignService.getMixDesignById.mockResolvedValue(fakeMixDesign({ id: 42, status: '未知状态' }))
    const r = await saveMixDesign.execute({ schemeId: 42 }, ctx)
    expect(r.success).toBe(false)
    expect(r.error.code).toBe('INVALID_STATUS')
    expect(askUser.execute).not.toHaveBeenCalled()
    expect(ctx.mixDesignService.updateMixDesign).not.toHaveBeenCalled()
  })
})

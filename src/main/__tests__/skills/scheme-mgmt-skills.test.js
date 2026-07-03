/**
 * 方案管理技能测试（SPEC 7.3：46 个边缘情况）
 *
 * 覆盖：
 * - list_mix_designs / list_basic_mix_designs：limit/offset/sortBy/sortOrder/keyword/status
 * - get_mix_design：not found
 * - update_mix_design：白名单 5 字段、白名单外忽略
 * - save_mix_design：状态机（草稿→CONFIRM、已确认→UPDATE、其他→INVALID_STATUS）
 * - delete_mix_design：草稿直接删、非草稿弹窗（确认/取消/其他→userIntent）
 * - save_basic_mix_design：传 id=更新、不传=新增、materials 空报错、isDefault=true
 * - delete_basic_mix_design：被引用→IN_USE、userIntent 协议
 * - 审计日志：5 个有副作用技能都写
 */

const listMixDesigns = require('../../skills/list-mix-designs')
const getMixDesign = require('../../skills/get-mix-design')
const updateMixDesign = require('../../skills/update-mix-design')
const deleteMixDesign = require('../../skills/delete-mix-design')
const listBasicMixDesigns = require('../../skills/list-basic-mix-designs')
const saveBasicMixDesign = require('../../skills/save-basic-mix-design')
const deleteBasicMixDesign = require('../../skills/delete-basic-mix-design')

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
      deleteMixDesign: jest.fn().mockResolvedValue({}),
      findByBasicMixId: jest.fn().mockResolvedValue([])
    },
    basicMixDesignService: {
      listBasicMixDesigns: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      createBasicMixDesign: jest.fn(),
      updateBasicMixDesign: jest.fn().mockResolvedValue({}),
      deleteBasicMixDesign: jest.fn().mockResolvedValue({})
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

const fakeBasicMix = (overrides = {}) => ({
  id: 1, name: 'C30-基准', strengthGrade: 'C30', concreteType: '普通',
  slump: 180, isDefault: false, source: '智能设计',
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
// list_basic_mix_designs（测试 #18 同 list 通用规则，#1-#4 已覆盖）
// ============================================================
describe('list_basic_mix_designs', () => {
  test('#18 limit=999 → 截断到 50', async () => {
    const ctx = makeContext({
      basicMixDesignService: {
        listBasicMixDesigns: jest.fn().mockResolvedValue(
          Array.from({ length: 100 }, (_, i) => fakeBasicMix({ id: i + 1, name: `b${i}` }))
        )
      }
    })
    const r = await listBasicMixDesigns.execute({ limit: 999 }, ctx)
    expect(r.data.items).toHaveLength(50)
  })
})

// ============================================================
// save_basic_mix_design（测试 #27, #28, #29, #30, #31, #44, #45）
// ============================================================
describe('save_basic_mix_design', () => {
  beforeEach(() => {
    askUser.execute.mockReset()
  })

  test('#27 materials 空 → INVALID_MATERIALS', async () => {
    const ctx = makeContext()
    const r = await saveBasicMixDesign.execute({
      name: 'X', strengthGrade: 'C30', concreteType: '普通', materials: []
    }, ctx)
    expect(r.success).toBe(false)
    expect(r.error.code).toBe('INVALID_MATERIALS')
  })

  test('#28 isDefault=true → 通过 form 模式让用户确认', async () => {
    const ctx = makeContext()
    askUser.execute.mockResolvedValue({ success: true, values: { name: 'X', strengthGrade: 'C30', concreteType: '普通', slump: 180, isDefault: true } })
    ctx.basicMixDesignService.createBasicMixDesign.mockResolvedValue({ id: 100, toJSON: () => ({ id: 100 }) })
    const r = await saveBasicMixDesign.execute({
      name: 'X', strengthGrade: 'C30', concreteType: '普通', materials: [{ materialType: '水泥' }], isDefault: true
    }, ctx)
    expect(r.success).toBe(true)
    expect(r.id).toBe(100)
  })

  test('#29 不传 id → 新增', async () => {
    const ctx = makeContext()
    askUser.execute.mockResolvedValue({ success: true, values: { name: 'X', strengthGrade: 'C30', concreteType: '普通', slump: 180, isDefault: false } })
    ctx.basicMixDesignService.createBasicMixDesign.mockResolvedValue({ id: 101, toJSON: () => ({ id: 101 }) })
    const r = await saveBasicMixDesign.execute({
      name: 'X', strengthGrade: 'C30', concreteType: '普通', materials: [{ materialType: '水泥' }]
    }, ctx)
    expect(r.success).toBe(true)
    expect(ctx.basicMixDesignService.createBasicMixDesign).toHaveBeenCalled()
    expect(ctx.basicMixDesignService.updateBasicMixDesign).not.toHaveBeenCalled()
  })

  test('#30 传 id 存在 → 更新', async () => {
    const ctx = makeContext()
    ctx.basicMixDesignService.findById.mockResolvedValue(fakeBasicMix({ id: 5 }))
    askUser.execute.mockResolvedValue({ success: true, values: { name: 'X', strengthGrade: 'C30', concreteType: '普通', slump: 180, isDefault: false } })
    const r = await saveBasicMixDesign.execute({
      id: 5, name: 'X', strengthGrade: 'C30', concreteType: '普通', materials: [{ materialType: '水泥' }]
    }, ctx)
    expect(r.success).toBe(true)
    expect(ctx.basicMixDesignService.updateBasicMixDesign).toHaveBeenCalledWith(5, expect.any(Object))
  })

  test('#31 传 id 不存在 → NOT_FOUND', async () => {
    const ctx = makeContext()
    ctx.basicMixDesignService.findById.mockResolvedValue(null)
    const r = await saveBasicMixDesign.execute({
      id: 999, name: 'X', strengthGrade: 'C30', concreteType: '普通', materials: [{ materialType: '水泥' }]
    }, ctx)
    expect(r.success).toBe(false)
    expect(r.error.code).toBe('NOT_FOUND')
  })

  test('#44 save_basic_mix 新增 → 写 audit_logs(CREATE, before=null)', async () => {
    const ctx = makeContext()
    askUser.execute.mockResolvedValue({ success: true, values: { name: 'X', strengthGrade: 'C30', concreteType: '普通', slump: 180, isDefault: false } })
    ctx.basicMixDesignService.createBasicMixDesign.mockResolvedValue({ id: 102, toJSON: () => ({ id: 102 }) })
    await saveBasicMixDesign.execute({
      name: 'X', strengthGrade: 'C30', concreteType: '普通', materials: [{ materialType: '水泥' }]
    }, ctx)
    expect(ctx.auditLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE', targetType: 'basic_mix', before: null
    }))
  })

  test('#45 save_basic_mix 更新 → 写 audit_logs(UPDATE)', async () => {
    const ctx = makeContext()
    ctx.basicMixDesignService.findById.mockResolvedValue(fakeBasicMix({ id: 5, name: 'old' }))
    askUser.execute.mockResolvedValue({ success: true, values: { name: 'new', strengthGrade: 'C30', concreteType: '普通', slump: 180, isDefault: false } })
    await saveBasicMixDesign.execute({
      id: 5, name: 'new', strengthGrade: 'C30', concreteType: '普通', materials: [{ materialType: '水泥' }]
    }, ctx)
    expect(ctx.auditLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', targetType: 'basic_mix', targetId: 5
    }))
  })
})

// ============================================================
// delete_basic_mix_design（测试 #32, #33, #34, #46）
// ============================================================
describe('delete_basic_mix_design', () => {
  beforeEach(() => {
    askUser.execute.mockReset()
  })

  test('#32 用户确认 → 删除', async () => {
    const ctx = makeContext()
    ctx.basicMixDesignService.findById.mockResolvedValue(fakeBasicMix({ id: 1 }))
    askUser.execute.mockResolvedValue({ success: true, answer: '确认删除' })
    const r = await deleteBasicMixDesign.execute({ id: 1 }, ctx)
    expect(r.success).toBe(true)
    expect(ctx.basicMixDesignService.deleteBasicMixDesign).toHaveBeenCalledWith(1)
  })

  test('#33 用户取消 → 不删', async () => {
    const ctx = makeContext()
    ctx.basicMixDesignService.findById.mockResolvedValue(fakeBasicMix({ id: 1 }))
    askUser.execute.mockResolvedValue({ success: true, answer: '取消' })
    const r = await deleteBasicMixDesign.execute({ id: 1 }, ctx)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/取消/)
    expect(ctx.basicMixDesignService.deleteBasicMixDesign).not.toHaveBeenCalled()
  })

  test('#34 被引用 → IN_USE + 引用方案名清单', async () => {
    const ctx = makeContext()
    ctx.basicMixDesignService.findById.mockResolvedValue(fakeBasicMix({ id: 1 }))
    ctx.mixDesignService.findByBasicMixId.mockResolvedValue([
      { id: 10, name: 'C30-项目1' },
      { id: 11, name: 'C30-项目2' }
    ])
    const r = await deleteBasicMixDesign.execute({ id: 1 }, ctx)
    expect(r.success).toBe(false)
    expect(r.error.code).toBe('IN_USE')
    expect(r.details.referencedCount).toBe(2)
    expect(r.details.referencedNames).toEqual(['C30-项目1', 'C30-项目2'])
    expect(ctx.basicMixDesignService.deleteBasicMixDesign).not.toHaveBeenCalled()
    expect(askUser.execute).not.toHaveBeenCalled()  // 引用检查先于弹窗
  })

  test('#46 delete_basic_mix 成功 → 写 audit_logs(DELETE)', async () => {
    const ctx = makeContext()
    ctx.basicMixDesignService.findById.mockResolvedValue(fakeBasicMix({ id: 1 }))
    askUser.execute.mockResolvedValue({ success: true, answer: '确认删除' })
    await deleteBasicMixDesign.execute({ id: 1 }, ctx)
    expect(ctx.auditLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', targetType: 'basic_mix', targetId: 1
    }))
  })
})

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

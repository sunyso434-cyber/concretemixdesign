const path = require('path')
const fs = require('fs')
const os = require('os')

// 避免 buildMaterialsIndex 触发真实数据库调用（execute 路径上的惰性依赖）
jest.mock('../../services/MaterialService', () => ({
  getAllMaterials: jest.fn().mockResolvedValue([])
}))

describe('blueprint-loader', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-loader-'))
    fs.writeFileSync(
      path.join(tmpDir, 'meta.yaml'),
      'name: "测试技能"\nversion: "1.0.0"\ndescription: "测试"\nparameters: []\n'
    )
    fs.writeFileSync(
      path.join(tmpDir, 'blueprint.yaml'),
      'steps:\n  - type: const\n    var: x\n    value: 1\n'
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    // 清理进程级材料缓存，避免跨用例污染
    require('../../skills/blueprint-loader').invalidateMaterialsCache()
  })

  test('wrapBlueprintAsSkill 返回标准技能对象', () => {
    const { wrapBlueprintAsSkill } = require('../../skills/blueprint-loader')
    const skill = wrapBlueprintAsSkill(tmpDir)
    expect(skill.name).toBe('测试技能')
    expect(skill.category).toBe('blueprint')
    expect(typeof skill.execute).toBe('function')
  })

  // 回归测试：修复 services_undeclared 报错
  // 背景：DynamicContextProvider.getServices 强制要求技能声明 services 数组，
  // 之前 wrapBlueprintAsSkill 未加该字段，导致运行时抛 services_undeclared。
  test('wrapBlueprintAsSkill 必须声明 services 字段（防止 services_undeclared）', () => {
    const { wrapBlueprintAsSkill } = require('../../skills/blueprint-loader')
    const skill = wrapBlueprintAsSkill(tmpDir)
    expect(skill.services).toBeDefined()
    expect(Array.isArray(skill.services)).toBe(true)
    expect(skill.services).toEqual([])
  })

  test('包装后的蓝图技能能通过 DynamicContextProvider.getServices 检查', () => {
    const { wrapBlueprintAsSkill } = require('../../skills/blueprint-loader')
    const skill = wrapBlueprintAsSkill(tmpDir)
    const DynamicContextProvider = require('../../agent/DynamicContextProvider')
    const provider = new DynamicContextProvider({})
    expect(() => provider.getServices(skill)).not.toThrow()
  })

  // ===== 阶段2任务2.6：category 改 concrete_type =====

  test('meta.concrete_type 存在时 category 取 concrete_type 值', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'meta.yaml'),
      'name: "自密实蓝图"\nversion: "1.0.0"\ndescription: "测试"\nconcrete_type: "self_compacting"\nparameters: []\n'
    )
    const { wrapBlueprintAsSkill } = require('../../skills/blueprint-loader')
    const skill = wrapBlueprintAsSkill(tmpDir)
    expect(skill.category).toBe('self_compacting')
  })

  test('meta.concrete_type 缺失时 category 回退 "blueprint"', () => {
    // beforeEach 的 meta.yaml 无 concrete_type 字段
    const { wrapBlueprintAsSkill } = require('../../skills/blueprint-loader')
    const skill = wrapBlueprintAsSkill(tmpDir)
    expect(skill.category).toBe('blueprint')
  })

  test('蓝图技能标记 _isBlueprint=true（供 triggerMode 识别）', () => {
    const { wrapBlueprintAsSkill } = require('../../skills/blueprint-loader')
    const skill = wrapBlueprintAsSkill(tmpDir)
    expect(skill._isBlueprint).toBe(true)
  })

  // ===== 阶段2任务2.6：buildMaterialsIndex 进程级缓存 =====

  test('buildMaterialsIndex 命中进程级缓存，材料变更失效后重建', async () => {
    const MaterialService = require('../../services/MaterialService')
    const { buildMaterialsIndex, invalidateMaterialsCache } = require('../../skills/blueprint-loader')

    // 初始材料库
    MaterialService.getAllMaterials.mockResolvedValue([
      { id: 1, type: '水泥', name: '水泥A' },
      { id: 2, type: '细骨料', name: '砂A' }
    ])
    const first = await buildMaterialsIndex()
    expect(first['水泥']).toHaveLength(1)

    // 材料库变更（新增一种水泥）但未失效 → 仍返回旧缓存
    MaterialService.getAllMaterials.mockResolvedValue([
      { id: 1, type: '水泥', name: '水泥A' },
      { id: 2, type: '细骨料', name: '砂A' },
      { id: 3, type: '水泥', name: '水泥B' }
    ])
    const cached = await buildMaterialsIndex()
    expect(cached['水泥']).toHaveLength(1)

    // 失效后重建 → 返回最新数据
    invalidateMaterialsCache()
    const fresh = await buildMaterialsIndex()
    expect(fresh['水泥']).toHaveLength(2)
  })
})

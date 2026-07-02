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

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

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
})

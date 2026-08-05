/**
 * SystemService Excel 材料导入 → 蓝图材料缓存失效 wiring 测试
 *
 * 阶段2任务2.6 审查修复：SystemService.importData 直接写 Material 表（绕过 MaterialService），
 * 原实现从不调用 invalidateMaterialsCache()，导致「导入材料 → 立即跑配合比蓝图」拿到过期材料。
 * 此测试验证：新格式 / 旧格式两条 Excel 材料导入路径执行后，蓝图材料缓存都被失效。
 *
 * 做法：mock Material 模型 + mock MaterialService.getAllMaterials，
 * 用 spy 替代 parseImportFile（跳过真实 Excel 解析），走真实 importData 分支。
 */

// Mock Material 模型：拦截 create，避免真实 DB
jest.mock('../../db/models/Material', () => ({
  create: jest.fn().mockResolvedValue({})
}))

// Mock SystemParam 模型：SystemService 模块顶层 require 它，连带拉起真实 sequelize/sqlite
// 原生层，在本地 CI 环境会 Segfault。importData 路径不触达 SystemParam，mock 空对象即可。
jest.mock('../../db/models/SystemParam', () => ({}))

// Mock MaterialService：控制 buildMaterialsIndex 的数据源
jest.mock('../../services/MaterialService', () => ({
  getAllMaterials: jest.fn()
}))

const SystemService = require('../../services/SystemService')

describe('SystemService Excel 材料导入 → 蓝图材料缓存失效', () => {
  const Material = require('../../db/models/Material')
  const MaterialService = require('../../services/MaterialService')
  const { buildMaterialsIndex, invalidateMaterialsCache } = require('../../skills/blueprint-loader')

  beforeEach(() => {
    invalidateMaterialsCache()
    jest.clearAllMocks()
  })

  afterEach(() => {
    invalidateMaterialsCache()
    jest.restoreAllMocks()
  })

  test('新格式 Excel 材料导入后蓝图材料缓存失效', async () => {
    jest.spyOn(SystemService, 'parseImportFile').mockResolvedValue({
      isNewFormat: true,
      type: 'materials',
      sheets: {
        '01_水泥': [
          { name: '水泥X', type: '水泥', density: 3.1 },
          { name: '水泥Y', type: '水泥', density: 3.15 }
        ]
      }
    })

    // 预填缓存：材料库 A
    MaterialService.getAllMaterials.mockResolvedValue([{ id: 1, type: '水泥', name: '水泥A' }])
    const before = await buildMaterialsIndex()
    expect(before['水泥']).toHaveLength(1)

    // 执行 Excel 导入（新格式 materials）
    const onProgress = jest.fn()
    const result = await SystemService.importData('task', { type: 'materials', filePath: 'x.xlsx' }, onProgress)

    expect(result.count).toBe(2)
    expect(Material.create).toHaveBeenCalledTimes(2) // 导入路径真实执行

    // 材料库变为 B：缓存应已失效 → buildMaterialsIndex 返回最新数据
    MaterialService.getAllMaterials.mockResolvedValue([
      { id: 1, type: '水泥', name: '水泥A' },
      { id: 2, type: '水泥', name: '水泥B' }
    ])
    const after = await buildMaterialsIndex()
    expect(after['水泥']).toHaveLength(2)
  })

  test('旧格式 Excel 材料导入后蓝图材料缓存失效', async () => {
    jest.spyOn(SystemService, 'parseImportFile').mockResolvedValue({
      isNewFormat: false,
      rows: [
        { name: '砂A', type: '细骨料', density: 2.6 },
        { name: '砂B', type: '细骨料', density: 2.7 }
      ]
    })

    // 预填缓存：材料库 A
    MaterialService.getAllMaterials.mockResolvedValue([{ id: 1, type: '细骨料', name: '砂A' }])
    const before = await buildMaterialsIndex()
    expect(before['细骨料']).toHaveLength(1)

    // 执行 Excel 导入（旧格式 materials）
    const onProgress = jest.fn()
    const result = await SystemService.importData('task', { type: 'materials', filePath: 'x.csv' }, onProgress)

    expect(result.count).toBe(2)
    expect(Material.create).toHaveBeenCalledTimes(2)

    // 材料库变为 B：缓存应已失效 → buildMaterialsIndex 返回最新数据
    MaterialService.getAllMaterials.mockResolvedValue([
      { id: 1, type: '细骨料', name: '砂A' },
      { id: 2, type: '细骨料', name: '砂B' }
    ])
    const after = await buildMaterialsIndex()
    expect(after['细骨料']).toHaveLength(2)
  })
})

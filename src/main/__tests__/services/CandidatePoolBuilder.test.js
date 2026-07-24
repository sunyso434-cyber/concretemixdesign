// src/main/__tests__/services/CandidatePoolBuilder.test.js
const CandidatePoolBuilder = require('../../../main/services/CandidatePoolBuilder')

jest.mock('../../../main/services/MaterialService', () => ({
  getAllMaterials: jest.fn().mockResolvedValue([
    { id: 1, name: 'P.O 42.5', type: '水泥', price: 480, density: 3.1 },
    { id: 2, name: 'P.O 52.5', type: '水泥', price: 580, density: 3.15 },
    { id: 3, name: '粉煤灰I级', type: '粉煤灰', price: 180, density: 2.2 },
    { id: 7, name: '机制砂', type: '细骨料', price: 80, density: 2.65 },
    { id: 8, name: '河砂', type: '细骨料', price: 100, density: 2.68 },
    { id: 9, name: '碎石5-25', type: '粗骨料', price: 90, density: 2.70 },
    { id: 10, name: '聚羧酸A', type: '减水剂', price: 3500, density: 1.05 },
    { id: 11, name: '自来水', type: '水', price: 5, density: 1.00 },
    { id: 12, name: '井水', type: '水', price: 3, density: 1.00 },
  ])
}))

describe('CandidatePoolBuilder.buildSnapshot', () => {
  test('正常构建快照', async () => {
    const materialIds = {
      cementIds: [1, 2], flyAshIds: [3], slagIds: [], lithiumSlagIds: [],
      compositePowderIds: [], sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [11]
    }
    const snapshot = await CandidatePoolBuilder.buildSnapshot(materialIds)
    expect(snapshot.candidatePools.cement).toHaveLength(2)
    expect(snapshot.candidatePools.sand).toHaveLength(1)
    expect(snapshot.candidatePools.water).toHaveLength(1)
    expect(snapshot.byId.get(1)).toBeDefined()
    expect(snapshot.byType['水泥']).toBeDefined()
  })

  test('水泥缺失抛错', async () => {
    const materialIds = { cementIds: [], sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [11] }
    await expect(CandidatePoolBuilder.buildSnapshot(materialIds))
      .rejects.toThrow('水泥候选不能为空')
  })

  test('水缺失抛错', async () => {
    const materialIds = { cementIds: [1], sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [] }
    await expect(CandidatePoolBuilder.buildSnapshot(materialIds))
      .rejects.toThrow('水候选不能为空')
  })

  test('水超过1个抛错', async () => {
    const materialIds = { cementIds: [1], sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [11, 12] }
    await expect(CandidatePoolBuilder.buildSnapshot(materialIds))
      .rejects.toThrow('水候选必须且只能指定 1 种')
  })

  test('砂超过2个抛错', async () => {
    const materialIds = {
      cementIds: [1], sandIds: [7, 8, 11], stoneIds: [9], spIds: [10], waterIds: [12],
      flyAshIds: [], slagIds: [], lithiumSlagIds: [], compositePowderIds: []
    }
    await expect(CandidatePoolBuilder.buildSnapshot(materialIds))
      .rejects.toThrow('细骨料候选最多2种')
  })

  test('石超过2个抛错', async () => {
    const materialIds = {
      cementIds: [1], sandIds: [7], stoneIds: [9, 10, 11], spIds: [10], waterIds: [12],
      flyAshIds: [], slagIds: [], lithiumSlagIds: [], compositePowderIds: []
    }
    await expect(CandidatePoolBuilder.buildSnapshot(materialIds))
      .rejects.toThrow('粗骨料候选最多2种')
  })

  test('ID 不存在抛错', async () => {
    const materialIds = {
      cementIds: [999], sandIds: [7], stoneIds: [9], spIds: [10], waterIds: [11],
      flyAshIds: [], slagIds: [], lithiumSlagIds: [], compositePowderIds: []
    }
    await expect(CandidatePoolBuilder.buildSnapshot(materialIds))
      .rejects.toThrow('材料 ID 999 不存在')
  })
})

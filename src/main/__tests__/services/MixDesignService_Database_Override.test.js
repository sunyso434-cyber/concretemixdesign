/**
 * Task 3: calculateMixDesign 支持 _overrideBaseWaterAmount / _overrideSpDosage / 默认 mass
 *
 * - mock SystemService.getParamByName（强度标准差 + 回归系数 + 减水剂参数）
 * - 验证：默认 calculationMethod = 'mass'（result.calculationMethod === 'mass'）
 * - 验证：_overrideBaseWaterAmount 覆盖后 result.materials.water 改变
 * - 验证：_overrideSpDosage 覆盖后 result.superplasticizerDosage 改变
 */

// 1) Mock SystemService：返回固定参数（避免数据库/真实参数表）
const SystemService = require('../../../main/services/SystemService')
SystemService.getParamByName = async (name) => {
  const map = {
    'strengthStdDev_C30': { value: '5.0' },
    'strengthStdDev_C20': { value: '4.0' },
    'strengthStdDev_C50': { value: '6.0' },
    'regressionAlphaA': { value: '0.53' },
    'regressionAlphaB': { value: '0.20' },
    'waterReducingRatePer01Dosage': { value: '2.0' }
  }
  return map[name] || null
}

const MixDesignService = require('../../../main/services/MixDesignService')

const baseMaterials = {
  cement: {
    id: 1,
    name: 'P·O 42.5',
    price: 480,
    compressiveStrength28d: 48,
    density: 3.15
  },
  sand: {
    id: 2,
    name: '砂',
    price: 150,
    finenessModulus: 2.8,
    mbValue: 0.5,
    density: 2.63
  },
  stone: {
    id: 3,
    name: '碎石',
    price: 120,
    specification: '5-20mm',
    density: 2.70
  },
  superplasticizer: {
    id: 4,
    name: '减水剂',
    price: 5000,
    waterReducingRate: 25,
    recommendedDosage: 1.5,
    density: 1.05
  }
}

const baseParams = {
  strength: 'C30',
  slump: 120,
  flyAshDosage: 0,
  slagDosage: 0,
  sandRatio: 35,
  tempSettings: null,
  materials: baseMaterials
}

describe('calculateMixDesign 新参数支持（Task 3）', () => {
  test('默认 calculationMethod = mass', async () => {
    const result = await MixDesignService.calculateMixDesign(baseParams)
    expect(result).toBeDefined()
    expect(result.calculationMethod).toBe('mass')
  })

  test('_overrideBaseWaterAmount 覆盖基准用水量', async () => {
    const result1 = await MixDesignService.calculateMixDesign(baseParams)
    const result2 = await MixDesignService.calculateMixDesign({
      ...baseParams,
      _overrideBaseWaterAmount: 200 // 覆盖基准用水量（默认通常为 215 左右）
    })
    expect(result1.materials.water).toBeDefined()
    expect(result2.materials.water).toBeDefined()
    expect(result1.materials.water).not.toBe(result2.materials.water)
  })

  test('_overrideSpDosage 覆盖减水剂掺量', async () => {
    const result1 = await MixDesignService.calculateMixDesign(baseParams)
    const result2 = await MixDesignService.calculateMixDesign({
      ...baseParams,
      _overrideSpDosage: 2.0 // 覆盖减水剂掺量
    })
    expect(result1.superplasticizerDosage).toBeDefined()
    expect(result2.superplasticizerDosage).toBeDefined()
    expect(result1.superplasticizerDosage).not.toBe(result2.superplasticizerDosage)
    expect(result2.superplasticizerDosage).toBe(2.0)
  })
})

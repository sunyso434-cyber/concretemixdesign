/**
 * MixDesignService 快照测试（用于蓝图引擎回归对比）
 *
 * 这些快照将作为基准，用于 Task 20 的蓝图引擎回归测试。
 * 通过对比 BlueprintEngine 输出与 MixDesignService.calculateMixDesign() 的输出，
 * 可以检测新引擎是否偏离了原始 JGJ 55 计算逻辑。
 *
 * 设计要点：
 * 1. Mock SystemService 避免依赖数据库/真实参数表（让 getParamByName 返回 null，走默认值）
 * 2. 显式传入 tempSettings 的关键参数（强度标准差、回归系数），确保输出确定性
 * 3. 不直接快照整个 result 对象（含有 date/timestamp 等动态字段会失效），而是用 toMatchSnapshot({...})
 *    挑选稳定的、可重现的输出字段
 *
 * 实际 API 摘要（与 brief 占位符不同）：
 * - 方法名：calculateMixDesign（不是 calculate）
 * - 入参：{ strength: 'C30', slump, materials: { cement, sand, stone, superplasticizer }, tempSettings,
 *          calculationMethod: 'absolute'|'mass', airContent, flyAshDosage, sandRatio, ... }
 * - 出参：{ targetStrength, waterRatio, sandRatio, density, materials: { water, cement, sand, stone, ... },
 *          superplasticizerDosage, waterReducingRate, ... }
 */

const path = require('path')

// 计算 require 路径：snapshot.test.js 在 src/main/__tests__/services/MixDesignService/ 下
// 目标：src/main/services/MixDesignService/MixDesignService_Database.js
// 相对路径：../../../services/MixDesignService/MixDesignService_Database

// 1) Mock SystemService：让 getParamByName 全部返回 null，调用方会走默认值回退
jest.mock('../../../services/SystemService', () => {
  return {
    __esModule: false,
    default: {
      getParamByName: jest.fn(async () => null),
      getAllParams: jest.fn(async () => [])
    },
    getParamByName: jest.fn(async () => null),
    getAllParams: jest.fn(async () => [])
  }
})

const MixDesignService = require('../../../services/MixDesignService/MixDesignService_Database')

// 一套"标准普通混凝土"原材料（不掺加粉煤灰/矿粉/锂渣等），方便快照稳定
const baseMaterials = {
  cement: {
    id: 1,
    name: 'P.O 42.5 普通硅酸盐水泥',
    type: '水泥',
    density: 3.15,
    price: 480,
    compressiveStrength28d: 48.0
  },
  sand: {
    id: 7,
    name: '中砂',
    type: '细骨料',
    density: 2.63,
    price: 120,
    finenessModulus: 2.8,
    mbValue: 0.5
  },
  stone: {
    id: 9,
    name: '碎石 5-20mm',
    type: '粗骨料',
    specification: '5-20mm',
    density: 2.70,
    price: 110,
    crushingValue: 10
  },
  superplasticizer: {
    id: 20,
    name: '聚羧酸减水剂',
    type: '外加剂',
    density: 1.05,
    price: 8500,
    recommendedDosage: 1.5,
    waterReducingRate: 25
  }
}

const tempSettings = {
  strengthStdDev: 5.0,        // C25-C45 范围，5.0 MPa
  regressionAlphaA: 0.53,
  regressionAlphaB: 0.20,
  waterReducingRatePer01Dosage: 2.0,
  strengthInfluence: 0.1,
  mbInfluence: 0.1,
  finenessInfluence: 0.1
}

// 从 result 中挑出"稳定可重现"的核心字段（去掉含动态/可变数据的字段）
function pickStableFields(result) {
  return {
    targetStrength: Number(result.targetStrength.toFixed(4)),
    strengthStdDev: Number(result.strengthStdDev.toFixed(4)),
    waterRatio: Number(result.waterRatio.toFixed(4)),
    sandRatio: Number(result.sandRatio.toFixed(4)),
    density: Number(result.density.toFixed(2)),
    superplasticizerDosage: Number(result.superplasticizerDosage.toFixed(4)),
    waterReducingRate: Number(result.waterReducingRate.toFixed(4)),
    influenceFactor: Number(result.influenceFactor.toFixed(4)),
    calculationMethod: result.calculationMethod,
    airContent: result.airContent,
    targetDensity: result.targetDensity,
    slump: result.slump,
    materials: {
      water: Number(result.materials.water.toFixed(2)),
      cement: Number(result.materials.cement.toFixed(2)),
      flyAsh: Number((result.materials.flyAsh || 0).toFixed(2)),
      slag: Number((result.materials.slag || 0).toFixed(2)),
      sand: Number(result.materials.sand.toFixed(2)),
      stone: Number(result.materials.stone.toFixed(2)),
      superplasticizer: Number(result.materials.superplasticizer.toFixed(4))
    }
  }
}

describe('MixDesignService 快照测试（用于蓝图引擎回归对比）', () => {
  test('普通混凝土 C30 配合比快照（42.5 水泥，180mm 坍落度，5-20mm 碎石）', async () => {
    const result = await MixDesignService.calculateMixDesign({
      strength: 'C30',
      slump: 180,
      calculationMethod: 'absolute',
      airContent: 1.0,
      flyAshDosage: 0,
      slagDosage: 0,
      materials: baseMaterials,
      tempSettings
    })

    // 业务合理性断言（防止快照生成但数值不合理）
    expect(result.waterRatio).toBeGreaterThan(0.4)
    expect(result.waterRatio).toBeLessThan(0.6)
    expect(result.materials.cement).toBeGreaterThan(200) // 200~500 kg/m³ 合理
    expect(result.materials.cement).toBeLessThan(500)
    expect(result.materials.water).toBeGreaterThan(120)
    expect(result.materials.water).toBeLessThan(220)
    expect(result.density).toBeGreaterThan(2300)
    expect(result.density).toBeLessThan(2500)

    // 快照对比（仅稳定字段）
    expect(pickStableFields(result)).toMatchSnapshot()
  })

  test('普通混凝土 C50 高强快照（52.5 水泥，200mm 坍落度，5-20mm 碎石）', async () => {
    // C50 高强：水泥强度更高（实际从 42.5 升级到 52.5）
    const materialsC50 = JSON.parse(JSON.stringify(baseMaterials))
    materialsC50.cement = {
      ...materialsC50.cement,
      name: 'P.O 52.5 普通硅酸盐水泥',
      compressiveStrength28d: 58.0 // 52.5 水泥 28 天典型抗压强度
    }

    // C50 强度标准差更大（C50及以上）
    const tempSettingsC50 = {
      ...tempSettings,
      strengthStdDev: 6.0
    }

    const result = await MixDesignService.calculateMixDesign({
      strength: 'C50',
      slump: 200,
      calculationMethod: 'absolute',
      airContent: 1.0,
      flyAshDosage: 0,
      slagDosage: 0,
      materials: materialsC50,
      tempSettings: tempSettingsC50
    })

    // 业务合理性断言
    expect(result.waterRatio).toBeGreaterThan(0.3) // C50 水胶比更低
    expect(result.waterRatio).toBeLessThan(0.5)
    expect(result.materials.cement).toBeGreaterThan(300) // 高强混凝土水泥用量更高
    expect(result.materials.cement).toBeLessThan(600)
    expect(result.density).toBeGreaterThan(2300)
    expect(result.density).toBeLessThan(2500)

    // 快照对比
    expect(pickStableFields(result)).toMatchSnapshot()
  })
})
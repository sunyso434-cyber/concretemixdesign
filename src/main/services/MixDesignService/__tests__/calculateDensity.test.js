/**
 * 容重计算测试
 * 验证 calculateDensity 函数正确求和所有材料用量
 *
 * 关键 bug 场景：
 * - 老板报告的 C30 配合比容重显示 523.0 / 525.5 kg/m³，远低于真实值 ~2400 kg/m³
 * - 根因：原代码用 `filter(key => key !== 'sand' && key !== 'stone')` 把骨料全部排除掉了
 * - 修复后：保留 sand/stone 总键，排除细分键（sand_<id>、stone_<id>）避免重复计算
 */

const MixDesignService_Aggregate = require('../MixDesignService_Aggregate')

describe('calculateDensity 容重计算', () => {
  describe('单一砂石场景（老板遇到的 bug）', () => {
    test('单一砂石时，容重应包含所有材料（修复后约 2400 kg/m³）', () => {
      // 老板的真实 C30 方案二（港泰中砂 ID 42）数据
      const materialAmounts = {
        water: 167.0,
        cement: 298.3,
        flyAsh: 52.6,
        sand: 938.8,        // 总砂量
        stone: 938.8,       // 总石量
        superplasticizer: 7.55
      }
      const density = MixDesignService_Aggregate.calculateDensity(materialAmounts)
      const expected = 167.0 + 298.3 + 52.6 + 938.8 + 938.8 + 7.55
      expect(density).toBeCloseTo(expected, 1)
      // 修复前：density = 167 + 298.3 + 52.6 + 7.55 = 525.45（漏掉骨料）
      // 修复后：density = 2403.05（包含骨料）
      expect(density).toBeGreaterThan(2350) // 合理容重下限
      expect(density).toBeLessThan(2500)    // 合理容重上限
    })
  })

  describe('多种骨料场景（避免重复计算）', () => {
    test('多种砂时，sand_<id> 细分键应被排除，只算总键 sand 一次', () => {
      const materialAmounts = {
        water: 167.0,
        cement: 298.3,
        sand: 935.0,         // 砂总量
        sand_7: 561.0,       // 砂细分 1
        sand_42: 374.0,      // 砂细分 2
        stone: 935.0
      }
      const density = MixDesignService_Aggregate.calculateDensity(materialAmounts)
      const expected = 167.0 + 298.3 + 935.0 + 935.0 // 单一砂石时
      expect(density).toBeCloseTo(expected, 1)
    })

    test('多种石时，stone_<id> 细分键应被排除', () => {
      const materialAmounts = {
        water: 167.0,
        cement: 298.3,
        sand: 935.0,
        stone: 935.0,
        stone_9: 700.0,
        stone_10: 235.0
      }
      const density = MixDesignService_Aggregate.calculateDensity(materialAmounts)
      const expected = 167.0 + 298.3 + 935.0 + 935.0
      expect(density).toBeCloseTo(expected, 1)
    })
  })

  describe('边界场景', () => {
    test('空对象应返回 0', () => {
      expect(MixDesignService_Aggregate.calculateDensity({})).toBe(0)
    })

    test('null/undefined 应返回 0', () => {
      expect(MixDesignService_Aggregate.calculateDensity(null)).toBe(0)
      expect(MixDesignService_Aggregate.calculateDensity(undefined)).toBe(0)
    })

    test('undefined 数值应视为 0，不应导致 NaN', () => {
      const materialAmounts = {
        water: 167.0,
        cement: 298.3,
        sand: undefined,  // 容错
        stone: 935.0
      }
      const density = MixDesignService_Aggregate.calculateDensity(materialAmounts)
      expect(density).toBeCloseTo(167.0 + 298.3 + 0 + 935.0, 1)
    })
  })
})

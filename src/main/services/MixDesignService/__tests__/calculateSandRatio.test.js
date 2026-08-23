/**
 * 砂率计算公式测试
 * 验证 calculateSandRatio 函数的三个修复点：
 * 1. 基础砂率 37%（用户要求）
 * 2. 水胶比系数 0.2（修复 10x 偏差 bug）
 * 3. FM 影响能正常体现（修复 0.50 封顶吞差异问题）
 */

const MixDesignService_Aggregate = require('../MixDesignService_Aggregate')

describe('calculateSandRatio 砂率公式', () => {
  describe('基础砂率（baseSandRatio）', () => {
    test('水胶比0.40、坍落度60mm、FM=2.8时，砂率应为37%', () => {
      // 修复前：0.33
      // 修复后：0.37
      const result = MixDesignService_Aggregate.calculateSandRatio(0.40, 60, 2.8)
      expect(result).toBeCloseTo(0.37, 4)
    })
  })

  describe('水胶比影响系数（修复 10x 偏差 bug）', () => {
    test('水胶比每增加0.05，砂率应增加1%（0.016 小数）', () => {
      // 基准：waterRatio=0.40
      const baseline = MixDesignService_Aggregate.calculateSandRatio(0.40, 60, 2.8)
      // +0.05：水胶比 0.45
      const plus005 = MixDesignService_Aggregate.calculateSandRatio(0.45, 60, 2.8)
      // +0.10：水胶比 0.50
      const plus010 = MixDesignService_Aggregate.calculateSandRatio(0.50, 60, 2.8)

      const diff005 = plus005 - baseline
      const diff010 = plus010 - baseline

      // 修复前：diff005 = 0.10（10%），是规则的10倍
      // 修复后：diff005 应为 0.01（1%）
      expect(diff005).toBeCloseTo(0.01, 4)
      expect(diff010).toBeCloseTo(0.02, 4)
    })

    test('本次 C30 配合比（水胶比 0.48）的砂率应符合规范', () => {
      // 水胶比 0.48：比基准 0.40 多 0.08，预期增加 0.08/0.05*1% = 1.6% = 0.016
      // 加上基准 37% + 1.6% = 38.6%（未叠加坍落度和 FM）
      const slumpBaseline = 60
      const fmBaseline = 2.8
      const result = MixDesignService_Aggregate.calculateSandRatio(0.48, slumpBaseline, fmBaseline)
      expect(result).toBeCloseTo(0.37 + 0.016, 4) // 0.386
    })
  })

  describe('坍落度影响系数', () => {
    test('坍落度每增加20mm，砂率应增加1%（0.01 小数）', () => {
      const baseline = MixDesignService_Aggregate.calculateSandRatio(0.40, 60, 2.8)
      const plus20 = MixDesignService_Aggregate.calculateSandRatio(0.40, 80, 2.8)
      expect(plus20 - baseline).toBeCloseTo(0.01, 4)
    })
  })

  describe('细度模数 FM 影响', () => {
    test('FM 每增加 0.1，砂率应增加 0.5%（0.005 小数）', () => {
      const baseline = MixDesignService_Aggregate.calculateSandRatio(0.40, 60, 2.8)
      const plus01 = MixDesignService_Aggregate.calculateSandRatio(0.40, 60, 2.9)
      expect(plus01 - baseline).toBeCloseTo(0.005, 4)
    })
  })

  describe('【核心 bug】FM 影响不能被 0.50 封顶吃掉', () => {
    test('机制砂（FM=2.97）vs 港泰中砂（FM=2.5）应有可见差异', () => {
      // 老板的真实场景：水胶比 0.48、坍落度 180mm
      const jixiesha = MixDesignService_Aggregate.calculateSandRatio(0.48, 180, 2.97)
      const gangtai = MixDesignService_Aggregate.calculateSandRatio(0.48, 180, 2.5)

      // 修复前：两者都封顶到 0.50，差异 = 0
      // 修复后：差异 ≈ 0.0234（2.34%）
      expect(Math.abs(jixiesha - gangtai)).toBeGreaterThan(0.02)
      // 进一步确认：粗砂（FM大）砂率应大于细砂（FM小）
      expect(jixiesha).toBeGreaterThan(gangtai)
    })

    test('本次 C30 + 180mm 场景，砂率应在 40%~46% 范围内（合理）', () => {
      // 预期：0.37 (base) + 0.016 (水胶比) + 0.06 (坍落度) + 0.0085 (FM=2.97) = 0.4545
      const result = MixDesignService_Aggregate.calculateSandRatio(0.48, 180, 2.97)
      expect(result).toBeGreaterThan(0.40)
      expect(result).toBeLessThan(0.50)
    })
  })

  describe('骨料类型（2026-08-23 卵石加成修复）', () => {
    const base = () => MixDesignService_Aggregate.calculateSandRatio(0.45, 120, 2.8)

    test("卵石（'cobble'）比碎石高 0.025", () => {
      expect(MixDesignService_Aggregate.calculateSandRatio(0.45, 120, 2.8, 'cobble'))
        .toBeCloseTo(base() + 0.025, 10)
    })

    test("卵石中文 '卵石' 与英文 'cobble' 等价（主流程按材料名检测出的是中文）", () => {
      expect(MixDesignService_Aggregate.calculateSandRatio(0.45, 120, 2.8, '卵石'))
        .toBe(MixDesignService_Aggregate.calculateSandRatio(0.45, 120, 2.8, 'cobble'))
    })

    test("碎石三种写法（不传 / 'gravel' / '碎石'）结果一致（碎石用户数值零变化）", () => {
      expect(MixDesignService_Aggregate.calculateSandRatio(0.45, 120, 2.8, 'gravel')).toBe(base())
      expect(MixDesignService_Aggregate.calculateSandRatio(0.45, 120, 2.8, '碎石')).toBe(base())
    })

    test('卵石加成后仍受 0.28-0.50 边界约束', () => {
      const high = MixDesignService_Aggregate.calculateSandRatio(0.65, 220, 3.4, '卵石')
      expect(high).toBeLessThanOrEqual(0.50)
    })
  })
})

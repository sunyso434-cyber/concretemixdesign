/**
 * 端到端验证：减水剂掺量新规则（v10.7.7 老板决策）
 * 跑 6 个真实场景，模拟整个减水剂计算链
 *
 * 用法：node tests/manual/verify-superplasticizer-rule-v2.js
 */

// ponytail: 必须在 require MixDesignService 之前 mock SystemService，否则 WaterRatio/Aggregate
// 内部 require('../SystemService') 时会拿到真实模块，绕过 mock
require.cache[require.resolve('../../src/main/services/SystemService')] = {
  exports: {
    getParamByName: async () => null
  }
}

const MixDesignService_WaterRatio = require('../../src/main/services/MixDesignService/MixDesignService_WaterRatio')
const MixDesignService_Aggregate = require('../../src/main/services/MixDesignService/MixDesignService_Aggregate')

const spStd = { name: '聚羧酸标准型', recommendedDosage: 1.5, waterReducingRate: 28, waterReducingRatePer01Dosage: 2.0 }
const spRet = { name: '聚羧酸缓凝型', recommendedDosage: 1.8, waterReducingRate: 28, waterReducingRatePer01Dosage: 2.0 }
const spCustom = { name: '高效减水剂', recommendedDosage: 1.2, waterReducingRate: 30, waterReducingRatePer01Dosage: 2.5 }

const sand1 = { mbValue: 0.5, finenessModulus: 2.7 }  // 理想砂子
const sand2 = { mbValue: 1.0, finenessModulus: 2.7 }  // MB+0.5 微调
const sand3 = { mbValue: 0.5, finenessModulus: 2.5 }  // 偏细砂（细度模数+0.2）

let passCount = 0
let failCount = 0

function assertEq(actual, expected, label) {
  const ok = Math.abs(actual - expected) < 0.01
  const status = ok ? '✅' : '❌'
  console.log(`  ${status} ${label}: 实际 ${actual} | 预期 ${expected}`)
  if (ok) passCount++; else failCount++
}

async function scenario1() {
  console.log('\n=== 场景 1：选标准型(1.5%)，C30 配合比（无砂石微调） ===')
  console.log('预期：C30 掺量=1.5%, 实际掺量=1.5%, 减水率=28%')

  const c30Baseline = await MixDesignService_WaterRatio.getC30Baseline(spStd, null)
  assertEq(c30Baseline, 1.5, 'C30 基准')

  const spResult = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand1, spStd, null)
  assertEq(spResult.strengthDosage, 1.5, 'strengthDosage')
  assertEq(spResult.finalDosage, 1.5, 'finalDosage')
  assertEq(spResult.baseDosage, 1.5, '材料推荐掺量')

  const rate = await MixDesignService_Aggregate.calculateWaterReducingRate(
    spStd.waterReducingRate, spResult.baseDosage, spResult.strengthDosage, spStd, null
  )
  assertEq(rate, 28, '减水率')
}

async function scenario2() {
  console.log('\n=== 场景 2：选缓凝型(1.8%)，C30 配合比 + 砂 MB=1.0（+0.5 调整）===')
  console.log('预期：strengthDosage=1.8, finalDosage=2.3, 减水率=28%（材料推荐=1.8，掺量差=0）')

  const spResult = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand2, spRet, null)
  assertEq(spResult.strengthDosage, 1.8, 'strengthDosage')
  assertEq(spResult.mbAdjustment, 0.5, 'MB 微调')
  assertEq(spResult.finalDosage, 2.3, 'finalDosage（含微调）')

  const rate = await MixDesignService_Aggregate.calculateWaterReducingRate(
    spRet.waterReducingRate, spResult.baseDosage, spResult.strengthDosage, spRet, null
  )
  // 减水率 = 28 + (1.8-1.8)/0.1 × 2 = 28（材料推荐掺量就是 1.8，掺量差=0）
  assertEq(rate, 28, '减水率（材料推荐=1.8，掺量差=0，砂石微调不影响）')
}

async function scenario3() {
  console.log('\n=== 场景 3：调 C30 基准=1.8（用户覆盖），标准型材料(1.5%)，C30 配合比 ===')
  console.log('预期：C30 基准=1.8（覆盖材料 1.5）, 减水率=34%')

  const ts = { superplasticizerDosageBase_C30: 1.8 }
  const c30Baseline = await MixDesignService_WaterRatio.getC30Baseline(spStd, ts)
  assertEq(c30Baseline, 1.8, 'C30 基准（用户覆盖）')

  const spResult = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand1, spStd, ts)
  assertEq(spResult.strengthDosage, 1.8, 'strengthDosage')
  assertEq(spResult.baseDosage, 1.5, '材料推荐掺量（不变）')

  const rate = await MixDesignService_Aggregate.calculateWaterReducingRate(
    spStd.waterReducingRate, spResult.baseDosage, spResult.strengthDosage, spStd, ts
  )
  assertEq(rate, 34, '减水率（基准=材料推荐 1.5，不是 C30 基准 1.8）')
}

async function scenario4() {
  console.log('\n=== 场景 4：调 C30 使用=1.8（不影响派生），标准型材料(1.5%)，C40 配合比 ===')
  console.log('预期：C30 基准=1.5（材料推荐）, C40 派生=1.7（1.5+2×0.1）, 减水率=32%')

  const ts = { superplasticizerDosage_C30: 1.8 }
  // C30 实际用 1.8（用户指定）
  const c30 = await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C30', spStd, ts)
  assertEq(c30, 1.8, 'C30 使用掺量（用户指定）')
  // C40 仍按 1.5 派生：1.5 + (40-30)/5 × 0.1 = 1.7
  const c40 = await MixDesignService_WaterRatio.getSuperplasticizerDosageByStrength('C40', spStd, ts)
  assertEq(c40, 1.7, 'C40 派生（按 1.5 基准，1.5+2×0.1=1.7）')

  const spResult = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C40', sand1, spStd, ts)
  assertEq(spResult.strengthDosage, 1.7, 'C40 strengthDosage')

  const rate = await MixDesignService_Aggregate.calculateWaterReducingRate(
    spStd.waterReducingRate, spResult.baseDosage, spResult.strengthDosage, spStd, ts
  )
  // 28 + (1.7-1.5)/0.1 × 2 = 28 + 4 = 32
  assertEq(rate, 32, 'C40 减水率')
}

async function scenario5() {
  console.log('\n=== 场景 5：没选减水剂材料，C30 配合比 ===')
  console.log('预期：掺量=0, 减水率=0, 用水量不修正')

  const spResult = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand1, null, null)
  assertEq(spResult.finalDosage, 0, 'finalDosage=0')
  assertEq(spResult.strengthDosage, 0, 'strengthDosage=0')
  assertEq(spResult.hasSuperplasticizer, false, 'hasSuperplasticizer=false')

  // 模拟 Database 层短路：减水率=0
  const rate = spResult.hasSuperplasticizer ? 999 : 0
  assertEq(rate, 0, '减水率=0（短路）')
}

async function scenario6() {
  console.log('\n=== 场景 6：高效减水剂(1.2%, 30%, 2.5)，C30 配合比 ===')
  console.log('预期：C30=1.2%, 减水率=30%')

  const c30Baseline = await MixDesignService_WaterRatio.getC30Baseline(spCustom, null)
  assertEq(c30Baseline, 1.2, 'C30 基准（材料推荐）')

  const spResult = await MixDesignService_Aggregate.calculateSuperplasticizerDosage('C30', sand1, spCustom, null)
  assertEq(spResult.strengthDosage, 1.2, 'strengthDosage')

  const rate = await MixDesignService_Aggregate.calculateWaterReducingRate(
    spCustom.waterReducingRate, spResult.baseDosage, spResult.strengthDosage, spCustom, null
  )
  assertEq(rate, 30, '减水率（用材料 waterReducingRatePer01Dosage=2.5 也不变，因掺量差=0）')
}

async function main() {
  console.log('🧪 端到端验证：减水剂掺量新规则（v10.7.7）')
  console.log('============================================')

  await scenario1()
  await scenario2()
  await scenario3()
  await scenario4()
  await scenario5()
  await scenario6()

  console.log('\n============================================')
  console.log(`✅ 通过 ${passCount} / ❌ 失败 ${failCount}`)
  process.exit(failCount === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('验证脚本异常:', err)
  process.exit(1)
})

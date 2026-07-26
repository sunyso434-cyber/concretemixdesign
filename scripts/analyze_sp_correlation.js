/**
 * 分析训练数据里减水剂掺量与其他特征的相关性
 * 目的：验证"模型把减水剂掺量学成强度第1影响特征"是不是因为共线性/代理变量问题
 *
 * 物理规律：水胶比是强度的决定因素（Paul公式）
 *          减水剂掺量通过减水率→用水量→水胶比间接影响强度
 * 假设：如果训练数据里减水剂掺量和水胶比高度相关，模型会选一个作为"代表"
 */
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

const TRAINING_FILE = path.join(__dirname, '..', 'docs', 'template_training_data.xlsx')

function pearsonCorrelation(x, y) {
  const n = x.length
  if (n === 0) return 0
  const sumX = x.reduce((s, v) => s + v, 0)
  const sumY = y.reduce((s, v) => s + v, 0)
  const sumXY = x.reduce((s, v, i) => s + v * y[i], 0)
  const sumX2 = x.reduce((s, v) => s + v * v, 0)
  const sumY2 = y.reduce((s, v) => s + v * v, 0)
  const num = n * sumXY - sumX * sumY
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
  return den === 0 ? 0 : num / den
}

function main() {
  const wb = XLSX.readFile(TRAINING_FILE)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })

  console.log('='.repeat(80))
  console.log('训练数据相关性分析：为什么减水剂掺量成了强度第1影响特征？')
  console.log('='.repeat(80))
  console.log(`训练数据样本数: ${rows.length}`)
  console.log()

  // 提取关键特征列
  const cols = {
    spDosage: rows.map(r => Number(r.superplasticizer_dosage)).filter(v => !isNaN(v)),
    wbr: rows.map(r => Number(r.water_binder_ratio)).filter(v => !isNaN(v)),
    cement: rows.map(r => Number(r.cement_amount)).filter(v => !isNaN(v)),
    strength: rows.map(r => Number(r.target_strength_28d)).filter(v => !isNaN(v)),
    slump: rows.map(r => Number(r.target_slump)).filter(v => !isNaN(v)),
    sandRatio: rows.map(r => Number(r.sand_ratio)).filter(v => !isNaN(v)),
    spReducingRate: rows.map(r => Number(r.super_water_reducing_rate)).filter(v => !isNaN(v)),
    spRecommendedDosage: rows.map(r => Number(r.super_recommended_dosage)).filter(v => !isNaN(v)),
    lithiumDosage: rows.map(r => Number(r.lithium_slag_dosage) || 0).filter(v => !isNaN(v)),
    compositeDosage: rows.map(r => Number(r.composite_powder_dosage) || 0).filter(v => !isNaN(v))
  }

  // 反推用水量和胶凝材料总量
  const binderAndWater = rows.map(r => {
    const cement = Number(r.cement_amount)
    const wbr = Number(r.water_binder_ratio)
    if (isNaN(cement) || isNaN(wbr) || wbr <= 0) return null
    const totalDosage = (Number(r.fly_ash_dosage) || 0) + (Number(r.slag_dosage) || 0)
      + (Number(r.lithium_slag_dosage) || 0) + (Number(r.composite_powder_dosage) || 0)
    const binderTotal = cement / (1 - totalDosage / 100)
    const water = wbr * binderTotal
    return { binder: binderTotal, water }
  }).filter(v => v !== null)
  cols.binder = binderAndWater.map(v => v.binder)
  cols.water = binderAndWater.map(v => v.water)

  // === 1. 各特征的分布统计 ===
  console.log('--- 1. 关键特征分布统计 ---')
  console.log('特征名                样本数      最小值      最大值      中位数      平均值      标准差       变异系数')
  console.log('-'.repeat(110))
  for (const [name, arr] of Object.entries(cols)) {
    if (arr.length === 0) continue
    const sorted = [...arr].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const median = sorted[Math.floor(sorted.length / 2)]
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
    const std = Math.sqrt(variance)
    const cv = mean !== 0 ? (std / Math.abs(mean) * 100) : 0
    console.log(
      `${name.padEnd(20)} ${String(arr.length).padStart(8)} ${min.toFixed(3).padStart(11)} ${max.toFixed(3).padStart(11)} ` +
      `${median.toFixed(3).padStart(11)} ${mean.toFixed(3).padStart(11)} ${std.toFixed(3).padStart(11)} ${cv.toFixed(1).padStart(8)}%`
    )
  }

  // === 2. 减水剂掺量与其他特征的相关性 ===
  console.log()
  console.log('--- 2. 减水剂掺量与其他特征的皮尔逊相关系数 ---')
  console.log('说明：|r| > 0.7 强相关，0.3~0.7 中等相关，< 0.3 弱相关')
  console.log()
  console.log('特征名                相关系数 r     相关性强度      解读')
  console.log('-'.repeat(90))

  const correlations = [
    { name: '水胶比', arr: cols.wbr },
    { name: '用水量(反推)', arr: cols.water },
    { name: '胶凝材料总量(反推)', arr: cols.binder },
    { name: '水泥用量', arr: cols.cement },
    { name: '28d强度', arr: cols.strength },
    { name: '坍落度', arr: cols.slump },
    { name: '砂率', arr: cols.sandRatio },
    { name: '减水剂减水率(材料属性)', arr: cols.spReducingRate },
    { name: '减水剂推荐掺量(材料属性)', arr: cols.spRecommendedDosage },
    { name: '锂渣掺量', arr: cols.lithiumDosage },
    { name: '复合粉掺量', arr: cols.compositeDosage }
  ]

  for (const c of correlations) {
    // 对齐长度（取最小公共长度）
    const n = Math.min(cols.spDosage.length, c.arr.length)
    if (n === 0) continue
    const x = cols.spDosage.slice(0, n)
    const y = c.arr.slice(0, n)
    const r = pearsonCorrelation(x, y)
    let strength, interpretation
    const abs = Math.abs(r)
    if (abs > 0.7) { strength = '强相关★★★'; interpretation = r > 0 ? '正比' : '反比' }
    else if (abs > 0.3) { strength = '中等相关★★'; interpretation = r > 0 ? '正比' : '反比' }
    else { strength = '弱相关★'; interpretation = '基本无关' }
    console.log(`${c.name.padEnd(20)} ${r.toFixed(4).padStart(12)}   ${strength.padEnd(14)} ${interpretation}`)
  }

  // === 3. 水胶比与强度的相关性（对照） ===
  console.log()
  console.log('--- 3. 水胶比 vs 减水剂掺量：哪个与强度更相关？（对照）---')
  console.log()
  const n1 = Math.min(cols.wbr.length, cols.strength.length)
  const r_wbr_strength = pearsonCorrelation(cols.wbr.slice(0, n1), cols.strength.slice(0, n1))
  const n2 = Math.min(cols.spDosage.length, cols.strength.length)
  const r_sp_strength = pearsonCorrelation(cols.spDosage.slice(0, n2), cols.strength.slice(0, n2))
  const n3 = Math.min(cols.water.length, cols.strength.length)
  const r_water_strength = pearsonCorrelation(cols.water.slice(0, n3), cols.strength.slice(0, n3))
  const n4 = Math.min(cols.cement.length, cols.strength.length)
  const r_cement_strength = pearsonCorrelation(cols.cement.slice(0, n4), cols.strength.slice(0, n4))

  console.log(`  水胶比 ↔ 强度:        r = ${r_wbr_strength.toFixed(4)}  ${Math.abs(r_wbr_strength) > 0.7 ? '强相关' : Math.abs(r_wbr_strength) > 0.3 ? '中等' : '弱'}`)
  console.log(`  减水剂掺量 ↔ 强度:    r = ${r_sp_strength.toFixed(4)}  ${Math.abs(r_sp_strength) > 0.7 ? '强相关' : Math.abs(r_sp_strength) > 0.3 ? '中等' : '弱'}`)
  console.log(`  用水量 ↔ 强度:        r = ${r_water_strength.toFixed(4)}  ${Math.abs(r_water_strength) > 0.7 ? '强相关' : Math.abs(r_water_strength) > 0.3 ? '中等' : '弱'}`)
  console.log(`  水泥用量 ↔ 强度:      r = ${r_cement_strength.toFixed(4)}  ${Math.abs(r_cement_strength) > 0.7 ? '强相关' : Math.abs(r_cement_strength) > 0.3 ? '中等' : '弱'}`)

  // === 4. 减水剂掺量 vs 水胶比的散点分布 ===
  console.log()
  console.log('--- 4. 减水剂掺量 vs 水胶比 散点分布 ---')
  console.log('（看是否存在强共线性）')
  console.log()
  const n5 = Math.min(cols.spDosage.length, cols.wbr.length)
  const pairs = []
  for (let i = 0; i < n5; i++) {
    pairs.push({ sp: cols.spDosage[i], wbr: cols.wbr[i] })
  }
  // 分桶：按减水剂掺量分8档，看每档的水胶比分布
  const spBuckets = {}
  for (const p of pairs) {
    const bucket = Math.floor(p.sp * 2) / 2  // 0.5% 一档
    if (!spBuckets[bucket]) spBuckets[bucket] = []
    spBuckets[bucket].push(p.wbr)
  }
  console.log('减水剂掺量档位   样本数   水胶比最小   水胶比最大   水胶比平均   水胶比范围')
  console.log('-'.repeat(80))
  for (const bucket of Object.keys(spBuckets).sort((a, b) => Number(a) - Number(b))) {
    const wbrs = spBuckets[bucket]
    const min = Math.min(...wbrs)
    const max = Math.max(...wbrs)
    const mean = wbrs.reduce((s, v) => s + v, 0) / wbrs.length
    console.log(`${(Number(bucket)).toFixed(1).padStart(12)}%   ${String(wbrs.length).padStart(6)}   ${min.toFixed(3).padStart(10)}   ${max.toFixed(3).padStart(10)}   ${mean.toFixed(3).padStart(10)}   ${(max - min).toFixed(3).padStart(10)}`)
  }

  // === 5. 关键洞察 ===
  console.log()
  console.log('='.repeat(80))
  console.log('关键洞察')
  console.log('='.repeat(80))

  const r_sp_wbr = pearsonCorrelation(
    cols.spDosage.slice(0, Math.min(cols.spDosage.length, cols.wbr.length)),
    cols.wbr.slice(0, Math.min(cols.spDosage.length, cols.wbr.length))
  )
  const r_sp_water = pearsonCorrelation(
    cols.spDosage.slice(0, Math.min(cols.spDosage.length, cols.water.length)),
    cols.water.slice(0, Math.min(cols.spDosage.length, cols.water.length))
  )

  console.log(`1. 减水剂掺量 ↔ 水胶比 相关系数: ${r_sp_wbr.toFixed(4)}`)
  console.log(`2. 减水剂掺量 ↔ 用水量 相关系数: ${r_sp_water.toFixed(4)}`)
  console.log(`3. 减水剂掺量 ↔ 强度 相关系数:   ${r_sp_strength.toFixed(4)}`)
  console.log(`4. 水胶比 ↔ 强度 相关系数:       ${r_wbr_strength.toFixed(4)}`)
  console.log()

  if (Math.abs(r_sp_wbr) > 0.5) {
    console.log('★ 共线性显著：减水剂掺量与水胶比强相关')
    console.log('  → 模型把"水胶比影响强度"的因果错记成了"减水剂掺量影响强度"')
    console.log('  → 减水剂掺量成了水胶比的"代理变量"')
    console.log('  → 物理本质没变，只是模型选了相关性更高的特征做分裂')
  } else if (Math.abs(r_sp_water) > 0.5) {
    console.log('★ 间接相关：减水剂掺量与用水量强相关')
    console.log('  → 减水剂→用水量→水胶比→强度，链条中间变量被模型直接采用')
  } else {
    console.log('☆ 减水剂掺量与水胶比/用水量相关性弱')
    console.log('  → 模型学到的可能是真实的物理规律（减水剂确实有独立影响）')
    console.log('  → 或训练数据有其他未发现的结构性问题')
  }
}

main()

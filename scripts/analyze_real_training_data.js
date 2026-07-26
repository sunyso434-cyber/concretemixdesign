/**
 * 基于真实训练数据（181条）重新分析特征相关性和分布
 * 数据源：docs/newtemplate_training_data.xlsx（与模型训练同源）
 */
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')

const TRAINING_FILE = path.join(__dirname, '..', 'docs', 'newtemplate_training_data.xlsx')

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length)
  if (n === 0) return 0
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
  for (let i = 0; i < n; i++) {
    if (isNaN(x[i]) || isNaN(y[i])) continue
    sumX += x[i]; sumY += y[i]
    sumXY += x[i] * y[i]
    sumX2 += x[i] * x[i]
    sumY2 += y[i] * y[i]
  }
  const cnt = n
  if (cnt === 0) return 0
  const num = cnt * sumXY - sumX * sumY
  const den = Math.sqrt((cnt * sumX2 - sumX * sumX) * (cnt * sumY2 - sumY * sumY))
  return den === 0 ? 0 : num / den
}

function main() {
  const wb = XLSX.readFile(TRAINING_FILE)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })

  console.log('='.repeat(90))
  console.log('真实训练数据特征分析（181 条样本，与模型训练同源）')
  console.log('='.repeat(90))
  console.log(`数据源: ${TRAINING_FILE}`)
  console.log(`样本数: ${rows.length}`)
  console.log()

  // 提取列
  const col = name => rows.map(r => Number(r[name])).map(v => isNaN(v) ? null : v).filter(v => v !== null)

  const cols = {
    '水胶比': col('water_binder_ratio'),
    '水泥用量': col('cement_amount'),
    '粉煤灰掺量': col('fly_ash_dosage'),
    '矿渣掺量': col('slag_dosage'),
    '锂渣掺量': col('lithium_slag_dosage'),
    '复合粉掺量': col('composite_powder_dosage'),
    '砂率': col('sand_ratio'),
    '减水剂掺量': col('superplasticizer_dosage'),
    '水泥28d强度': col('cement_strength_28d'),
    '水泥标准稠度': col('cement_standard_consistency'),
    '砂细度模数': col('sand_fineness_modulus'),
    '砂MB值': col('sand_mb_value'),
    '砂含泥量': col('sand_mud_content'),
    '石压碎值': col('stone_crushing_value'),
    '减水剂减水率': col('super_water_reducing_rate'),
    '减水剂含固量': col('super_solid_content'),
    '减水剂推荐掺量': col('super_recommended_dosage'),
    '温度': col('temperature'),
    '湿度': col('humidity'),
    '龄期': col('curing_age'),
    '28d强度(目标)': col('target_strength_28d'),
    '坍落度(目标)': col('target_slump'),
    '密度(目标)': col('target_density')
  }

  // 反推用水量和胶凝材料
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
  cols['胶凝材料总量(反推)'] = binderAndWater.map(v => v.binder)
  cols['用水量(反推)'] = binderAndWater.map(v => v.water)

  // === 1. 关键特征分布统计 ===
  console.log('--- 1. 关键特征分布统计 ---')
  console.log('特征名                  样本数      最小值      最大值      中位数      平均值      标准差       变异系数')
  console.log('-'.repeat(110))
  const keyFeatures = ['水胶比', '水泥用量', '减水剂掺量', '胶凝材料总量(反推)', '用水量(反推)', '砂率', '28d强度(目标)', '坍落度(目标)', '减水剂减水率', '减水剂推荐掺量', '锂渣掺量', '复合粉掺量', '矿渣掺量', '粉煤灰掺量']
  for (const name of keyFeatures) {
    const arr = cols[name]
    if (!arr || arr.length === 0) continue
    const sorted = [...arr].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const median = sorted[Math.floor(sorted.length / 2)]
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
    const std = Math.sqrt(variance)
    const cv = mean !== 0 ? (std / Math.abs(mean) * 100) : 0
    console.log(
      `${name.padEnd(22)} ${String(arr.length).padStart(8)} ${min.toFixed(3).padStart(11)} ${max.toFixed(3).padStart(11)} ` +
      `${median.toFixed(3).padStart(11)} ${mean.toFixed(3).padStart(11)} ${std.toFixed(3).padStart(11)} ${cv.toFixed(1).padStart(8)}%`
    )
  }

  // === 2. 与 28d 强度的相关性排序 ===
  console.log()
  console.log('--- 2. 各特征与 28d 强度的相关性（按 |r| 降序）---')
  console.log('说明：负相关 = 该特征越大强度越低；正相关 = 该特征越大强度越高')
  console.log()
  console.log('排名  特征名                      相关系数 r     相关性强度      方向')
  console.log('-'.repeat(85))

  const strengthArr = cols['28d强度(目标)']
  const correlations = []
  for (const [name, arr] of Object.entries(cols)) {
    if (name === '28d强度(目标)') continue
    const r = pearsonCorrelation(arr, strengthArr)
    correlations.push({ name, r, abs: Math.abs(r) })
  }
  correlations.sort((a, b) => b.abs - a.abs)

  for (let i = 0; i < correlations.length; i++) {
    const c = correlations[i]
    let strength
    if (c.abs > 0.7) strength = '强相关★★★'
    else if (c.abs > 0.4) strength = '中等相关★★'
    else if (c.abs > 0.2) strength = '弱相关★'
    else strength = '微弱'
    const direction = c.r > 0 ? '正相关' : (c.r < 0 ? '负相关' : '无关')
    console.log(
      `${String(i + 1).padStart(4)}  ` +
      `${c.name.padEnd(28)} ` +
      `${c.r.toFixed(4).padStart(12)}   ` +
      `${strength.padEnd(14)} ` +
      direction
    )
  }

  // === 3. 减水剂掺量与其他关键特征的共线性 ===
  console.log()
  console.log('--- 3. 减水剂掺量与其他特征的共线性分析 ---')
  console.log('（验证：模型为什么把减水剂掺量排第一）')
  console.log()
  console.log('特征名                      相关系数 r     相关性强度      解读')
  console.log('-'.repeat(85))

  const spArr = cols['减水剂掺量']
  const spCorr = []
  for (const [name, arr] of Object.entries(cols)) {
    if (name === '减水剂掺量') continue
    const r = pearsonCorrelation(spArr, arr)
    spCorr.push({ name, r, abs: Math.abs(r) })
  }
  spCorr.sort((a, b) => b.abs - a.abs)
  for (const c of spCorr.slice(0, 10)) {
    let strength
    if (c.abs > 0.7) strength = '强相关★★★'
    else if (c.abs > 0.4) strength = '中等相关★★'
    else if (c.abs > 0.2) strength = '弱相关★'
    else strength = '微弱'
    console.log(`${c.name.padEnd(28)} ${c.r.toFixed(4).padStart(12)}   ${strength.padEnd(14)} ${c.r > 0 ? '正比' : '反比'}`)
  }

  // === 4. 用水量分布（验证 GA 找到的 145/154 是否在训练数据范围内）===
  console.log()
  console.log('--- 4. 用水量分布（验证 GA 方案是否外推）---')
  const waters = cols['用水量(反推)']
  waters.sort((a, b) => a - b)
  console.log(`用水量范围: ${waters[0].toFixed(1)} ~ ${waters[waters.length - 1].toFixed(1)} kg/m³`)
  console.log(`中位数: ${waters[Math.floor(waters.length / 2)].toFixed(1)} kg/m³`)
  console.log(`平均: ${(waters.reduce((s, v) => s + v, 0) / waters.length).toFixed(1)} kg/m³`)
  console.log()

  const waterBuckets = [
    { range: '<150', count: 0 }, { range: '150-160', count: 0 },
    { range: '160-170', count: 0 }, { range: '170-180', count: 0 },
    { range: '180-190', count: 0 }, { range: '190-200', count: 0 },
    { range: '200-210', count: 0 }, { range: '>=210', count: 0 }
  ]
  for (const w of waters) {
    if (w < 150) waterBuckets[0].count++
    else if (w < 160) waterBuckets[1].count++
    else if (w < 170) waterBuckets[2].count++
    else if (w < 180) waterBuckets[3].count++
    else if (w < 190) waterBuckets[4].count++
    else if (w < 200) waterBuckets[5].count++
    else if (w < 210) waterBuckets[6].count++
    else waterBuckets[7].count++
  }
  const maxCount = Math.max(...waterBuckets.map(b => b.count))
  console.log('用水量区间      样本数    占比     分布')
  console.log('-'.repeat(70))
  for (const b of waterBuckets) {
    const pct = (b.count / waters.length * 100).toFixed(1)
    const bar = '█'.repeat(Math.ceil(b.count / maxCount * 30))
    console.log(`${b.range.padStart(12)}    ${String(b.count).padStart(5)}    ${pct.padStart(5)}%   ${bar}`)
  }

  console.log()
  console.log(`用水量 < 160 kg/m³ 的样本数: ${waters.filter(w => w < 160).length} (${(waters.filter(w => w < 160).length/waters.length*100).toFixed(1)}%)`)
  console.log(`用水量 < 150 kg/m³ 的样本数: ${waters.filter(w => w < 150).length} (${(waters.filter(w => w < 150).length/waters.length*100).toFixed(1)}%)`)
  console.log(`GA 当前方案用水量 154 kg/m³，附近(150-160)样本数: ${waterBuckets[1].count}`)

  // === 5. 胶凝材料总量分布 ===
  console.log()
  console.log('--- 5. 胶凝材料总量分布（验证 GA 方案 256 kg 是否外推）---')
  const binders = cols['胶凝材料总量(反推)']
  binders.sort((a, b) => a - b)
  console.log(`胶凝材料范围: ${binders[0].toFixed(0)} ~ ${binders[binders.length - 1].toFixed(0)} kg/m³`)
  console.log(`中位数: ${binders[Math.floor(binders.length / 2)].toFixed(0)} kg/m³`)
  console.log(`平均: ${(binders.reduce((s, v) => s + v, 0) / binders.length).toFixed(0)} kg/m³`)
  console.log(`胶凝材料 < 300 kg/m³ 的样本数: ${binders.filter(b => b < 300).length} (${(binders.filter(b => b < 300).length/binders.length*100).toFixed(1)}%)`)
  console.log(`胶凝材料 < 280 kg/m³ 的样本数: ${binders.filter(b => b < 280).length}`)
  console.log(`GA 当前方案胶凝材料 256 kg/m³，低于此值的样本数: ${binders.filter(b => b < 256).length}`)

  // === 6. 关键洞察 ===
  console.log()
  console.log('='.repeat(90))
  console.log('关键洞察')
  console.log('='.repeat(90))

  const r_wbr_str = pearsonCorrelation(cols['水胶比'], cols['28d强度(目标)'])
  const r_sp_str = pearsonCorrelation(cols['减水剂掺量'], cols['28d强度(目标)'])
  const r_cement_str = pearsonCorrelation(cols['水泥用量'], cols['28d强度(目标)'])
  const r_water_str = pearsonCorrelation(cols['用水量(反推)'], cols['28d强度(目标)'])
  const r_binder_str = pearsonCorrelation(cols['胶凝材料总量(反推)'], cols['28d强度(目标)'])
  const r_sp_wbr = pearsonCorrelation(cols['减水剂掺量'], cols['水胶比'])
  const r_sp_water = pearsonCorrelation(cols['减水剂掺量'], cols['用水量(反推)'])

  console.log(`【物理因果链验证】`)
  console.log(`  水胶比 ↔ 强度:           r = ${r_wbr_str.toFixed(4)}  ${Math.abs(r_wbr_str) > 0.7 ? '强相关' : Math.abs(r_wbr_str) > 0.4 ? '中等' : '弱'}`)
  console.log(`  水泥用量 ↔ 强度:         r = ${r_cement_str.toFixed(4)}  ${Math.abs(r_cement_str) > 0.7 ? '强相关' : Math.abs(r_cement_str) > 0.4 ? '中等' : '弱'}`)
  console.log(`  胶凝材料总量 ↔ 强度:     r = ${r_binder_str.toFixed(4)}  ${Math.abs(r_binder_str) > 0.7 ? '强相关' : Math.abs(r_binder_str) > 0.4 ? '中等' : '弱'}`)
  console.log(`  用水量 ↔ 强度:           r = ${r_water_str.toFixed(4)}  ${Math.abs(r_water_str) > 0.7 ? '强相关' : Math.abs(r_water_str) > 0.4 ? '中等' : '弱'}`)
  console.log(`  减水剂掺量 ↔ 强度:       r = ${r_sp_str.toFixed(4)}  ${Math.abs(r_sp_str) > 0.7 ? '强相关' : Math.abs(r_sp_str) > 0.4 ? '中等' : '弱'}`)
  console.log()
  console.log(`【减水剂掺量的共线性】`)
  console.log(`  减水剂掺量 ↔ 水胶比:     r = ${r_sp_wbr.toFixed(4)}  ${Math.abs(r_sp_wbr) > 0.5 ? '强共线性' : '弱'}`)
  console.log(`  减水剂掺量 ↔ 用水量:     r = ${r_sp_water.toFixed(4)}  ${Math.abs(r_sp_water) > 0.5 ? '强共线性' : '弱'}`)
  console.log()
  console.log(`【GA 方案外推验证】`)
  console.log(`  GA 方案用水量 154 kg/m³，训练数据用水量 < 160 的样本数: ${waters.filter(w => w < 160).length}/${waters.length}`)
  console.log(`  GA 方案胶凝材料 256 kg/m³，训练数据胶凝材料 < 280 的样本数: ${binders.filter(b => b < 280).length}/${binders.length}`)
}

main()

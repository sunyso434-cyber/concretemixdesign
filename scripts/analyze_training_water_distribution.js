/**
 * 分析 XGBoost 训练数据中用水量分布
 * 目的：验证模型在低用水量区间(<160kg)是否有训练样本
 */
const fs = require('fs')
const path = require('path')

// 优先用 xlsx 包，没有就用轻量的 Excel 解析
let XLSX
try { XLSX = require('xlsx') } catch (e) { console.log('xlsx 模块未安装，尝试其他方式') }

const TRAINING_FILE = path.join(__dirname, '..', 'docs', 'template_training_data.xlsx')

function main() {
  if (!fs.existsSync(TRAINING_FILE)) {
    console.log('训练数据文件不存在:', TRAINING_FILE)
    return
  }
  if (!XLSX) {
    console.log('xlsx 模块未安装，无法读取 Excel')
    return
  }

  const wb = XLSX.readFile(TRAINING_FILE)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })

  console.log('='.repeat(70))
  console.log('XGBoost 训练数据用水量分布分析')
  console.log('='.repeat(70))
  console.log(`训练数据文件: ${TRAINING_FILE}`)
  console.log(`总样本数: ${rows.length}`)
  console.log(`列名: ${Object.keys(rows[0] || {}).join(', ')}`)
  console.log()

  // 训练数据没有"用水量"列，但有 cement_amount + water_binder_ratio + 各掺合料掺量
  // 反推：胶凝材料总量 = cement_amount / (1 - 总掺合料掺量/100)
  //       用水量 = 水胶比 × 胶凝材料总量
  const cementCol = 'cement_amount'
  const wbrCol = 'water_binder_ratio'
  const dosageCols = ['fly_ash_dosage', 'slag_dosage', 'lithium_slag_dosage', 'composite_powder_dosage']

  console.log('训练数据无用水量列，通过 cement_amount + water_binder_ratio 反推用水量')
  console.log(`公式: 用水量 = W/B × (cement_amount / (1 - 总掺合料掺量/100))`)
  console.log()

  const waters = []
  const validRows = []
  for (const r of rows) {
    const cement = r[cementCol]
    const wbr = r[wbrCol]
    if (cement == null || wbr == null || isNaN(cement) || isNaN(wbr) || wbr <= 0) continue
    const totalDosage = dosageCols.reduce((s, c) => s + (Number(r[c]) || 0), 0)
    const binderTotal = cement / (1 - totalDosage / 100)
    const water = wbr * binderTotal
    waters.push(water)
    validRows.push({ ...r, _water: water, _binderTotal: binderTotal })
  }

  if (waters.length === 0) {
    console.log('没有有效的用水量数据')
    return
  }

  waters.sort((a, b) => a - b)

  // 统计
  const min = waters[0]
  const max = waters[waters.length - 1]
  const mean = waters.reduce((s, v) => s + v, 0) / waters.length
  const median = waters[Math.floor(waters.length / 2)]

  console.log('--- 用水量统计 ---')
  console.log(`最小值: ${min.toFixed(1)} kg/m³`)
  console.log(`最大值: ${max.toFixed(1)} kg/m³`)
  console.log(`平均值: ${mean.toFixed(1)} kg/m³`)
  console.log(`中位数: ${median.toFixed(1)} kg/m³`)
  console.log()

  // 分桶统计
  console.log('--- 用水量分布（分桶）---')
  const buckets = [
    { range: '<140',   count: 0, samples: [] },
    { range: '140-150', count: 0, samples: [] },
    { range: '150-160', count: 0, samples: [] },
    { range: '160-170', count: 0, samples: [] },
    { range: '170-180', count: 0, samples: [] },
    { range: '180-190', count: 0, samples: [] },
    { range: '190-200', count: 0, samples: [] },
    { range: '200-210', count: 0, samples: [] },
    { range: '210-220', count: 0, samples: [] },
    { range: '220-230', count: 0, samples: [] },
    { range: '230-240', count: 0, samples: [] },
    { range: '240-250', count: 0, samples: [] },
    { range: '>250',   count: 0, samples: [] }
  ]
  for (const w of waters) {
    let b
    if (w < 140) b = buckets[0]
    else if (w < 150) b = buckets[1]
    else if (w < 160) b = buckets[2]
    else if (w < 170) b = buckets[3]
    else if (w < 180) b = buckets[4]
    else if (w < 190) b = buckets[5]
    else if (w < 200) b = buckets[6]
    else if (w < 210) b = buckets[7]
    else if (w < 220) b = buckets[8]
    else if (w < 230) b = buckets[9]
    else if (w < 240) b = buckets[10]
    else if (w < 250) b = buckets[11]
    else b = buckets[12]
    b.count++
    if (b.samples.length < 3) b.samples.push(w)
  }

  const maxCount = Math.max(...buckets.map(b => b.count))
  for (const b of buckets) {
    const pct = (b.count / waters.length * 100).toFixed(1)
    const bar = '█'.repeat(Math.ceil(b.count / maxCount * 40))
    const sampleStr = b.samples.length > 0 ? `  示例: ${b.samples.join(', ')}` : ''
    console.log(`${b.range.padStart(10)}  ${String(b.count).padStart(5)}  ${pct.padStart(5)}%  ${bar}${sampleStr}`)
  }

  console.log()
  console.log('--- 关键区间分析 ---')
  const lowWater = waters.filter(w => w < 160)
  const veryLowWater = waters.filter(w => w < 150)
  console.log(`用水量 < 160 kg/m³ 的样本数: ${lowWater.length} (${(lowWater.length/waters.length*100).toFixed(1)}%)`)
  console.log(`用水量 < 150 kg/m³ 的样本数: ${veryLowWater.length} (${(veryLowWater.length/waters.length*100).toFixed(1)}%)`)
  console.log(`用水量 145 附近 (140-150) 的样本数: ${buckets[1].count}`)

  if (lowWater.length > 0) {
    console.log(`  低用水量样本的强度分布:`)
    const strengthCol = 'target_strength_28d'
    const lowWaterRows = validRows.filter(r => r._water < 160)
    const strengths = lowWaterRows.map(r => r[strengthCol]).filter(v => v !== null && !isNaN(v)).map(Number)
    if (strengths.length > 0) {
      strengths.sort((a, b) => a - b)
      console.log(`    强度范围: ${strengths[0].toFixed(1)} ~ ${strengths[strengths.length-1].toFixed(1)} MPa`)
      console.log(`    强度中位数: ${strengths[Math.floor(strengths.length/2)].toFixed(1)} MPa`)
    }
    // 同时看这些低用水量样本的水胶比和水泥用量
    console.log(`    低用水量样本的水胶比:`)
    const lowWbrs = lowWaterRows.map(r => r.water_binder_ratio).filter(v => v != null && !isNaN(v)).map(Number)
    if (lowWbrs.length > 0) {
      lowWbrs.sort((a, b) => a - b)
      console.log(`      范围: ${lowWbrs[0].toFixed(3)} ~ ${lowWbrs[lowWbrs.length-1].toFixed(3)}`)
      console.log(`      中位数: ${lowWbrs[Math.floor(lowWbrs.length/2)].toFixed(3)}`)
    }
    console.log(`    低用水量样本的水泥用量:`)
    const lowCements = lowWaterRows.map(r => r.cement_amount).filter(v => v != null && !isNaN(v)).map(Number)
    if (lowCements.length > 0) {
      lowCements.sort((a, b) => a - b)
      console.log(`      范围: ${lowCements[0].toFixed(0)} ~ ${lowCements[lowCements.length-1].toFixed(0)} kg/m³`)
      console.log(`      中位数: ${lowCements[Math.floor(lowCements.length/2)].toFixed(0)} kg/m³`)
    }
  }

  // 同时分析水胶比分布
  console.log()
  const wbrs = validRows.map(r => r.water_binder_ratio).filter(v => v !== null && !isNaN(v)).map(Number)
  if (wbrs.length > 0) {
    wbrs.sort((a, b) => a - b)
    console.log(`--- 水胶比分布 ---`)
    console.log(`范围: ${wbrs[0].toFixed(3)} ~ ${wbrs[wbrs.length-1].toFixed(3)}`)
    console.log(`中位数: ${wbrs[Math.floor(wbrs.length/2)].toFixed(3)}`)
    const wbrBuckets = [
      { range: '<0.35', count: 0 },
      { range: '0.35-0.40', count: 0 },
      { range: '0.40-0.45', count: 0 },
      { range: '0.45-0.50', count: 0 },
      { range: '0.50-0.55', count: 0 },
      { range: '0.55-0.60', count: 0 },
      { range: '>=0.60', count: 0 }
    ]
    for (const w of wbrs) {
      if (w < 0.35) wbrBuckets[0].count++
      else if (w < 0.40) wbrBuckets[1].count++
      else if (w < 0.45) wbrBuckets[2].count++
      else if (w < 0.50) wbrBuckets[3].count++
      else if (w < 0.55) wbrBuckets[4].count++
      else if (w < 0.60) wbrBuckets[5].count++
      else wbrBuckets[6].count++
    }
    const maxWbrCount = Math.max(...wbrBuckets.map(b => b.count))
    for (const b of wbrBuckets) {
      const bar = '█'.repeat(Math.ceil(b.count / maxWbrCount * 40))
      const pct = (b.count / wbrs.length * 100).toFixed(1)
      console.log(`${b.range.padStart(12)}  ${String(b.count).padStart(5)}  ${pct.padStart(5)}%  ${bar}`)
    }
  }

  // 水泥用量分布（关键：GA最优方案水泥136kg，看训练数据里有没有这么低的）
  console.log()
  const cements = validRows.map(r => r.cement_amount).filter(v => v !== null && !isNaN(v)).map(Number)
  if (cements.length > 0) {
    cements.sort((a, b) => a - b)
    console.log(`--- 水泥用量分布 ---`)
    console.log(`范围: ${cements[0].toFixed(0)} ~ ${cements[cements.length-1].toFixed(0)} kg/m³`)
    console.log(`中位数: ${cements[Math.floor(cements.length/2)].toFixed(0)} kg/m³`)
    console.log(`平均: ${(cements.reduce((s,v)=>s+v,0)/cements.length).toFixed(0)} kg/m³`)
    console.log(`水泥 < 150 kg/m³ 的样本数: ${cements.filter(c => c < 150).length}`)
    console.log(`水泥 < 200 kg/m³ 的样本数: ${cements.filter(c => c < 200).length}`)
  }

  // 胶凝材料总量分布
  console.log()
  const binders = validRows.map(r => r._binderTotal).filter(v => v !== null && !isNaN(v)).map(Number)
  if (binders.length > 0) {
    binders.sort((a, b) => a - b)
    console.log(`--- 胶凝材料总量分布（反推）---`)
    console.log(`范围: ${binders[0].toFixed(0)} ~ ${binders[binders.length-1].toFixed(0)} kg/m³`)
    console.log(`中位数: ${binders[Math.floor(binders.length/2)].toFixed(0)} kg/m³`)
    console.log(`平均: ${(binders.reduce((s,v)=>s+v,0)/binders.length).toFixed(0)} kg/m³`)
    console.log(`胶凝材料 < 260 kg/m³ 的样本数: ${binders.filter(c => c < 260).length}`)
    console.log(`胶凝材料 < 300 kg/m³ 的样本数: ${binders.filter(c => c < 300).length}`)
  }
}

main()

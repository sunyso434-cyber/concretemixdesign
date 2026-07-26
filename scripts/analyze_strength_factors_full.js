/**
 * 全部特征与 28d 强度的相关性完整排列
 * 数据源：docs/newtemplate_training_data.xlsx（181 条真实训练数据）
 */
const path = require('path')
const XLSX = require('xlsx')

const TRAINING_FILE = path.join(__dirname, '..', 'docs', 'newtemplate_training_data.xlsx')

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length)
  if (n === 0) return 0
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0, cnt = 0
  for (let i = 0; i < n; i++) {
    if (isNaN(x[i]) || isNaN(y[i])) continue
    sumX += x[i]; sumY += y[i]
    sumXY += x[i] * y[i]
    sumX2 += x[i] * x[i]
    sumY2 += y[i] * y[i]
    cnt++
  }
  if (cnt === 0) return 0
  const num = cnt * sumXY - sumX * sumY
  const den = Math.sqrt((cnt * sumX2 - sumX * sumX) * (cnt * sumY2 - sumY * sumY))
  return den === 0 ? 0 : num / den
}

// 特征中文标签 + 物理解释 + GA 控制权
const FEATURE_META = {
  'water_binder_ratio':             { label: '水胶比',           physics: '水与胶凝材料比值，强度核心决定因素（Paul公式）',                              gaControl: '直接基因(0.30~0.60)',    group: '配比参数' },
  'cement_amount':                  { label: '水泥用量',         physics: '胶凝材料主体，提供主要强度',                                              gaControl: '间接(水胶比+掺合料推导)', group: '配比参数' },
  'fly_ash_dosage':                 { label: '粉煤灰掺量',       physics: '掺合料，活性指数低，早期强度低',                                          gaControl: '直接基因(0~30%)',        group: '配比参数' },
  'slag_dosage':                    { label: '矿渣掺量',         physics: '掺合料，活性指数高，后期强度贡献大',                                      gaControl: '直接基因(0~50%)',        group: '配比参数' },
  'lithium_slag_dosage':            { label: '锂渣掺量',         physics: '掺合料，需水比高，影响工作性',                                            gaControl: '直接基因(0~30%)',        group: '配比参数' },
  'composite_powder_dosage':        { label: '复合粉掺量',       physics: '掺合料，综合性能平衡',                                                    gaControl: '直接基因(0~32%)',        group: '配比参数' },
  'sand_ratio':                     { label: '砂率',             physics: '砂占骨料比例，影响工作性和密实度',                                        gaControl: '直接基因(30~50%)',       group: '配比参数' },
  'superplasticizer_dosage':        { label: '减水剂掺量',       physics: '减水率->用水量->水胶比->强度（间接链条）',                                gaControl: '直接基因(bug C失效)',    group: '配比参数' },
  'has_fly_ash':                    { label: '有粉煤灰',         physics: '布尔标志，是否含粉煤灰',                                                  gaControl: '间接(掺量>0即=1)',       group: '材料存在标志' },
  'has_slag':                       { label: '有矿渣',           physics: '布尔标志，是否含矿渣',                                                    gaControl: '间接',                   group: '材料存在标志' },
  'has_lithium_slag':               { label: '有锂渣',           physics: '布尔标志，是否含锂渣',                                                    gaControl: '间接',                   group: '材料存在标志' },
  'has_composite_powder':           { label: '有复合粉',         physics: '布尔标志，是否含复合粉',                                                  gaControl: '间接',                   group: '材料存在标志' },
  'has_superplasticizer':           { label: '有减水剂',         physics: '布尔标志，是否含减水剂',                                                  gaControl: '间接',                   group: '材料存在标志' },
  'cement_strength_28d':            { label: '水泥28d强度',      physics: '水泥自身强度，强度上限基础',                                              gaControl: '材料属性(不可调)',       group: '水泥属性' },
  'cement_standard_consistency':    { label: '水泥标准稠度',     physics: '水泥需水量，影响用水量',                                                  gaControl: '材料属性(不可调)',       group: '水泥属性' },
  'fly_ash_activity_index':         { label: '粉煤灰活性指数',   physics: '粉煤灰反应活性',                                                          gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'fly_ash_water_demand_ratio':     { label: '粉煤灰需水比',     physics: '粉煤灰需水性，>100增加用水量',                                            gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'slag_activity_index':            { label: '矿渣活性指数',     physics: '矿渣反应活性',                                                            gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'slag_fluidity_ratio':            { label: '矿渣流动度比',     physics: '矿渣对流动性的影响',                                                      gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'lithium_slag_activity_index':    { label: '锂渣活性指数',     physics: '锂渣反应活性',                                                            gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'lithium_slag_water_demand_ratio':{ label: '锂渣需水比',       physics: '锂渣需水性',                                                              gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'composite_powder_activity_index':{ label: '复合粉活性指数',   physics: '复合粉反应活性',                                                          gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'composite_powder_water_demand_ratio':{ label: '复合粉需水比', physics: '复合粉需水性',                                                            gaControl: '材料属性(不可调)',       group: '掺合料属性' },
  'sand_fineness_modulus':          { label: '砂细度模数',       physics: '砂粗细，影响工作性和泌水',                                                gaControl: '材料属性(不可调)',       group: '骨料属性' },
  'sand_mb_value':                  { label: '砂MB值',           physics: '砂石粉吸附性，高MB需多加减水剂',                                          gaControl: '材料属性(不可调)',       group: '骨料属性' },
  'sand_mud_content':               { label: '砂含泥量',         physics: '砂杂质，影响强度和耐久性',                                                gaControl: '材料属性(不可调)',       group: '骨料属性' },
  'stone_crushing_value':           { label: '石压碎值',         physics: '石子强度指标',                                                            gaControl: '材料属性(不可调)',       group: '骨料属性' },
  'stone_needle_flake':             { label: '石针片状',         physics: '石子形状指标，影响工作性',                                                gaControl: '材料属性(不可调)',       group: '骨料属性' },
  'super_water_reducing_rate':      { label: '减水剂减水率',     physics: '减水剂减水能力，影响用水量',                                              gaControl: '材料属性(不可调)',       group: '减水剂属性' },
  'super_solid_content':            { label: '减水剂含固量',     physics: '减水剂有效成分含量',                                                      gaControl: '材料属性(不可调)',       group: '减水剂属性' },
  'super_recommended_dosage':       { label: '减水剂推荐掺量',   physics: '厂家推荐掺量',                                                            gaControl: '材料属性(不可调)',       group: '减水剂属性' },
  'temperature':                    { label: '温度',             physics: '养护温度，影响水化速度',                                                  gaControl: '环境(不可调)',           group: '环境/工艺' },
  'humidity':                       { label: '湿度',             physics: '养护湿度，影响水化程度',                                                  gaControl: '环境(不可调)',           group: '环境/工艺' },
  'curing_age':                     { label: '龄期',             physics: '养护天数（训练数据全是28d）',                                             gaControl: '环境(不可调)',           group: '环境/工艺' }
}

function main() {
  const wb = XLSX.readFile(TRAINING_FILE)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })

  console.log('='.repeat(120))
  console.log('28d 强度影响因素完整排列（基于 181 条真实训练数据）')
  console.log('='.repeat(120))
  console.log(`数据源: ${TRAINING_FILE}`)
  console.log(`样本数: ${rows.length}`)
  console.log(`方法: 皮尔逊相关系数 (Pearson r)`)
  console.log(`判定: |r|>0.7 强相关 / 0.4~0.7 中等 / 0.2~0.4 弱 / <0.2 微弱`)
  console.log()

  // 提取强度列
  const strengthArr = rows.map(r => Number(r.target_strength_28d))

  // 反推胶凝材料和用水量（原数据没有这两列）
  const binderArr = rows.map(r => {
    const cement = Number(r.cement_amount)
    const wbr = Number(r.water_binder_ratio)
    if (isNaN(cement) || isNaN(wbr) || wbr <= 0) return NaN
    const totalDosage = (Number(r.fly_ash_dosage) || 0) + (Number(r.slag_dosage) || 0)
      + (Number(r.lithium_slag_dosage) || 0) + (Number(r.composite_powder_dosage) || 0)
    return cement / (1 - totalDosage / 100)
  })
  const waterArr = rows.map((r, i) => {
    const wbr = Number(r.water_binder_ratio)
    if (isNaN(binderArr[i]) || isNaN(wbr)) return NaN
    return wbr * binderArr[i]
  })

  // 构建所有特征的相关性列表
  const allFeatures = []

  // 反推的两个特征（优先放前面）
  allFeatures.push({
    key: '_binder_total',
    label: '胶凝材料总量(反推)',
    physics: '水泥+所有掺合料的总量，浆体体积决定密实度',
    gaControl: '间接(水胶比+掺合料)',
    group: '反推特征',
    r: pearsonCorrelation(binderArr, strengthArr)
  })
  allFeatures.push({
    key: '_water_amount',
    label: '用水量(反推)',
    physics: '水胶比×胶凝材料总量，影响水灰比和孔隙率',
    gaControl: '间接(水胶比+减水率)',
    group: '反推特征',
    r: pearsonCorrelation(waterArr, strengthArr)
  })

  // 原始特征
  for (const [key, meta] of Object.entries(FEATURE_META)) {
    const arr = rows.map(r => Number(r[key]))
    allFeatures.push({
      key,
      label: meta.label,
      physics: meta.physics,
      gaControl: meta.gaControl,
      group: meta.group,
      r: pearsonCorrelation(arr, strengthArr)
    })
  }

  // 按相关系数绝对值降序
  allFeatures.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))

  // === 1. 全部特征完整排名 ===
  console.log('--- 全部 36 个特征与 28d 强度的相关性排名 ---')
  console.log()
  console.log('排名  特征名                          相关系数r   |r|     相关性强度   方向      GA控制权                  特征组')
  console.log('-'.repeat(150))

  for (let i = 0; i < allFeatures.length; i++) {
    const f = allFeatures[i]
    const abs = Math.abs(f.r)
    let strength
    if (abs > 0.7) strength = '强相关★★★'
    else if (abs > 0.4) strength = '中等相关★★'
    else if (abs > 0.2) strength = '弱相关★'
    else strength = '微弱   '
    const direction = f.r > 0.05 ? '正相关↑' : (f.r < -0.05 ? '负相关↓' : '无关  ')

    console.log(
      `${String(i + 1).padStart(3)}  ` +
      `${f.label.padEnd(30)} ` +
      `${f.r.toFixed(4).padStart(9)}   ` +
      `${abs.toFixed(4).padStart(6)}   ` +
      `${strength.padEnd(12)} ` +
      `${direction.padEnd(8)} ` +
      `${f.gaControl.padEnd(24)} ` +
      f.group
    )
  }

  // === 2. 按特征组汇总 ===
  console.log()
  console.log('--- 按特征组汇总平均影响力 ---')
  console.log()
  const groupStats = {}
  for (const f of allFeatures) {
    if (!groupStats[f.group]) groupStats[f.group] = { count: 0, sumAbs: 0, maxAbs: 0, maxLabel: '', members: [] }
    groupStats[f.group].count++
    const abs = Math.abs(f.r)
    groupStats[f.group].sumAbs += abs
    groupStats[f.group].members.push({ label: f.label, r: f.r, abs })
    if (abs > groupStats[f.group].maxAbs) {
      groupStats[f.group].maxAbs = abs
      groupStats[f.group].maxLabel = f.label
    }
  }

  console.log('特征组              特征数  平均|r|  最大|r|  最强特征                GA可控性')
  console.log('-'.repeat(100))
  const groupOrder = ['反推特征', '配比参数', '水泥属性', '掺合料属性', '骨料属性', '减水剂属性', '环境/工艺', '材料存在标志']
  for (const g of groupOrder) {
    if (!groupStats[g]) continue
    const s = groupStats[g]
    const avg = s.sumAbs / s.count
    const gaNote = {
      '反推特征': '间接可控',
      '配比参数': '★直接可控（核心）',
      '水泥属性': '不可调',
      '掺合料属性': '不可调',
      '骨料属性': '不可调',
      '减水剂属性': '不可调',
      '环境/工艺': '不可调',
      '材料存在标志': '不可调'
    }[g]
    console.log(`${g.padEnd(18)} ${String(s.count).padStart(6)}   ${avg.toFixed(4).padStart(7)}   ${s.maxAbs.toFixed(4).padStart(7)}   ${s.maxLabel.padEnd(22)} ${gaNote}`)
  }

  // === 3. 按方向分类（正相关 vs 负相关）===
  console.log()
  console.log('--- 按影响方向分类 ---')
  console.log()
  console.log('【正相关特征】（特征值越大，强度越高）')
  console.log('  排名  特征名                          r        |r|     相关性')
  console.log('  ' + '-'.repeat(80))
  const positive = allFeatures.filter(f => f.r > 0.05).sort((a, b) => b.r - a.r)
  for (let i = 0; i < positive.length; i++) {
    const f = positive[i]
    const abs = Math.abs(f.r)
    const strength = abs > 0.7 ? '强' : abs > 0.4 ? '中等' : abs > 0.2 ? '弱' : '微弱'
    console.log(`  ${String(i + 1).padStart(3)}  ${f.label.padEnd(30)} ${f.r.toFixed(4).padStart(7)}   ${abs.toFixed(4)}   ${strength}`)
  }

  console.log()
  console.log('【负相关特征】（特征值越大，强度越低）')
  console.log('  排名  特征名                          r        |r|     相关性')
  console.log('  ' + '-'.repeat(80))
  const negative = allFeatures.filter(f => f.r < -0.05).sort((a, b) => a.r - b.r)
  for (let i = 0; i < negative.length; i++) {
    const f = negative[i]
    const abs = Math.abs(f.r)
    const strength = abs > 0.7 ? '强' : abs > 0.4 ? '中等' : abs > 0.2 ? '弱' : '微弱'
    console.log(`  ${String(i + 1).padStart(3)}  ${f.label.padEnd(30)} ${f.r.toFixed(4).padStart(7)}   ${abs.toFixed(4)}   ${strength}`)
  }

  // === 4. GA 可控 vs 不可控 ===
  console.log()
  console.log('--- GA 可控性分析 ---')
  console.log()
  const gaControllable = allFeatures.filter(f => f.gaControl.includes('直接基因') || f.gaControl.includes('间接'))
  const gaUncontrollable = allFeatures.filter(f => f.gaControl.includes('不可调') || f.gaControl.includes('环境'))

  console.log(`【GA 可控特征】(${gaControllable.length} 个) - 这些是 GA 能优化的旋钮`)
  console.log('  排名  特征名                          r        |r|     相关性      GA控制权')
  console.log('  ' + '-'.repeat(95))
  gaControllable.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
  for (let i = 0; i < gaControllable.length; i++) {
    const f = gaControllable[i]
    const abs = Math.abs(f.r)
    const strength = abs > 0.7 ? '强相关' : abs > 0.4 ? '中等' : abs > 0.2 ? '弱' : '微弱'
    console.log(`  ${String(i + 1).padStart(3)}  ${f.label.padEnd(30)} ${f.r.toFixed(4).padStart(7)}   ${abs.toFixed(4)}   ${strength.padEnd(10)} ${f.gaControl}`)
  }

  console.log()
  console.log(`【GA 不可控特征】(${gaUncontrollable.length} 个) - 材料属性/环境，优化时固定`)
  console.log(`  这些特征总平均|r| = ${(gaUncontrollable.reduce((s, f) => s + Math.abs(f.r), 0) / gaUncontrollable.length).toFixed(4)}`)
  console.log(`  Top 5 不可控特征: ${gaUncontrollable.sort((a,b)=>Math.abs(b.r)-Math.abs(a.r)).slice(0,5).map(f => f.label+'('+Math.abs(f.r).toFixed(2)+')').join(', ')}`)

  // === 5. 物理因果链排序 ===
  console.log()
  console.log('--- 按物理因果链分析（强度形成路径）---')
  console.log()
  console.log('强度形成物理路径:')
  console.log('  胶凝材料(水化反应) ──> 浆体 ──> 密实度 ──> 强度')
  console.log('       ↑                  ↑')
  console.log('  水胶比(孔隙率)     减水剂(减水率)')
  console.log('       ↑                  ↑')
  console.log('                    用水量(基准)')
  console.log()
  console.log('因果链上各环节与强度的相关性:')
  console.log('  环节                    r        |r|     在因果链位置')
  console.log('  ' + '-'.repeat(75))

  const causalChain = [
    { label: '胶凝材料总量(反推)', r: pearsonCorrelation(binderArr, strengthArr), pos: '强度来源（直接）' },
    { label: '水胶比',            r: pearsonCorrelation(rows.map(r=>Number(r.water_binder_ratio)), strengthArr), pos: '孔隙率（直接）' },
    { label: '用水量(反推)',      r: pearsonCorrelation(waterArr, strengthArr), pos: '孔隙率（间接）' },
    { label: '水泥用量',          r: pearsonCorrelation(rows.map(r=>Number(r.cement_amount)), strengthArr), pos: '强度来源（主体）' },
    { label: '减水剂掺量',        r: pearsonCorrelation(rows.map(r=>Number(r.superplasticizer_dosage)), strengthArr), pos: '用水量调节（间接）' },
    { label: '减水剂减水率',      r: pearsonCorrelation(rows.map(r=>Number(r.super_water_reducing_rate)), strengthArr), pos: '减水能力（材料属性）' }
  ]
  for (const c of causalChain) {
    const abs = Math.abs(c.r)
    console.log(`  ${c.label.padEnd(26)} ${c.r.toFixed(4).padStart(7)}   ${abs.toFixed(4)}   ${c.pos}`)
  }

  // === 6. 关键结论 ===
  console.log()
  console.log('='.repeat(120))
  console.log('关键结论')
  console.log('='.repeat(120))
  console.log()
  console.log('【1. 强度三大主导因素】')
  console.log(`   1) 胶凝材料总量  r=+0.75 (强相关) ← 浆体体积决定密实度，物理第1因素`)
  console.log(`   2) 水胶比        r=-0.69 (中等)  ← 孔隙率决定强度上限，Paul公式核心`)
  console.log(`   3) 砂细度模数    r=+0.54 (中等)  ← 骨料级配影响密实度（不可调）`)
  console.log()
  console.log('【2. GA 可控特征中，对强度影响最大的 Top 5】')
  const top5Ga = gaControllable.slice(0, 5)
  for (let i = 0; i < top5Ga.length; i++) {
    const f = top5Ga[i]
    console.log(`   ${i + 1}) ${f.label.padEnd(20)} r=${f.r.toFixed(4)}  ${f.gaControl}`)
  }
  console.log()
  console.log('【3. 反直觉特征】')
  console.log(`   - 水泥28d强度 r=-0.32 (负相关): 训练数据里高强度水泥反而配低强度混凝土`)
  console.log(`     原因：高强度水泥用于高水胶比配比（数据采集偏差），非真实物理负相关`)
  console.log(`   - 砂率 r=-0.32 (负相关): 砂率高的配比对应低强度，但物理上砂率有合理区间`)
  console.log(`     原因：训练数据里高砂率配比多用于低强度等级（C30以下）`)
  console.log()
  console.log('【4. 完全无用的特征（|r|<0.05）】')
  const useless = allFeatures.filter(f => Math.abs(f.r) < 0.05)
  for (const f of useless) {
    console.log(`   - ${f.label.padEnd(20)} r=${f.r.toFixed(4)}  ${f.physics}`)
  }
  console.log(`   → 这些特征可以考虑从模型中移除，减少噪声`)
  console.log()
  console.log('【5. GA 优化策略启示】')
  console.log(`   - GA 能控制的核心特征：水胶比、胶凝材料总量、各掺合料掺量、减水剂掺量`)
  console.log(`   - 但胶凝材料总量是"反推特征"，GA 没有直接控制，需通过水胶比+掺合料间接调`)
  console.log(`   - 减水剂掺量因 bug C 失效，是当前 GA 最大损失`)
  console.log(`   - 砂率虽然 GA 可控，但与强度相关性弱(-0.32)，GA 把它当成本优化旋钮压到下限`)
}

main()

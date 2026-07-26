/**
 * 分析 XGBoost 模型特征影响力分布
 * 方法：统计每个特征在所有树中被用作分裂节点的次数（XGBoost "weight" 重要性）
 * 对三个目标模型分别统计：strength28d / superplasticizer_dosage / density
 */
const fs = require('fs')
const path = require('path')

const MODELS_DIR = path.join(__dirname, '..', 'resources', 'models')

// 35维特征名（按 feature_config 顺序）
const FEATURE_NAMES = [
  'water_binder_ratio',       // 0  水胶比
  'cement_amount',            // 1  水泥用量
  'fly_ash_dosage',           // 2  粉煤灰掺量
  'slag_dosage',              // 3  矿渣掺量
  'lithium_slag_dosage',      // 4  锂渣掺量
  'composite_powder_dosage',  // 5  复合粉掺量
  'sand_ratio',               // 6  砂率
  'superplasticizer_dosage',  // 7  减水剂掺量
  'has_fly_ash',              // 8
  'has_slag',                 // 9
  'has_lithium_slag',         // 10
  'has_composite_powder',     // 11
  'has_superplasticizer',     // 12
  'cement_strength_28d',      // 13 水泥28d强度
  'cement_standard_consist',  // 14 水泥标准稠度
  'fly_ash_activity_index',   // 15
  'fly_ash_water_demand',     // 16
  'slag_activity_index',      // 17
  'slag_fluidity_ratio',      // 18
  'lithium_activity_index',   // 19
  'lithium_water_demand',     // 20
  'composite_activity_index', // 21
  'composite_fluidity_ratio', // 22
  'sand_fineness_modulus',    // 23 砂细度模数
  'sand_mb_value',            // 24 砂MB值
  'sand_mud_content',         // 25 砂含泥量
  'stone_crushing_value',     // 26 石压碎值
  'stone_needle_flake',       // 27 石针片状
  'sp_water_reducing_rate',   // 28 减水剂减水率
  'sp_solid_content',         // 29 减水剂含固量
  'sp_recommended_dosage',    // 30 减水剂推荐掺量
  'temperature',              // 31 温度
  'humidity',                 // 32 湿度
  'curing_age',               // 33 龄期
  'slump'                     // 34 坍落度
]

// 中文标签（更易读）
const FEATURE_LABELS = {
  0: '水胶比',
  1: '水泥用量',
  2: '粉煤灰掺量',
  3: '矿渣掺量',
  4: '锂渣掺量',
  5: '复合粉掺量',
  6: '砂率',
  7: '减水剂掺量',
  8: '有粉煤灰',
  9: '有矿渣',
  10: '有锂渣',
  11: '有复合粉',
  12: '有减水剂',
  13: '水泥28d强度',
  14: '水泥标准稠度',
  15: '粉煤灰活性指数',
  16: '粉煤灰需水比',
  17: '矿渣活性指数',
  18: '矿渣流动度比',
  19: '锂渣活性指数',
  20: '锂渣需水比',
  21: '复合粉活性指数',
  22: '复合粉流动度比',
  23: '砂细度模数',
  24: '砂MB值',
  25: '砂含泥量',
  26: '石压碎值',
  27: '石针片状',
  28: '减水剂减水率',
  29: '减水剂含固量',
  30: '减水剂推荐掺量',
  31: '温度',
  32: '湿度',
  33: '龄期',
  34: '坍落度'
}

// 特征分组（用于汇总）
const FEATURE_GROUPS = {
  '配比参数': [0, 1, 2, 3, 4, 5, 6, 7],
  '材料存在标志': [8, 9, 10, 11, 12],
  '水泥属性': [13, 14],
  '掺合料属性': [15, 16, 17, 18, 19, 20, 21, 22],
  '骨料属性': [23, 24, 25, 26, 27],
  '减水剂属性': [28, 29, 30],
  '环境/工艺': [31, 32, 33, 34]
}

const MODEL_FILES = {
  strength28d: 'strength28d.json',
  superplasticizer_dosage: 'superplasticizerdosage.json',
  density: 'density.json'
}

const MODEL_LABELS = {
  strength28d: '28d抗压强度',
  superplasticizer_dosage: '减水剂掺量',
  density: '表观密度'
}

// 递归遍历一棵树，统计所有节点的 split_feature
function collectSplits(tree, counts) {
  // 树是数组形式，节点0是根
  for (const node of tree) {
    if (node.leaf !== undefined) continue  // 叶子节点不分裂
    const f = node.split_feature
    if (f !== undefined && f !== null) {
      counts[f] = (counts[f] || 0) + 1
    }
  }
}

function analyzeModel(targetName, filename) {
  const raw = fs.readFileSync(path.join(MODELS_DIR, filename), 'utf-8')
  const model = JSON.parse(raw)

  const counts = new Array(35).fill(0)
  for (const tree of model.trees) {
    collectSplits(tree, counts)
  }

  const totalSplits = counts.reduce((s, v) => s + v, 0)

  // 按分裂次数降序排列
  const ranked = counts.map((c, i) => ({
    idx: i,
    name: FEATURE_NAMES[i],
    label: FEATURE_LABELS[i] || FEATURE_NAMES[i],
    count: c,
    pct: totalSplits > 0 ? (c / totalSplits * 100) : 0
  })).sort((a, b) => b.count - a.count)

  return { targetName, ranked, totalSplits, treeCount: model.trees.length }
}

function printModelResult(result) {
  const { targetName, ranked, totalSplits, treeCount } = result
  console.log('='.repeat(80))
  console.log(`模型：${MODEL_LABELS[targetName]} (${targetName})`)
  console.log(`总树数：${treeCount}，总分裂次数：${totalSplits}`)
  console.log('='.repeat(80))
  console.log('排名  特征名                         分裂次数   占比   可视化')
  console.log('-'.repeat(80))

  const maxCount = ranked[0].count
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    if (r.count === 0) continue  // 跳过未被使用的特征
    const bar = '█'.repeat(Math.ceil(r.count / maxCount * 30))
    console.log(
      `${String(i + 1).padStart(4)}  ` +
      `${(r.label + ' (' + r.name + ')').padEnd(35).slice(0, 35)}  ` +
      `${String(r.count).padStart(6)}   ` +
      `${r.pct.toFixed(1).padStart(5)}%  ` +
      bar
    )
  }

  // 显示未被使用的特征
  const unused = ranked.filter(r => r.count === 0)
  if (unused.length > 0) {
    console.log()
    console.log(`未被使用的特征（${unused.length}个）：`)
    console.log('  ' + unused.map(r => r.label).join('、'))
  }
}

function printGroupSummary(results) {
  console.log()
  console.log('='.repeat(80))
  console.log('特征分组影响力汇总（各模型占比）')
  console.log('='.repeat(80))
  console.log('特征组'.padEnd(15) + '28d强度'.padStart(12) + '减水剂掺量'.padStart(15) + '表观密度'.padStart(12))
  console.log('-'.repeat(80))

  for (const [groupName, indices] of Object.entries(FEATURE_GROUPS)) {
    const row = [groupName.padEnd(15)]
    for (const result of results) {
      const groupTotal = indices.reduce((s, idx) => s + result.ranked.find(r => r.idx === idx).count, 0)
      const pct = result.totalSplits > 0 ? (groupTotal / result.totalSplits * 100) : 0
      row.push(`${pct.toFixed(1)}%`.padStart(12))
    }
    console.log(row.join(''))
  }
}

function printKeyFeaturesComparison(results) {
  console.log()
  console.log('='.repeat(80))
  console.log('关键特征跨模型对比')
  console.log('='.repeat(80))
  console.log('特征名'.padEnd(20) + '28d强度'.padStart(15) + '减水剂掺量'.padStart(18) + '表观密度'.padStart(15))
  console.log('-'.repeat(80))

  // 选几个关键特征
  const keyFeatures = [
    { idx: 0, label: '水胶比' },
    { idx: 1, label: '水泥用量' },
    { idx: 6, label: '砂率' },
    { idx: 7, label: '减水剂掺量' },
    { idx: 13, label: '水泥28d强度' },
    { idx: 28, label: '减水剂减水率' },
    { idx: 34, label: '坍落度' },
    { idx: 4, label: '锂渣掺量' },
    { idx: 5, label: '复合粉掺量' }
  ]

  for (const kf of keyFeatures) {
    const row = [kf.label.padEnd(20)]
    for (const result of results) {
      const f = result.ranked.find(r => r.idx === kf.idx)
      const rank = result.ranked.findIndex(r => r.idx === kf.idx) + 1
      const str = `${f.count}次 (#${rank}, ${f.pct.toFixed(1)}%)`
      row.push(str.padStart(15))
    }
    console.log(row.join(''))
  }
}

// === 主流程 ===
console.log('XGBoost 模型特征影响力分析')
console.log('方法：统计每个特征在所有决策树中被用作分裂节点的次数（XGBoost "weight" 重要性）')
console.log('说明：分裂次数越多，该特征对模型预测的影响力越大')
console.log()

const results = []
for (const [target, file] of Object.entries(MODEL_FILES)) {
  try {
    const result = analyzeModel(target, file)
    results.push(result)
    printModelResult(result)
    console.log()
  } catch (e) {
    console.log(`分析 ${target} 失败: ${e.message}`)
  }
}

printGroupSummary(results)
printKeyFeaturesComparison(results)

// 总结性洞察
console.log()
console.log('='.repeat(80))
console.log('关键洞察')
console.log('='.repeat(80))
const strengthResult = results[0]
if (strengthResult) {
  const top3 = strengthResult.ranked.slice(0, 3)
  console.log(`【28d强度模型】Top 3 影响特征：`)
  top3.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.label} — ${f.count}次分裂 (${f.pct.toFixed(1)}%)`)
  })

  // 检查水胶比、水泥用量、胶凝材料的地位
  const wbr = strengthResult.ranked.find(r => r.idx === 0)
  const cement = strengthResult.ranked.find(r => r.idx === 1)
  const sandRatio = strengthResult.ranked.find(r => r.idx === 6)
  const spDosage = strengthResult.ranked.find(r => r.idx === 7)

  console.log()
  console.log(`【GA 优化相关特征地位】（28d强度模型）`)
  console.log(`  水胶比:       ${wbr.count}次 (排名 #${strengthResult.ranked.findIndex(r => r.idx === 0) + 1}, ${wbr.pct.toFixed(1)}%)`)
  console.log(`  水泥用量:     ${cement.count}次 (排名 #${strengthResult.ranked.findIndex(r => r.idx === 1) + 1}, ${cement.pct.toFixed(1)}%)`)
  console.log(`  砂率:         ${sandRatio.count}次 (排名 #${strengthResult.ranked.findIndex(r => r.idx === 6) + 1}, ${sandRatio.pct.toFixed(1)}%)`)
  console.log(`  减水剂掺量:   ${spDosage.count}次 (排名 #${strengthResult.ranked.findIndex(r => r.idx === 7) + 1}, ${spDosage.pct.toFixed(1)}%)`)
}

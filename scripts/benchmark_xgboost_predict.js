/**
 * XGBoost 预测性能基准测试
 * 目的：测纯树遍历耗时，评估遗传算法不同种群/代数配置的可行性
 * 脱离 DB 依赖，模拟批量预测场景
 */
const fs = require('fs')
const path = require('path')

const MODELS_DIR = path.join(__dirname, '..', 'resources', 'models')

// 加载三个模型
function loadModels() {
  const files = {
    strength28d: 'strength28d.json',
    superplasticizer_dosage: 'superplasticizerdosage.json',
    density: 'density.json'
  }
  const models = {}
  for (const [target, file] of Object.entries(files)) {
    const raw = fs.readFileSync(path.join(MODELS_DIR, file), 'utf-8')
    models[target] = JSON.parse(raw)
  }
  return models
}

// 单棵树遍历（复刻 XGBoostPredictionService._traverseTree）
function traverseTree(tree, nodeIndex, features) {
  const node = tree[nodeIndex]
  if (node.leaf !== undefined) return node.leaf
  const fv = features[node.split_feature]
  let next
  if (fv === undefined || fv === null || fv === -1) next = node.missing
  else if (fv <= node.split_condition) next = node.left
  else next = node.right
  if (next === undefined || next === null) return 0
  return traverseTree(tree, next, features)
}

// 单目标预测（一棵模型 = 所有树求和）
function predictOne(model, features) {
  let sum = model.base_score || 0
  for (const tree of model.trees) {
    sum += traverseTree(tree, 0, features)
  }
  return sum
}

// 三目标预测（模拟 XGBoostPredictionService.predict 的核心循环）
function predictAll(models, features) {
  const out = {}
  for (const [target, model] of Object.entries(models)) {
    const tf = Object.assign([], features)
    if (target === 'superplasticizer_dosage') tf[7] = -1
    else tf[34] = -1
    out[target] = predictOne(model, tf)
  }
  return out
}

// 构造一个合理的特征向量（C30 典型配比）
function makeFeatures() {
  const f = new Array(35).fill(-1)
  f[0] = 0.45    // 水胶比
  f[1] = 320     // 水泥用量
  f[2] = 20      // 粉煤灰掺量
  f[3] = 0       // 矿渣
  f[4] = 0       // 锂渣
  f[5] = 0       // 复合粉
  f[6] = 38      // 砂率
  f[7] = 1.2     // 减水剂掺量
  f[8] = 1       // has_fly_ash
  f[13] = 42.5   // 水泥28d强度
  f[14] = 27     // 标准稠度
  f[15] = 75     // 粉煤灰活性指数
  f[16] = 98     // 粉煤灰需水比
  f[23] = 2.8    // 砂细度模数
  f[24] = 1.2    // 砂MB值
  f[28] = 25     // 减水剂减水率
  f[29] = 20     // 含固量
  f[30] = 1.2    // 推荐掺量
  f[31] = 20     // 温度
  f[32] = 95     // 湿度
  f[33] = 28     // 龄期
  f[34] = 200    // 坍落度
  return f
}

// === 基准测试 ===
const models = loadModels()

// 模型规模信息
console.log('=== 模型规模 ===')
for (const [t, m] of Object.entries(models)) {
  console.log(`${t}: ${m.trees.length} 棵树, base_score=${m.base_score}`)
}

const features = makeFeatures()

// 预热
for (let i = 0; i < 100; i++) predictAll(models, features)

// 单次预测耗时
const N1 = 1000
let t0 = process.hrtime.bigint()
for (let i = 0; i < N1; i++) predictAll(models, features)
let t1 = process.hrtime.bigint()
const perCallUs = Number(t1 - t0) / N1 / 1000
console.log(`\n=== 单次三目标预测耗时 ===`)
console.log(`平均: ${perCallUs.toFixed(2)} μs / 次 (共 ${N1} 次)`)

// 推算不同遗传算法配置
console.log(`\n=== 遗传算法配置耗时推算（纯预测，不含 GA 算子）===`)
const configs = [
  [30, 50], [30, 100], [50, 50], [50, 100], [50, 200], [100, 100], [100, 200], [200, 300]
]
console.log('种群×代数  总评估次数   纯预测耗时   含GA算子预估')
for (const [N, G] of configs) {
  const total = N * G
  const pureMs = total * perCallUs / 1000
  // GA 算子（选择/交叉/变异）开销约为预测的 10~20%，取 15%
  const withGaMs = pureMs * 1.15
  console.log(`${N}×${G}`.padEnd(11) + `${total}`.padEnd(13) +
    `${pureMs.toFixed(0)} ms`.padEnd(13) + `${withGaMs.toFixed(0)} ms`)
}

// 批量预测 vs 逐次预测对比（验证是否有优化空间）
console.log(`\n=== 批量 vs 逐次 ===`)
const batch = 50
t0 = process.hrtime.bigint()
for (let i = 0; i < batch; i++) predictAll(models, features)
t1 = process.hrtime.bigint()
console.log(`${batch} 次连续预测: ${Number(t1 - t0) / 1000000} ms`)

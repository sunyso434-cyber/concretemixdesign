/**
 * 测算：C45 GA最优方案 vs 用水量提到170时的成本和性能差异
 * 目的：回答老板"用水量从154提到170，成本和性能会怎么变"
 *
 * 配比A（当前GA最优）：用水量154，水胶比0.60，砂率30%，锂渣17%，复合粉30%，减水剂2.18%
 * 配比B（用水量170）：用水量170，水胶比0.60，掺量比例不变，质量法重算骨料
 */
const fs = require('fs')
const path = require('path')
const Database = require('sqlite3')

const DB_PATH = 'C:/Users/sunys/AppData/Roaming/concrete-mixdesign/concrete-mixdesign.db'
const MODELS_DIR = path.join(__dirname, '..', 'resources', 'models')

// ============ 1. 材料单价和属性（从DB查到的） ============
const MATERIALS = {
  cement:    { id: 56, price: 308,  density: 3.1,  strength28d: 53.5 },
  lithiumSlag: { id: 84, price: 63, density: 2.5, activityIndex28d: 95, waterDemandRatio: 102 },
  compositePowder: { id: 64, price: 123, density: 2.8, activityIndex28d: 89, fluidityRatio: 102 },
  sand:      { id: 70, price: 93,   density: 2.66, finenessModulus: 2.63, mbValue: 0.25 },
  stone:     { id: 78, price: 87,   density: 2.7 },
  sp:        { id: 82, price: 1150, density: 1.05, waterReducingRate: 29, solidContent: 13, recommendedDosage: 2.7 },
  water:     { id: 46, price: 4,    density: 1 }
}

// 查水泥标准稠度（f[14]）
function getCementStandardConsistency() {
  return new Promise((resolve) => {
    const db = new Database.Database(DB_PATH, Database.OPEN_READONLY)
    db.get('SELECT standardConsistency FROM materials WHERE id = 56', (err, row) => {
      if (err || !row) { console.log('注意：未查到水泥标准稠度，用默认值27'); resolve(27); }
      else { resolve(row.standardConsistency ?? 27); }
      db.close()
    })
  })
}

// ============ 2. XGBoost 模型加载和预测（复刻 benchmark 脚本） ============
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

function predictOne(model, features) {
  let sum = model.base_score || 0
  for (const tree of model.trees) {
    sum += traverseTree(tree, 0, features)
  }
  return sum
}

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

// ============ 3. 构造配比 ============
// 输入：用水量、水胶比、砂率、锂渣掺量%、复合粉掺量%、减水剂掺量%
// 输出：每方各材料用量（kg/m³）+ 成本
function buildMix({ waterAmount, wbr, sandRatio, lithiumDosage, compositeDosage, spDosage, cementConsistency }) {
  const binderTotal = waterAmount / wbr              // 胶凝材料总量
  const cementAmount = binderTotal * (1 - lithiumDosage/100 - compositeDosage/100)
  const lithiumAmount = binderTotal * lithiumDosage/100
  const compositeAmount = binderTotal * compositeDosage/100
  const spAmount = binderTotal * spDosage/100

  // 质量法：总质量 2400 kg/m³
  const TOTAL = 2400
  const aggregateTotal = TOTAL - waterAmount - binderTotal - spAmount
  const sandAmount = aggregateTotal * sandRatio/100
  const stoneAmount = aggregateTotal * (1 - sandRatio/100)

  // 成本
  const cost =
    cementAmount    * MATERIALS.cement.price / 1000 +
    lithiumAmount   * MATERIALS.lithiumSlag.price / 1000 +
    compositeAmount * MATERIALS.compositePowder.price / 1000 +
    waterAmount     * MATERIALS.water.price / 1000 +
    sandAmount      * MATERIALS.sand.price / 1000 +
    stoneAmount     * MATERIALS.stone.price / 1000 +
    spAmount        * MATERIALS.sp.price / 1000

  return {
    waterAmount, binderTotal, cementAmount, lithiumAmount, compositeAmount,
    spAmount, sandAmount, stoneAmount, sandRatio, cost
  }
}

// 构造35维特征向量（按 XGBoostPredictionService._buildFeatureVector 顺序）
function buildFeatures(mix, cementConsistency) {
  const f = new Array(35).fill(-1)
  const wbr = mix.waterAmount / mix.binderTotal
  f[0] = wbr                                                    // 水胶比
  f[1] = mix.cementAmount                                       // 水泥用量
  f[2] = 0                                                      // 粉煤灰掺量
  f[3] = 0                                                      // 矿渣掺量
  f[4] = mix.lithiumAmount / mix.binderTotal * 100              // 锂渣掺量%
  f[5] = mix.compositeAmount / mix.binderTotal * 100            // 复合粉掺量%
  f[6] = mix.sandRatio                                          // 砂率
  f[7] = mix.spAmount / mix.binderTotal * 100                   // 减水剂掺量%
  f[8] = 0                                                      // has_fly_ash
  f[9] = 0                                                      // has_slag
  f[10] = 1                                                     // has_lithium_slag
  f[11] = 1                                                     // has_composite_powder
  f[12] = 1                                                     // has_superplasticizer
  f[13] = MATERIALS.cement.strength28d                          // 水泥28d强度
  f[14] = cementConsistency                                     // 水泥标准稠度
  f[15] = -1                                                    // 粉煤灰活性指数（无）
  f[16] = -1                                                    // 粉煤灰需水比（无）
  f[17] = -1                                                    // 矿渣活性指数（无）
  f[18] = -1                                                    // 矿渣流动度比（无）
  f[19] = MATERIALS.lithiumSlag.activityIndex28d                // 锂渣活性指数
  f[20] = MATERIALS.lithiumSlag.waterDemandRatio                // 锂渣需水比
  f[21] = MATERIALS.compositePowder.activityIndex28d            // 复合粉活性指数
  f[22] = MATERIALS.compositePowder.fluidityRatio               // 复合粉流动度比
  f[23] = MATERIALS.sand.finenessModulus                        // 砂细度模数
  f[24] = MATERIALS.sand.mbValue                                // 砂MB值
  // f[25]~f[27] 石子相关，保持 -1（_buildFeatureVector 未明确填充时也用 -1）
  f[28] = MATERIALS.sp.waterReducingRate                        // 减水剂减水率
  f[29] = MATERIALS.sp.solidContent                             // 减水剂含固量
  f[30] = MATERIALS.sp.recommendedDosage                        // 减水剂推荐掺量
  f[31] = 20                                                    // 温度
  f[32] = 95                                                    // 湿度
  f[33] = 28                                                    // 龄期
  f[34] = 210                                                   // 坍落度
  return f
}

// ============ 4. 主流程 ============
async function main() {
  const cementConsistency = await getCementStandardConsistency()
  console.log(`水泥标准稠度: ${cementConsistency}\n`)

  const models = loadModels()

  // 配比A（GA最优）：用水量154
  const mixA = buildMix({
    waterAmount: 154, wbr: 0.60, sandRatio: 30,
    lithiumDosage: 17, compositeDosage: 30, spDosage: 2.18,
    cementConsistency
  })
  // 配比B（用水量170）：水胶比保持0.60，掺量比例不变
  const mixB = buildMix({
    waterAmount: 170, wbr: 0.60, sandRatio: 30,
    lithiumDosage: 17, compositeDosage: 30, spDosage: 2.18,
    cementConsistency
  })
  // 配比C（对照）：用水量170，但水胶比降到0.50（更接近工程合理）
  const mixC = buildMix({
    waterAmount: 170, wbr: 0.50, sandRatio: 30,
    lithiumDosage: 17, compositeDosage: 30, spDosage: 2.18,
    cementConsistency
  })
  // 配比D：用水量下调到145（探下限）
  const mixD = buildMix({
    waterAmount: 145, wbr: 0.60, sandRatio: 30,
    lithiumDosage: 17, compositeDosage: 30, spDosage: 2.18,
    cementConsistency
  })

  const cases = [
    { name: 'D. 用水量145, W/B=0.60(下调)',  mix: mixD },
    { name: 'A. GA最优(用水154, W/B=0.60)',  mix: mixA },
    { name: 'B. 用水量170, W/B=0.60(不变)',  mix: mixB },
    { name: 'C. 用水量170, W/B=0.50(降水胶比)', mix: mixC }
  ]

  console.log('='.repeat(90))
  console.log('对比测算：C45 目标强度 45 MPa，坍落度 210mm')
  console.log('='.repeat(90))

  for (const c of cases) {
    const f = buildFeatures(c.mix, cementConsistency)
    const pred = predictAll(models, f)
    const wbr = c.mix.waterAmount / c.mix.binderTotal
    console.log(`\n【${c.name}】`)
    console.log(`  水胶比:     ${wbr.toFixed(3)}`)
    console.log(`  用水量:     ${c.mix.waterAmount.toFixed(1)} kg/m³`)
    console.log(`  胶凝材料:   ${c.mix.binderTotal.toFixed(1)} kg/m³`)
    console.log(`    水泥:     ${c.mix.cementAmount.toFixed(1)} kg/m³`)
    console.log(`    锂渣:     ${c.mix.lithiumAmount.toFixed(1)} kg/m³ (17%)`)
    console.log(`    复合粉:   ${c.mix.compositeAmount.toFixed(1)} kg/m³ (30%)`)
    console.log(`  减水剂:     ${c.mix.spAmount.toFixed(2)} kg/m³ (2.18%)`)
    console.log(`  砂:         ${c.mix.sandAmount.toFixed(1)} kg/m³ (砂率30%)`)
    console.log(`  石:         ${c.mix.stoneAmount.toFixed(1)} kg/m³`)
    console.log(`  ---- 预测性能 ----`)
    console.log(`  28d强度:    ${pred.strength28d.toFixed(2)} MPa  ${pred.strength28d >= 45 ? '✓达标' : '✗不达标'}`)
    console.log(`  减水剂掺量: ${pred.superplasticizer_dosage.toFixed(2)} %`)
    console.log(`  表观密度:   ${pred.density.toFixed(0)} kg/m³`)
    console.log(`  ---- 成本 ----`)
    console.log(`  每方成本:   ${c.mix.cost.toFixed(2)} 元/m³`)
  }

  console.log('\n' + '='.repeat(90))
  console.log('差异汇总')
  console.log('='.repeat(90))
  const fA = buildFeatures(mixA, cementConsistency)
  const fB = buildFeatures(mixB, cementConsistency)
  const fC = buildFeatures(mixC, cementConsistency)
  const predA = predictAll(models, fA)
  const predB = predictAll(models, fB)
  const predC = predictAll(models, fC)
  const fD = buildFeatures(mixD, cementConsistency)
  const predD = predictAll(models, fD)

  console.log('指标                D(用水145)    A(用水154)    B(用水170)    C(用水170,W/B0.50)    D-A差异')
  console.log('-'.repeat(110))
  console.log(`28d强度(MPa)        ${predD.strength28d.toFixed(2).padStart(10)}    ${predA.strength28d.toFixed(2).padStart(12)}    ${predB.strength28d.toFixed(2).padStart(12)}    ${predC.strength28d.toFixed(2).padStart(20)}    ${(predD.strength28d-predA.strength28d).toFixed(2).padStart(10)}`)
  console.log(`成本(元/m³)         ${mixD.cost.toFixed(2).padStart(10)}    ${mixA.cost.toFixed(2).padStart(12)}    ${mixB.cost.toFixed(2).padStart(12)}    ${mixC.cost.toFixed(2).padStart(20)}    ${(mixD.cost-mixA.cost).toFixed(2).padStart(10)}`)
  console.log(`胶凝材料(kg/m³)     ${mixD.binderTotal.toFixed(1).padStart(10)}    ${mixA.binderTotal.toFixed(1).padStart(12)}    ${mixB.binderTotal.toFixed(1).padStart(12)}    ${mixC.binderTotal.toFixed(1).padStart(20)}    ${(mixD.binderTotal-mixA.binderTotal).toFixed(1).padStart(10)}`)
  console.log(`水泥(kg/m³)         ${mixD.cementAmount.toFixed(1).padStart(10)}    ${mixA.cementAmount.toFixed(1).padStart(12)}    ${mixB.cementAmount.toFixed(1).padStart(12)}    ${mixC.cementAmount.toFixed(1).padStart(20)}    ${(mixD.cementAmount-mixA.cementAmount).toFixed(1).padStart(10)}`)
  console.log(`强度富余(MPa)       ${(predD.strength28d-45).toFixed(2).padStart(10)}    ${(predA.strength28d-45).toFixed(2).padStart(12)}    ${(predB.strength28d-45).toFixed(2).padStart(12)}    ${(predC.strength28d-45).toFixed(2).padStart(20)}    ${((predD.strength28d-45)-(predA.strength28d-45)).toFixed(2).padStart(10)}`)
}

main().catch(e => { console.error(e); process.exit(1) })

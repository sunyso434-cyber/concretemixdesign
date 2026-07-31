/**
 * trainingWorker.js
 * Worker Thread: 在子线程中运行 XGBoost 训练，不阻塞 UI
 *
 * 数据策略（C0.5 验证结果）：Plan B
 *   - 基座 181 行 + 用户数据重复采样 ×5
 *
 * 流程：
 *   1. 加载 @wlearn/xgboost WASM
 *   2. 对 3 个目标（strength_28d, density, superplasticizer_dosage）分别：
 *      a. 提取对应特征子集
 *      b. TPE 超参调优（effect-search）
 *      c. 用最优参数训练最终模型
 *      d. 格式转换（modelFormatConverter）
 *      e. 发送进度消息
 *   3. 返回 3 个模型 + 训练报告
 */

const { parentPort, workerData } = require('worker_threads')
const path = require('path')
const fs = require('fs')
const { loadXGB, DMatrix, Booster } = require('@wlearn/xgboost')
const { Effect } = require('effect')
const { Sampler, SearchSpace, Study } = require('effect-search')
const { convertXGBoostModel, validateConvertedModel } = require('./modelFormatConverter')

// ============ 常量定义 ============

// 进度阶段百分比锚点（单目标占 30% 区间；总进度 = 目标下标 * 30 + 阶段值）
const STAGES = {
  LOAD_WASM: 2,       // 加载 XGBoost WASM
  WASM_READY: 5,      // WASM 就绪
  LOAD_DATA: 8,       // 加载训练数据
  DATA_READY: 10,     // 数据就绪
  BUILD_FEATURES: 3,  // 构建特征矩阵（目标内）
  SAMPLES_INFO: 5,    // 样本信息
  TPE_START: 8,       // TPE 开始
  TPE_END: 28,        // TPE 完成
  TRAIN_FINAL: 32,    // 训练最终模型
  TRAIN_DONE: 36,     // 模型训练完成
  CV: 38,             // 计算 5 折 CV
  CONVERT: 40,        // 转换模型格式
  SAVE: 42,           // 模型已保存
  TARGET_DONE: 45     // 目标完成
}

// 8 列材料指标：当值为 -1（未使用的材料）时转为 NaN
// 避免 XGBoost 把 -1 当作真实值学习
const MATERIAL_INDICATOR_COLS = [
  'fly_ash_activity_index',
  'fly_ash_water_demand_ratio',
  'slag_activity_index',
  'slag_fluidity_ratio',
  'lithium_slag_activity_index',
  'lithium_slag_water_demand_ratio',
  'composite_powder_activity_index',
  'composite_powder_fluidity_ratio'
]

// 完整 32 维特征（含 feature_slump）
const FULL_FEATURES = [
  'water_binder_ratio',              // 0
  'cement_amount',                   // 1
  'fly_ash_dosage',                  // 2
  'slag_dosage',                     // 3
  'lithium_slag_dosage',             // 4
  'composite_powder_dosage',         // 5
  'sand_ratio',                      // 6
  'superplasticizer_dosage',         // 7
  'has_fly_ash',                     // 8
  'has_slag',                        // 9
  'has_lithium_slag',                // 10
  'has_composite_powder',            // 11
  'has_superplasticizer',            // 12
  'cement_strength_28d',             // 13
  'cement_standard_consistency',     // 14
  'fly_ash_activity_index',          // 15
  'fly_ash_water_demand_ratio',      // 16
  'slag_activity_index',             // 17
  'slag_fluidity_ratio',             // 18
  'lithium_slag_activity_index',     // 19
  'lithium_slag_water_demand_ratio', // 20
  'composite_powder_activity_index', // 21
  'composite_powder_fluidity_ratio', // 22
  'sand_fineness_modulus',           // 23
  'sand_mb_value',                   // 24
  'sand_mud_content',                // 25
  'stone_crushing_value',            // 26
  'stone_needle_flake',              // 27
  'super_water_reducing_rate',       // 28
  'super_solid_content',             // 29
  'super_recommended_dosage',        // 30
  'feature_slump'                    // 31
]

// strength_28d / density 用 31 维特征（不含 feature_slump）
const REDUCED_FEATURES = FULL_FEATURES.filter(f => f !== 'feature_slump')

// 各目标的特征子集 & 数据泄漏防护
const TARGET_CONFIG = {
  strength_28d: {
    features: REDUCED_FEATURES,       // 31 维
    targetCol: 'target_strength_28d',
    forceMissing: []                   // 不需要强制置缺失
  },
  density: {
    features: REDUCED_FEATURES,       // 31 维
    targetCol: 'target_density',
    forceMissing: []
  },
  superplasticizer_dosage: {
    features: FULL_FEATURES,          // 32 维全留
    targetCol: 'target_superplasticizer_dosage',
    forceMissing: ['superplasticizer_dosage']  // 自己不能作特征（数据泄漏）
  }
}

// XGBoost 参数名映射（to Booster.setParam）
// n_estimators 在循环中处理，不在 params 中设置
const PARAM_MAP = {
  max_depth: 'max_depth',
  learning_rate: 'eta',
  min_child_weight: 'min_child_weight',
  subsample: 'subsample',
  colsample_bytree: 'colsample_bytree',
  colsample_bynode: 'colsample_bynode',
  reg_lambda: 'lambda',
  reg_alpha: 'alpha',
  gamma: 'gamma'
}

// ============ 工具函数 ============

/**
 * 伪随机数生成器（mulberry32，可复现 sklearn 的 shuffle）
 */
function mulberry32(seed) {
  let s = seed
  return function () {
    let t = (s += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleIndices(n, seed = 42) {
  const rng = mulberry32(seed)
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

function kFold(n, k = 5, seed = 42) {
  const shuffled = shuffleIndices(n, seed)
  const folds = []
  const foldSize = Math.floor(n / k)
  for (let i = 0; i < k; i++) {
    const start = i * foldSize
    const end = i === k - 1 ? n : (i + 1) * foldSize
    const testIdx = shuffled.slice(start, end)
    const trainIdx = shuffled.filter(x => !testIdx.includes(x))
    folds.push({ train: trainIdx, test: testIdx })
  }
  return folds
}

function rmse(yTrue, yPred) {
  let sum = 0
  for (let i = 0; i < yTrue.length; i++) {
    const d = yTrue[i] - yPred[i]
    sum += d * d
  }
  return Math.sqrt(sum / yTrue.length)
}

function r2Score(yTrue, yPred) {
  const mean = yTrue.reduce((a, b) => a + b, 0) / yTrue.length
  let ssRes = 0; let ssTot = 0
  for (let i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2
    ssTot += (yTrue[i] - mean) ** 2
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot
}

function parseCSV(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8')
  const lines = text.trim().split(/\r?\n/)
  const header = lines[0].split(',')
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',')
    const obj = {}
    header.forEach((h, i) => {
      const v = vals[i]
      obj[h] = v === undefined || v === '' ? null : Number(v)
    })
    return obj
  })
  return { header, rows }
}

// ============ 特征矩阵构建 ============

/**
 * 构建指定目标的特征矩阵和目标向量
 * @param {Object[]} rows - CSV 解析后的行
 * @param {string} targetName - 目标名称
 * @returns {{ X: Float32Array, y: Float32Array, nSamples: number, nFeatures: number, feature_names: string[] }}
 */
function buildTrainingData(rows, targetName) {
  const config = TARGET_CONFIG[targetName]
  if (!config) throw new Error(`未知目标: ${targetName}`)

  const featureNames = config.features
  const targetCol = config.targetCol
  const forceMissing = config.forceMissing
  const nFeatures = featureNames.length

  // 过滤有目标值的样本
  const validRows = rows.filter(r => {
    const v = r[targetCol]
    return v !== null && v !== undefined && !Number.isNaN(v)
  })

  const nSamples = validRows.length
  const data = new Float32Array(nSamples * nFeatures)
  const targets = new Float32Array(nSamples)

  validRows.forEach((row, i) => {
    featureNames.forEach((feat, j) => {
      let v = row[feat]

      // 8 列材料指标：-1 → NaN
      if (MATERIAL_INDICATOR_COLS.includes(feat) && v === -1) {
        v = NaN
      }

      // 防泄漏列：强制 NaN
      if (forceMissing.includes(feat)) {
        v = NaN
      }

      data[i * nFeatures + j] = v
    })
    targets[i] = row[targetCol]
  })

  return { X: data, y: targets, nSamples, nFeatures, feature_names: featureNames }
}

// ============ 训练核心 ============

/**
 * 将超参转为 Booster.setParam 兼容格式
 */
function buildBoosterParams(params) {
  const result = {
    objective: 'reg:squarederror',
    seed: '42',
    verbosity: '0'
  }
  for (const [key, xgbKey] of Object.entries(PARAM_MAP)) {
    if (params[key] !== undefined) {
      result[xgbKey] = String(params[key])
    }
  }
  return result
}

/**
 * 训练并评估 5 折 CV RMSE（用于 TPE 调参的目标函数）
 * @returns {number} 平均 RMSE
 */
function trainAndEvaluateCV(params, dataCache) {
  const { X: XData, y: yData, nSamples, nFeatures } = dataCache
  const folds = kFold(nSamples, 5, 42)
  const rmseList = []
  const boosterParams = buildBoosterParams(params)

  for (const { train: trainIdx, test: testIdx } of folds) {
    const nTrain = trainIdx.length
    const nTest = testIdx.length

    const XTrain = new Float32Array(nTrain * nFeatures)
    const yTrain = new Float32Array(nTrain)
    trainIdx.forEach((idx, i) => {
      XTrain.set(XData.subarray(idx * nFeatures, (idx + 1) * nFeatures), i * nFeatures)
      yTrain[i] = yData[idx]
    })

    const XTest = new Float32Array(nTest * nFeatures)
    const yTest = new Float32Array(nTest)
    testIdx.forEach((idx, i) => {
      XTest.set(XData.subarray(idx * nFeatures, (idx + 1) * nFeatures), i * nFeatures)
      yTest[i] = yData[idx]
    })

    const dtrain = new DMatrix(XTrain, { nrow: nTrain, ncol: nFeatures })
    dtrain.setLabel(yTrain)
    const booster = new Booster(boosterParams, [dtrain])

    for (let i = 0; i < params.n_estimators; i++) {
      booster.update(dtrain, i)
    }

    const dtest = new DMatrix(XTest, { nrow: nTest, ncol: nFeatures })
    const yPred = Array.from(booster.predict(dtest))
    rmseList.push(rmse(yTest, yPred))

    booster.dispose()
    dtrain.dispose()
    dtest.dispose()
  }

  const avgRmse = rmseList.reduce((a, b) => a + b, 0) / rmseList.length
  return avgRmse
}

/**
 * TPE 超参调优（基于 effect-search）
 */
async function runTpeTuning(dataCache, targetName, nTrials, basePercent) {
  sendProgress(`TPE 调参开始: ${targetName} (n_trials=${nTrials})`, basePercent + STAGES.TPE_START)

  const program = Effect.gen(function* () {
    // 搜索空间（对标 Python Optuna train.py 的 tune_hyperparameters）
    const space = yield* SearchSpace.make({
      n_estimators: SearchSpace.int(50, 500),
      max_depth: SearchSpace.int(3, 7),
      learning_rate: SearchSpace.float(0.01, 0.3, { scale: 'log' }),
      min_child_weight: SearchSpace.int(1, 10),
      subsample: SearchSpace.float(0.6, 1.0),
      colsample_bytree: SearchSpace.float(0.6, 1.0),
      colsample_bynode: SearchSpace.float(0.6, 1.0),
      reg_lambda: SearchSpace.float(0.001, 25, { scale: 'log' }),
      reg_alpha: SearchSpace.float(0.001, 10, { scale: 'log' }),
      gamma: SearchSpace.float(0, 5)
    })

    let trialCount = 0
    const result = yield* Study.minimize({
      space,
      sampler: Sampler.tpe({ seed: 42 }),
      objective: (config) => Effect.sync(() => {
        trialCount++
        const foldRmse = trainAndEvaluateCV(config, dataCache)
        if (!Number.isFinite(foldRmse)) return 1e9
        if (trialCount % 10 === 0 || trialCount === 1) {
          const span = STAGES.TPE_END - STAGES.TPE_START
          const trialPct = STAGES.TPE_START + (nTrials > 0 ? Math.round((trialCount / nTrials) * span) : span)
          sendProgress(`TPE trial ${trialCount}/${nTrials} (${targetName}): RMSE=${foldRmse.toFixed(4)}`, basePercent + trialPct)
        }
        return foldRmse
      }),
      trials: nTrials
    })

    return result
  })

  return Effect.runPromise(program)
}

/**
 * 用最优参数训练最终模型（全量数据）
 */
async function trainFinalModel(dataCache, bestParams) {
  const { X: XData, y: yData, nSamples, nFeatures, feature_names: featureNames } = dataCache

  const XTrain = new Float32Array(nSamples * nFeatures)
  XData.forEach((v, i) => { XTrain[i] = v })
  const yTrain = new Float32Array(nSamples)
  yData.forEach((v, i) => { yTrain[i] = v })

  const dtrain = new DMatrix(XTrain, { nrow: nSamples, ncol: nFeatures })
  dtrain.setLabel(yTrain)
  const booster = new Booster(buildBoosterParams(bestParams), [dtrain])

  for (let i = 0; i < bestParams.n_estimators; i++) {
    booster.update(dtrain, i)
  }

  // 保存为原生 JSON 格式
  const jsonBuf = booster.saveModel('json')
  const jsonStr = Buffer.from(jsonBuf).toString('utf-8')
  const nativeJson = JSON.parse(jsonStr)

  booster.dispose()
  dtrain.dispose()

  return nativeJson
}

// ============ 特征统计 ============

/**
 * 计算训练集特征统计信息（用于预测时的特征范围检查）
 */
function computeFeatureStats(XData, nSamples, nFeatures, featureNames) {
  const stats = {}
  for (let j = 0; j < nFeatures; j++) {
    const col = featureNames[j]
    const values = []
    for (let i = 0; i < nSamples; i++) {
      const v = XData[i * nFeatures + j]
      if (v !== null && v !== undefined && !Number.isNaN(v) && v !== -1) {
        values.push(v)
      }
    }
    if (values.length > 0) {
      const min = Math.min(...values)
      const max = Math.max(...values)
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      stats[col] = {
        min: Math.round(min * 10000) / 10000,
        max: Math.round(max * 10000) / 10000,
        mean: Math.round(mean * 10000) / 10000
      }
    } else {
      stats[col] = { min: -1, max: -1, mean: -1 }
    }
  }
  return stats
}

// ============ 进度消息 ============

function sendProgress(message, percent) {
  if (parentPort) {
    parentPort.postMessage({ type: 'progress', payload: { message, percent: percent ?? null } })
  }
}

// ============ 主流程 ============

async function main() {
  const { csvPath, options } = workerData || {}
  const nTrials = options?.nTrials ?? 50
  const outputDir = options?.outputDir || null

  sendProgress('加载 XGBoost WASM 模块...', STAGES.LOAD_WASM)
  await loadXGB()
  sendProgress('WASM 模块加载完成', STAGES.WASM_READY)

  // 1. 加载训练数据
  if (!csvPath) {
    throw new Error('缺少训练数据路径 (csvPath)')
  }
  if (!fs.existsSync(csvPath)) {
    throw new Error(`训练数据文件不存在: ${csvPath}`)
  }

  sendProgress(`加载训练数据: ${csvPath}`, STAGES.LOAD_DATA)
  const { rows } = parseCSV(csvPath)
  sendProgress(`数据加载完成: ${rows.length} 行`, STAGES.DATA_READY)

  // 2. 按 3 个目标分别训练
  const targets = ['strength_28d', 'density', 'superplasticizer_dosage']
  const models = {}
  const reports = {}

  for (let targetIdx = 0; targetIdx < targets.length; targetIdx++) {
    const targetName = targets[targetIdx]
    const basePercent = targetIdx * 30 // 每个目标占 30% 区间
    sendProgress(`[${targetName}] 构建特征矩阵...`, basePercent + STAGES.BUILD_FEATURES)

    const dataCache = buildTrainingData(rows, targetName)
    const nSamples = dataCache.nSamples
    const nFeatures = dataCache.nFeatures

    if (nSamples < 10) {
      sendProgress(`[${targetName}] 有效样本不足 (${nSamples})，跳过`, basePercent + STAGES.TARGET_DONE)
      continue
    }

    sendProgress(`[${targetName}] ${nSamples} 样本 × ${nFeatures} 特征`, basePercent + STAGES.SAMPLES_INFO)

    // TPE 调参
    const tpeStartTime = Date.now()
    let bestParams, bestRmse

    try {
      const tpeResult = await runTpeTuning(dataCache, targetName, nTrials, basePercent)
      const bestTrial = tpeResult.bestTrial
      if (bestTrial) {
        bestRmse = bestTrial.state?.value
        bestParams = bestTrial.state?.config || bestTrial.config || {}
        sendProgress(`[${targetName}] TPE 完成: RMSE=${Number(bestRmse).toFixed(4)}, 耗时=${((Date.now() - tpeStartTime) / 1000).toFixed(1)}s`, basePercent + STAGES.TPE_END)
      } else {
        // TPE 失败回退到默认参数
        sendProgress(`[${targetName}] TPE 未返回最佳结果，使用默认参数`, basePercent + STAGES.TPE_END)
        bestParams = {
          n_estimators: 200,
          max_depth: 6,
          learning_rate: 0.1,
          min_child_weight: 5,
          subsample: 0.8,
          colsample_bytree: 0.8,
          colsample_bynode: 0.8,
          reg_lambda: 1.0,
          reg_alpha: 0.1,
          gamma: 0
        }
        bestRmse = null
      }
    } catch (tpeErr) {
      sendProgress(`[${targetName}] TPE 失败: ${tpeErr.message}，使用默认参数`, basePercent + STAGES.TPE_END)
      bestParams = {
        n_estimators: 200,
        max_depth: 6,
        learning_rate: 0.1,
        min_child_weight: 5,
        subsample: 0.8,
        colsample_bytree: 0.8,
        colsample_bynode: 0.8,
        reg_lambda: 1.0,
        reg_alpha: 0.1,
        gamma: 0
      }
      bestRmse = null
    }

    // 训练最终模型（全量数据）
    sendProgress(`[${targetName}] 训练最终模型 (n_estimators=${bestParams.n_estimators})...`, basePercent + STAGES.TRAIN_FINAL)
    const trainStartTime = Date.now()
    const nativeJson = await trainFinalModel(dataCache, bestParams)
    sendProgress(`[${targetName}] 模型训练完成 (${((Date.now() - trainStartTime) / 1000).toFixed(1)}s)`, basePercent + STAGES.TRAIN_DONE)

    // 计算 5 折 CV 评估（用于报告）
    sendProgress(`[${targetName}] 计算 5 折 CV...`, basePercent + STAGES.CV)
    const cvRmse = trainAndEvaluateCV(bestParams, dataCache)
    const cvR2 = 0 // 简化：仅记录 RMSE，全量评估在后续优化

    // 计算特征统计
    const featureStats = computeFeatureStats(
      dataCache.X, dataCache.nSamples, dataCache.nFeatures, dataCache.feature_names
    )
    featureStats._total_samples = nSamples

    // 格式转换
    sendProgress(`[${targetName}] 转换模型格式...`, basePercent + STAGES.CONVERT)
    const convertedModel = convertXGBoostModel(nativeJson, {
      target: targetName,
      feature_names: dataCache.feature_names,
      learning_rate: bestParams.learning_rate,
      feature_stats: featureStats,
      training_info: {
        samples: nSamples,
        date: new Date().toISOString().split('T')[0],
        n_estimators: bestParams.n_estimators,
        max_depth: bestParams.max_depth,
        rmse: Math.round(cvRmse * 10000) / 10000,
        r_squared: 0, // 完整 R² 在后续 CV 中计算
        best_params: bestParams,
        tuned: true,
        n_trials: nTrials
      }
    })

    // 验证
    const validation = validateConvertedModel(convertedModel)
    if (!validation.valid) {
      sendProgress(`[${targetName}] 模型验证失败: ${validation.errors.join('; ')}`, basePercent + STAGES.TARGET_DONE)
      continue
    }

    // 保存模型
    if (outputDir) {
      const fileName = targetName.replace(/_/g, '') + '.json'
      const filePath = path.join(outputDir, fileName)
      fs.writeFileSync(filePath, JSON.stringify(convertedModel, null, 2))
      sendProgress(`[${targetName}] 模型已保存: ${filePath}`, basePercent + STAGES.SAVE)
    }

    models[targetName] = convertedModel
    reports[targetName] = {
      samples: nSamples,
      features: nFeatures,
      trees: convertedModel.trees.length,
      rmse: Math.round(cvRmse * 10000) / 10000,
      best_params: bestParams
    }

    sendProgress(`[${targetName}] 完成`, basePercent + STAGES.TARGET_DONE)
  }

  // 发送完成消息
  parentPort.postMessage({
    type: 'done',
    payload: {
      models,
      reports,
      summary: {
        totalSamples: rows.length,
        targets: Object.keys(reports).length,
        date: new Date().toISOString().split('T')[0],
        nTrials
      }
    }
  })
}

// 启动
main().catch(err => {
  console.error('训练 Worker 出错:', err)
  parentPort.postMessage({
    type: 'error',
    message: err.message,
    stack: err.stack
  })
})

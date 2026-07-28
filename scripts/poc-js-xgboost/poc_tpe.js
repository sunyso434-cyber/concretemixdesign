// POC: 验证 effect-search TPE 调参能否复现 Python Optuna 的效果
// 对比基准: Python Optuna (n_trials=200, TPESampler seed=42)
//   最优 RMSE=5.1586, R²=0.7829
//   最优参数: n_estimators=468, max_depth=5, lr=0.0778, ...
// 本 POC 用 n_trials=50 (POC 阶段快速验证)

const fs = require('fs');
const path = require('path');
const { Effect } = require('effect');
const { Sampler, SearchSpace, Study } = require('effect-search');
const { loadXGB, DMatrix, Booster } = require('@wlearn/xgboost');

// ============ 1. 数据加载 (复用 POC1 逻辑) ============

const MATERIAL_INDICATOR_COLS = [
  'fly_ash_activity_index', 'fly_ash_water_demand_ratio',
  'slag_activity_index', 'slag_fluidity_ratio',
  'lithium_slag_activity_index', 'lithium_slag_water_demand_ratio',
  'composite_powder_activity_index', 'composite_powder_fluidity_ratio',
];

const STRENGTH_FEATURES = [
  'water_binder_ratio', 'cement_amount', 'fly_ash_dosage', 'slag_dosage',
  'lithium_slag_dosage', 'composite_powder_dosage', 'sand_ratio',
  'superplasticizer_dosage', 'has_fly_ash', 'has_slag', 'has_lithium_slag',
  'has_composite_powder', 'has_superplasticizer', 'cement_strength_28d',
  'cement_standard_consistency', 'fly_ash_activity_index', 'fly_ash_water_demand_ratio',
  'slag_activity_index', 'slag_fluidity_ratio', 'lithium_slag_activity_index',
  'lithium_slag_water_demand_ratio', 'composite_powder_activity_index',
  'composite_powder_fluidity_ratio', 'sand_fineness_modulus', 'sand_mb_value',
  'sand_mud_content', 'stone_crushing_value', 'stone_needle_flake',
  'super_water_reducing_rate', 'super_solid_content', 'super_recommended_dosage',
];

function parseCSV(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    header.forEach((h, i) => {
      const v = vals[i];
      obj[h] = v === undefined || v === '' ? null : Number(v);
    });
    return obj;
  });
  return { header, rows };
}

function buildFeatureMatrix(rows) {
  const nSamples = rows.length;
  const nFeatures = STRENGTH_FEATURES.length;
  const data = new Float32Array(nSamples * nFeatures);
  rows.forEach((row, i) => {
    STRENGTH_FEATURES.forEach((feat, j) => {
      let v = row[feat];
      if (MATERIAL_INDICATOR_COLS.includes(feat) && v === -1) v = NaN;
      data[i * nFeatures + j] = v;
    });
  });
  return { data, nSamples, nFeatures };
}

// KFold (复现 sklearn KFold shuffle=True, random_state=42)
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleIndices(n, seed = 42) {
  const rng = mulberry32(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function kFold(n, k = 5, seed = 42) {
  const shuffled = shuffleIndices(n, seed);
  const folds = [];
  const foldSize = Math.floor(n / k);
  for (let i = 0; i < k; i++) {
    const start = i * foldSize;
    const end = i === k - 1 ? n : (i + 1) * foldSize;
    const testIdx = shuffled.slice(start, end);
    const trainIdx = shuffled.filter(x => !testIdx.includes(x));
    folds.push({ train: trainIdx, test: testIdx });
  }
  return folds;
}

function rmse(yTrue, yPred) {
  let sum = 0;
  for (let i = 0; i < yTrue.length; i++) {
    sum += (yTrue[i] - yPred[i]) ** 2;
  }
  return Math.sqrt(sum / yTrue.length);
}

// ============ 2. 训练 + 评估 (给定参数返回 5 折 CV RMSE) ============

let _dataCache = null;

function buildBoosterParams(params) {
  return {
    objective: 'reg:squarederror',
    max_depth: String(params.max_depth),
    eta: String(params.learning_rate),
    min_child_weight: String(params.min_child_weight),
    subsample: String(params.subsample),
    colsample_bytree: String(params.colsample_bytree),
    colsample_bynode: String(params.colsample_bynode),
    lambda: String(params.reg_lambda),
    alpha: String(params.reg_alpha),
    gamma: String(params.gamma),
    seed: '42',
    verbosity: '0',
  };
}

function trainAndEvaluate(params) {
  const { XData, rows, nSamples, nFeatures } = _dataCache;
  const folds = kFold(nSamples, 5, 42);
  const rmseList = [];

  for (const { train: trainIdx, test: testIdx } of folds) {
    const XTrainData = new Float32Array(trainIdx.length * nFeatures);
    const yTrain = new Float32Array(trainIdx.length);
    trainIdx.forEach((idx, i) => {
      XTrainData.set(XData.subarray(idx * nFeatures, (idx + 1) * nFeatures), i * nFeatures);
      yTrain[i] = rows[idx].target_strength_28d;
    });

    const XTestData = new Float32Array(testIdx.length * nFeatures);
    const yTest = testIdx.map(idx => rows[idx].target_strength_28d);
    testIdx.forEach((idx, i) => {
      XTestData.set(XData.subarray(idx * nFeatures, (idx + 1) * nFeatures), i * nFeatures);
    });

    const dtrain = new DMatrix(XTrainData, { nrow: trainIdx.length, ncol: nFeatures });
    dtrain.setLabel(yTrain);
    const booster = new Booster(buildBoosterParams(params), [dtrain]);
    for (let i = 0; i < params.n_estimators; i++) {
      booster.update(dtrain, i);
    }

    const dtest = new DMatrix(XTestData, { nrow: testIdx.length, ncol: nFeatures });
    const yPred = Array.from(booster.predict(dtest));
    rmseList.push(rmse(yTest, yPred));

    booster.dispose();
    dtrain.dispose();
    dtest.dispose();
  }

  return rmseList.reduce((a, b) => a + b, 0) / rmseList.length;
}

// ============ 3. TPE 调参 (effect-search) ============

async function runTpeTuning(nTrials) {
  console.log(`\n启动 TPE 调参 (n_trials=${nTrials}, seed=42)...\n`);

  const program = Effect.gen(function* () {
    // 搜索空间 (完全对标 Python Optuna train.py 的 tune_hyperparameters)
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
      gamma: SearchSpace.float(0, 5),
    });

    // 运行优化
    const result = yield* Study.minimize({
      space,
      sampler: Sampler.tpe({ seed: 42 }),
      objective: (config) => Effect.sync(() => {
        const foldRmse = trainAndEvaluate(config);
        if (!Number.isFinite(foldRmse)) return 1e9;
        return foldRmse;
      }),
      trials: nTrials,
    });

    return result;
  });

  return Effect.runPromise(program);
}

// ============ 4. 主流程 ============

async function main() {
  console.log('='.repeat(60));
  console.log('POC: 验证 effect-search TPE 调参效果');
  console.log('='.repeat(60));

  await loadXGB();
  console.log('WASM 模块加载完成\n');

  // 加载数据
  const csvPath = path.resolve(__dirname, 'real_training_data.csv');
  const { header, rows } = parseCSV(csvPath);
  console.log(`数据加载: ${rows.length} 行, ${header.length} 列`);

  const { data: XData, nSamples, nFeatures } = buildFeatureMatrix(rows);
  _dataCache = { XData, rows, nSamples, nFeatures };
  console.log(`特征矩阵: ${nSamples} × ${nFeatures}\n`);

  console.log('-'.repeat(60));
  console.log('Python Optuna 基准 (n_trials=200):');
  console.log('  最优 RMSE=5.1586, R²=0.7829');
  console.log('  最优参数: n_estimators=468, max_depth=5, lr=0.0778');
  console.log('-'.repeat(60));

  // 跑 TPE 调参 (200 次试验, 与 Python Optuna 同等预算)
  const nTrials = 200;
  const startTime = Date.now();

  try {
    const result = await runTpeTuning(nTrials);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('TPE 调参完成');
    console.log('='.repeat(60));
    console.log(`耗时: ${elapsed}s (${nTrials} 次试验)`);

    // 提取最优结果
    const bestTrial = result.bestTrial;
    if (bestTrial) {
      const bestValue = bestTrial.state?.value;
      const bestParams = bestTrial.state?.config || bestTrial.config || {};

      console.log('\n最优试验:');
      console.log(`  RMSE (5 折 CV): ${Number(bestValue).toFixed(4)}`);
      console.log('  参数:');
      for (const [k, v] of Object.entries(bestParams)) {
        console.log(`    ${k}: ${v}`);
      }

      // 对比 Python
      console.log('\n对比 Python Optuna:');
      console.log(`  JS TPE  RMSE: ${Number(bestValue).toFixed(4)}  (n_trials=${nTrials})`);
      console.log(`  Python  RMSE: 5.1586      (n_trials=200)`);

      const diff = Math.abs(Number(bestValue) - 5.1586);
      const pct = (diff / 5.1586 * 100).toFixed(1);
      console.log(`  偏差: ${diff.toFixed(4)} (${pct}%)`);

      if (diff / 5.1586 < 0.1) {
        console.log(`  ✅ TPE 调参效果在 10% 容差内, 验证通过`);
      } else if (diff / 5.1586 < 0.2) {
        console.log(`  ⚠️  TPE 调参效果在 10-20% 容差内, 可考虑增加 n_trials`);
      } else {
        console.log(`  ⚠️  TPE 调参偏差较大, 需进一步排查`);
      }
    } else {
      console.log('\n⚠️  未获取到 bestTrial, 完整结果:', JSON.stringify(result, null, 2).slice(0, 500));
    }
  } catch (err) {
    console.error('\nTPE 调参失败:', err.message);
    console.error(err.stack);
  }
}

main().catch(err => {
  console.error('POC 失败:', err);
  process.exit(1);
});

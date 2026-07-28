// POC: 验证 @wlearn/xgboost 能否复现 Python XGBoost 的训练结果
// 对比基准: resources/models/strength28d.json (Python 训练)
//   - 5 折 CV: RMSE=5.1586, R²=0.7829, MAE=3.9151
//   - 最优参数: n_estimators=468, max_depth=5, learning_rate=0.0778

const fs = require('fs');
const path = require('path');
const { loadXGB, DMatrix, Booster } = require('@wlearn/xgboost');

// ============ 1. 数据加载与特征工程 (复现 train.py 逻辑) ============

// 8 列材料指标，未用该材料时填 -1 会让 XGBoost 误学，改成 NaN
const MATERIAL_INDICATOR_COLS = [
  'fly_ash_activity_index',
  'fly_ash_water_demand_ratio',
  'slag_activity_index',
  'slag_fluidity_ratio',
  'lithium_slag_activity_index',
  'lithium_slag_water_demand_ratio',
  'composite_powder_activity_index',
  'composite_powder_fluidity_ratio',
];

// strength_28d 目标用的 31 维特征 (FEATURE_CONFIG 删除 feature_slump 后)
// 注意: CSV 中还含 temperature/humidity/curing_age 3 列常量，需剔除
const STRENGTH_FEATURES = [
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
  // 输出 Float32Array, NaN 表示缺失 (DMatrix 要求 Float32Array)
  const nSamples = rows.length;
  const nFeatures = STRENGTH_FEATURES.length;
  const data = new Float32Array(nSamples * nFeatures);

  rows.forEach((row, i) => {
    STRENGTH_FEATURES.forEach((feat, j) => {
      let v = row[feat];
      // 8 列材料指标 -1 → NaN (复现 train.py 的清洗)
      if (MATERIAL_INDICATOR_COLS.includes(feat) && v === -1) {
        v = NaN;
      }
      // 其他列 -1 保持原样 (has_* 是 0/1, 其他材料属性 -1 也保留)
      // 注意: train.py 只清洗这 8 列，其他 -1 保留
      data[i * nFeatures + j] = v;
    });
  });

  return { data, nSamples, nFeatures };
}

// ============ 2. KFold (复现 sklearn KFold shuffle=True, random_state=42) ============

// 简单的 seed=42 伪随机 (mulberry32), 输出 [0,1)
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle with seed
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

// ============ 3. 评估指标 ============

function rmse(yTrue, yPred) {
  let sum = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const d = yTrue[i] - yPred[i];
    sum += d * d;
  }
  return Math.sqrt(sum / yTrue.length);
}

function mae(yTrue, yPred) {
  let sum = 0;
  for (let i = 0; i < yTrue.length; i++) {
    sum += Math.abs(yTrue[i] - yPred[i]);
  }
  return sum / yTrue.length;
}

function r2Score(yTrue, yPred) {
  const mean = yTrue.reduce((a, b) => a + b, 0) / yTrue.length;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  return 1 - ssRes / ssTot;
}

// ============ 4. 训练 (用 Python 调好的最优参数) ============

// Python best_params (来自 resources/models/strength28d.json training_info.best_params)
const BEST_PARAMS = {
  n_estimators: 468,
  max_depth: 5,
  learning_rate: 0.07775795728288287,
  min_child_weight: 10,
  subsample: 0.7169503353359113,
  colsample_bytree: 0.8324927053005355,
  colsample_bynode: 0.6035526652541048,
  reg_lambda: 19.620424731832546,
  reg_alpha: 0.039690253578226635,
  gamma: 4.206847013729197,
  random_state: 42,
  objective: 'reg:squarederror',
};

// 映射到 XGBoost 原生参数 (Booster.setParam)
function buildBoosterParams(params) {
  return {
    objective: params.objective,
    max_depth: String(params.max_depth),
    eta: String(params.learning_rate),
    min_child_weight: String(params.min_child_weight),
    subsample: String(params.subsample),
    colsample_bytree: String(params.colsample_bytree),
    colsample_bynode: String(params.colsample_bynode),
    lambda: String(params.reg_lambda),
    alpha: String(params.reg_alpha),
    gamma: String(params.gamma),
    seed: String(params.random_state),
    verbosity: '0',
  };
}

async function trainBooster(XTrainArr, yTrain, params) {
  // XTrainArr: { data: Float32Array, rows, cols }
  // 注意: Booster 构造时必须把 dtrain 作为 cache 传入, 否则 Booster 不知道特征数
  const dtrain = new DMatrix(XTrainArr.data, { nrow: XTrainArr.rows, ncol: XTrainArr.cols });
  dtrain.setLabel(yTrain);
  const booster = new Booster(buildBoosterParams(params), [dtrain]);
  for (let i = 0; i < params.n_estimators; i++) {
    booster.update(dtrain, i);
  }
  return { booster, dtrain };
}

// ============ 5. 主流程 ============

async function main() {
  console.log('='.repeat(60));
  console.log('POC: 验证 @wlearn/xgboost 复现 Python XGBoost 训练结果');
  console.log('='.repeat(60));

  await loadXGB();
  console.log('WASM 模块加载完成\n');

  // 加载数据
  const csvPath = path.resolve(__dirname, 'real_training_data.csv');
  console.log('加载训练数据:', csvPath);
  const { header, rows } = parseCSV(csvPath);
  console.log(`数据加载完成: ${rows.length} 行, ${header.length} 列`);

  // 构建特征矩阵和目标
  const { data: XData, nSamples, nFeatures } = buildFeatureMatrix(rows);
  const yStrength = rows.map(r => r.target_strength_28d).filter(v => v !== null && !Number.isNaN(v));
  console.log(`特征矩阵: ${nSamples} 样本 × ${nFeatures} 特征 (strength_28d 目标)`);
  console.log(`目标样本数: ${yStrength.length}\n`);

  // ---- 验证 1: 5 折 KFold (与 Python 对比) ----
  console.log('-'.repeat(60));
  console.log('验证 1: 5 折 KFold 交叉验证');
  console.log('-'.repeat(60));
  console.log('Python 基准: RMSE=5.1586, R²=0.7829, MAE=3.9151\n');

  const folds = kFold(nSamples, 5, 42);
  const rmseList = [], maeList = [], r2List = [];

  for (let foldIdx = 0; foldIdx < folds.length; foldIdx++) {
    const { train: trainIdx, test: testIdx } = folds[foldIdx];
    console.log(`  Fold ${foldIdx + 1}/5: train=${trainIdx.length}, test=${testIdx.length}`);

    // 构建训练集
    const XTrainData = new Float32Array(trainIdx.length * nFeatures);
    const yTrain = new Float32Array(trainIdx.length);
    trainIdx.forEach((idx, i) => {
      XTrainData.set(XData.subarray(idx * nFeatures, (idx + 1) * nFeatures), i * nFeatures);
      yTrain[i] = rows[idx].target_strength_28d;
    });

    // 构建测试集
    const XTestData = new Float32Array(testIdx.length * nFeatures);
    const yTest = testIdx.map(idx => rows[idx].target_strength_28d);
    testIdx.forEach((idx, i) => {
      XTestData.set(XData.subarray(idx * nFeatures, (idx + 1) * nFeatures), i * nFeatures);
    });

    // 训练
    const { booster, dtrain } = await trainBooster(
      { data: XTrainData, rows: trainIdx.length, cols: nFeatures },
      yTrain,
      BEST_PARAMS
    );

    // 预测
    const dtest = new DMatrix(XTestData, { nrow: testIdx.length, ncol: nFeatures });
    const yPred = Array.from(booster.predict(dtest));

    // 评估
    const foldRmse = rmse(yTest, yPred);
    const foldMae = mae(yTest, yPred);
    const foldR2 = r2Score(yTest, yPred);
    rmseList.push(foldRmse);
    maeList.push(foldMae);
    r2List.push(foldR2);
    console.log(`    RMSE=${foldRmse.toFixed(4)}, MAE=${foldMae.toFixed(4)}, R²=${foldR2.toFixed(4)}`);

    booster.dispose();
    dtrain.dispose();
    dtest.dispose();
  }

  const meanRmse = rmseList.reduce((a, b) => a + b, 0) / rmseList.length;
  const meanMae = maeList.reduce((a, b) => a + b, 0) / maeList.length;
  const meanR2 = r2List.reduce((a, b) => a + b, 0) / r2List.length;
  const stdRmse = Math.sqrt(rmseList.reduce((s, v) => s + (v - meanRmse) ** 2, 0) / rmseList.length);

  console.log('\n  JS 5 折 CV 汇总:');
  console.log(`    RMSE: ${meanRmse.toFixed(4)} ± ${stdRmse.toFixed(4)}  (Python: 5.1586 ± 0.4742)`);
  console.log(`    MAE:  ${meanMae.toFixed(4)}                   (Python: 3.9151)`);
  console.log(`    R²:   ${meanR2.toFixed(4)}                   (Python: 0.7829)`);

  const rmseDiff = Math.abs(meanRmse - 5.1586);
  const r2Diff = Math.abs(meanR2 - 0.7829);
  console.log(`\n  偏差: |ΔRMSE|=${rmseDiff.toFixed(4)}, |ΔR²|=${r2Diff.toFixed(4)}`);
  if (rmseDiff / 5.1586 < 0.05 && r2Diff < 0.05) {
    console.log('  ✅ 精度在 5% 容差内一致，验证通过');
  } else {
    console.log('  ⚠️  精度偏差超过 5%，需进一步排查 (可能 KFold 分折不一致)');
  }

  // ---- 验证 2: 模型导出 JSON 格式 ----
  console.log('\n' + '-'.repeat(60));
  console.log('验证 2: 模型导出 JSON 格式');
  console.log('-'.repeat(60));

  // 用全量数据训练最终模型
  const XAll = { data: XData, rows: nSamples, cols: nFeatures };  // 见 trainBooster 内部转换
  const yAll = new Float32Array(nSamples);
  rows.forEach((r, i) => { yAll[i] = r.target_strength_28d; });
  const { booster: finalBooster, dtrain: finalDtrain } = await trainBooster(XAll, yAll, BEST_PARAMS);

  // 试导出 JSON 格式
  console.log('  测试 Booster.saveModel("json") ...');
  const jsonBuf = finalBooster.saveModel('json');
  const jsonStr = Buffer.from(jsonBuf).toString('utf-8');
  const jsonPath = path.join(__dirname, 'js_model.json');
  fs.writeFileSync(jsonPath, jsonStr);
  console.log(`  已保存: ${jsonPath} (${(jsonStr.length / 1024).toFixed(1)} KB)`);

  // 检查 JSON 结构
  let modelJson;
  try {
    modelJson = JSON.parse(jsonStr);
    console.log('  JSON 解析成功');
    console.log(`  顶层字段: ${Object.keys(modelJson).join(', ')}`);
    if (modelJson.learner) {
      console.log(`  learner 字段: ${Object.keys(modelJson.learner).join(', ')}`);
      const nTrees = modelJson.learner.gradient_booster?.model?.trees?.length
        ?? modelJson.learner.gradient_booster?.model?.gbtree_model_param?.num_trees;
      console.log(`  树数量: ${nTrees}`);
    }
  } catch (e) {
    console.log('  ⚠️  JSON 解析失败:', e.message);
  }

  // 试导出 UBJ 格式
  console.log('\n  测试 Booster.saveModel("ubj") ...');
  const ubjBuf = finalBooster.saveModel('ubj');
  console.log(`  UBJ 大小: ${(ubjBuf.length / 1024).toFixed(1)} KB`);

  // ---- 验证 3: 加载 Python 训练的模型并对比预测 ----
  console.log('\n' + '-'.repeat(60));
  console.log('验证 3: 加载 Python 训练模型对比预测 (验证跨语言互通)');
  console.log('-'.repeat(60));

  // @wlearn/xgboost 的 Booster.loadModel 期望 UBJ 或 JSON buffer
  // 现有 resources/models/strength28d.json 是 Python 自定义导出格式 (不是 XGBoost 原生 JSON)
  // 所以不能直接 loadModel, 但可以用现有推理服务 XGBoostPredictionService 的遍历逻辑做对比
  const pyModelPath = path.resolve(__dirname, '../../resources/models/strength28d.json');
  const pyModel = JSON.parse(fs.readFileSync(pyModelPath, 'utf-8'));
  console.log(`  Python 模型: ${pyModel.trees.length} 棵树, base_score=${pyModel.base_score}, learning_rate=${pyModel.learning_rate}`);

  // 用 Python 模型预测前 5 个样本 (复现 XGBoostPredictionService._predictOne 逻辑)
  function predictWithPyModel(features) {
    let sum = pyModel.base_score || 0;
    for (const tree of pyModel.trees) {
      let nodeIdx = 0;
      while (true) {
        const node = tree[nodeIdx];
        if (node.leaf !== undefined) {
          sum += node.leaf;
          break;
        }
        const v = features[node.split_feature];
        let next;
        if (v === undefined || v === null || Number.isNaN(v)) {
          next = node.missing;
        } else if (v <= node.split_condition) {
          next = node.left;
        } else {
          next = node.right;
        }
        nodeIdx = next;
      }
    }
    return sum;
  }

  // 用 JS 训练的模型预测前 5 个样本
  const sampleIdx = [0, 1, 2, 3, 4];
  console.log('\n  样本对比 (Python 模型 vs JS 训练模型):');
  console.log('  idx | 实测值  | Python预测 | JS训练预测  | 差值');
  console.log('  ----|---------|------------|------------|--------');

  const dtest5 = new DMatrix(
    new Float32Array(sampleIdx.flatMap(i =>
      Array.from(XData.subarray(i * nFeatures, (i + 1) * nFeatures))
    )),
    { nrow: 5, ncol: nFeatures }
  );
  const jsPreds = Array.from(finalBooster.predict(dtest5));

  sampleIdx.forEach((idx, i) => {
    const actual = rows[idx].target_strength_28d;
    const features = Array.from(XData.subarray(idx * nFeatures, (idx + 1) * nFeatures));
    const pyPred = predictWithPyModel(features);
    const jsPred = jsPreds[i];
    const diff = jsPred - pyPred;
    console.log(`  ${idx.toString().padStart(3)} | ${actual.toFixed(1).padStart(7)} | ${pyPred.toFixed(2).padStart(10)} | ${jsPred.toFixed(2).padStart(10)} | ${diff.toFixed(2)}`);
  });

  dtest5.dispose();
  finalBooster.dispose();
  finalDtrain.dispose();

  // ---- 总结 ----
  console.log('\n' + '='.repeat(60));
  console.log('POC 验证总结');
  console.log('='.repeat(60));
  console.log(`1. 训练能力: ✅ @wlearn/xgboost 可训练 181 样本 + 31 特征的回归模型`);
  console.log(`2. 精度对比: 5 折 CV RMSE 偏差 ${(rmseDiff / 5.1586 * 100).toFixed(1)}% (容差 5%)`);
  console.log(`3. 模型导出: ${modelJson ? '✅' : '⚠️'} saveModel('json') 输出 XGBoost 原生 JSON 格式`);
  console.log(`4. 跨语言: Python 模型是自定义格式, 不能直接 loadModel, 但推理逻辑可复现`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('POC 失败:', err);
  process.exit(1);
});

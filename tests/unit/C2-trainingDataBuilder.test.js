/**
 * C2-trainingDataBuilder.test.js
 * 测试 TrainingDataBuilder + DataValidator + ModelVersionManager
 *
 * 测试覆盖：
 *   1. DataValidator — 单条验证 / 批量验证 / 边界值 / 缺失值跳过
 *   2. ModelVersionManager — saveModel / rollback / listVersions / generateVersion
 *   3. TrainingDataBuilder — _buildRow 列映射 / 多砂多石合并 / 基座加载 / CSV 导出
 */

const path = require('path')
const fs = require('fs')
const assert = require('assert')

// ============ 导入被测试模块 ============

const DataValidator = require(path.join(
  __dirname, '..', '..', 'src', 'main', 'services', 'training', 'DataValidator'
))

const ModelVersionManager = require(path.join(
  __dirname, '..', '..', 'src', 'main', 'services', 'training', 'ModelVersionManager'
))

const TrainingDataBuilder = require(path.join(
  __dirname, '..', '..', 'src', 'main', 'services', 'training', 'TrainingDataBuilder'
))

// ============ 测试工具 ============

function run(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error.message)
    if (error.expected !== undefined) {
      console.error(`  期望: ${JSON.stringify(error.expected)}`)
      console.error(`  实际: ${JSON.stringify(error.actual)}`)
    }
    process.exitCode = 1
  }
}

async function runAsync(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error.message)
    if (error.expected !== undefined) {
      console.error(`  期望: ${JSON.stringify(error.expected)}`)
      console.error(`  实际: ${JSON.stringify(error.actual)}`)
    }
    process.exitCode = 1
  }
}

// ============ Mock 数据 ============

function makeMockRecord(overrides = {}) {
  return {
    toJSON() {
      return this
    },
    water_binder_ratio: 0.45,
    cement_amount: 350,
    fly_ash_dosage: 15,
    slag_dosage: 0,
    lithium_slag_dosage: 0,
    composite_powder_dosage: 0,
    sand_ratio: 40,
    superplasticizer_dosage: 1.8,
    slump: 180,
    cementBatchId: 1,
    flyAshBatchId: 2,
    slagBatchId: null,
    lithiumSlagBatchId: null,
    compositePowderBatchId: null,
    sandBatchId: JSON.stringify([3]),
    stoneBatchId: JSON.stringify([4]),
    superplasticizerBatchId: 5,
    trialTestedStrength: 42.5,
    trialTestedSlump: 195,
    trialTestedDensity: 2380,
    trialTestedDosage: 1.9,
    ...overrides
  }
}

function makeMockBatch(id, overrides = {}) {
  return {
    toJSON() { return this },
    id,
    compressiveStrength28d: 52.5,
    standardConsistency: 27.5,
    activityIndex28d: 95,
    waterDemandRatio: 98,
    fluidityRatio: 100,
    finenessModulus: 2.7,
    mbValue: 0.35,
    mudContent: 2.5,
    crushingValue: 8.5,
    needleFlakeContent: 5.0,
    waterReducingRate: 28,
    solidContent: 10,
    recommendedDosage: 2.0,
    ...overrides
  }
}

// ============ Section 1: DataValidator ============

console.log('\n=== DataValidator ===')

run('validates a normal record with no warnings', () => {
  const result = DataValidator.validate({
    water_binder_ratio: 0.45,
    cement_amount: 350,
    sand_ratio: 40,
    trialTestedStrength: 42.5,
    trialTestedDensity: 2380,
    trialTestedSlump: 180
  })
  assert.strictEqual(result.valid, true, '正常值应验证通过')
  assert.strictEqual(result.warnings.length, 0)
})

run('flags water_binder_ratio below minimum', () => {
  const result = DataValidator.validate({
    water_binder_ratio: 0.15
  })
  assert.strictEqual(result.valid, false)
  assert.ok(result.warnings[0].includes('水胶比'), '警告应包含中文标签')
  assert.ok(result.warnings[0].includes('0.15'))
})

run('flags cement_amount above maximum', () => {
  const result = DataValidator.validate({
    cement_amount: 800
  })
  assert.strictEqual(result.valid, false)
  assert.ok(result.warnings[0].includes('水泥用量'))
})

run('skips missing values', () => {
  const result = DataValidator.validate({
    water_binder_ratio: null,
    cement_amount: undefined,
    slump: ''
  })
  assert.strictEqual(result.valid, true, '缺失值应跳过不报错')
})

run('skips -1 placeholder values', () => {
  const result = DataValidator.validate({
    water_binder_ratio: -1,
    cement_amount: -1
  })
  assert.strictEqual(result.valid, true)
})

run('reports multiple warnings for a record', () => {
  const result = DataValidator.validate({
    water_binder_ratio: 0.15,
    cement_amount: 800,
    trialTestedDensity: 1800
  })
  assert.strictEqual(result.valid, false)
  assert.ok(result.warnings.length >= 3)
})

run('batch validation counts correctly', () => {
  const result = DataValidator.validateBatch([
    { water_binder_ratio: 0.45, cement_amount: 350 },  // valid
    { water_binder_ratio: 0.15, cement_amount: 350 },  // 1 warning
    { water_binder_ratio: 0.10, cement_amount: 800 }   // 2 warnings
  ])
  assert.strictEqual(result.validCount, 1)
  assert.strictEqual(result.details.length, 2)
  assert.strictEqual(result.warningCount, 3)
})

run('validates target columns', () => {
  const result = DataValidator.validate({
    target_strength_28d: 42.5,
    target_density: 2400,
    target_superplasticizer_dosage: 1.5
  })
  assert.strictEqual(result.valid, true)

  const bad = DataValidator.validate({
    target_strength_28d: 150
  })
  assert.strictEqual(bad.valid, false)
})

// ============ Section 2: ModelVersionManager ============

console.log('\n=== ModelVersionManager ===')

run('generateVersion produces YYYYMMDD_HHMMSS format', () => {
  const ver = ModelVersionManager.generateVersion()
  assert.ok(/^\d{8}_\d{6}$/.test(ver), `格式不正确: ${ver}`)
})

run('getModelFilename maps known targets', () => {
  // 通过 listVersions 间接测试文件名映射（私有方法_前缀，直接使用公开接口）
  // 测试文件名映射一致性：内部使用 TARGET_FILE_MAP
  const strengths = ModelVersionManager.listVersions('strength_28d')
  assert.ok(typeof strengths === 'object')
  assert.ok('currentVersion' in strengths)
  assert.ok('archives' in strengths)

  const density = ModelVersionManager.listVersions('density')
  assert.ok(typeof density === 'object')
})

run('saveModel + listVersions + rollback roundtrip', async () => {
  // 使用临时目录隔离测试
  const TEST_DIR = path.join(__dirname, '..', '..', '.tmp', 'C2-mvm-test-' + Date.now())
  const modelsDir = path.join(TEST_DIR, 'models')
  fs.mkdirSync(modelsDir, { recursive: true })

  // 临时替换 ModelVersionManager 的内部 _modelsDir
  const originalSaveModel = ModelVersionManager.saveModel.bind(ModelVersionManager)

  // Mock getModelsDir
  const origGetModelsDir = ModelVersionManager._modelsDir
  ModelVersionManager._modelsDir = modelsDir

  try {
    // 1. 首次保存
    const modelV1 = {
      target: 'strength_28d',
      trees: [{ leaf: 42 }],
      model_version: '1.0'
    }
    const saveResult1 = await ModelVersionManager.saveModel('strength_28d', modelV1)
    assert.ok(saveResult1.version)
    assert.ok(saveResult1.path)

    // 验证文件已写入
    const modelPath = path.join(modelsDir, 'strength28d.json')
    assert.ok(fs.existsSync(modelPath))

    const loaded1 = JSON.parse(fs.readFileSync(modelPath, 'utf-8'))
    assert.strictEqual(loaded1.model_version, saveResult1.version)

    // 2. 再次保存（触发归档）
    const modelV2 = {
      target: 'strength_28d',
      trees: [{ leaf: 99 }]
    }
    const saveResult2 = await ModelVersionManager.saveModel('strength_28d', modelV2)
    assert.ok(saveResult2.version)

    // 验证归档存在
    const archiveDir = path.join(modelsDir, 'archive', saveResult2.version)
    assert.ok(fs.existsSync(archiveDir))

    const archiveFiles = fs.readdirSync(archiveDir)
    assert.ok(archiveFiles.length > 0, '归档目录应有备份文件')
    assert.ok(archiveFiles[0].endsWith('.bak'))

    // 3. listVersions
    const versions = ModelVersionManager.listVersions('strength_28d')
    assert.strictEqual(versions.currentVersion, saveResult2.version)
    assert.ok(versions.archives.length >= 1)

    // 4. rollback
    const rollbackResult = await ModelVersionManager.rollback('strength_28d')
    assert.strictEqual(rollbackResult.targetName, 'strength_28d')

    const loadedAfterRollback = JSON.parse(fs.readFileSync(modelPath, 'utf-8'))
    // 回滚后的模型内容应与 V1 一致
    assert.strictEqual(loadedAfterRollback.trees[0].leaf, 42)
  } finally {
    // 清理
    ModelVersionManager._modelsDir = origGetModelsDir
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
  }
})

run('rollback throws when no archives exist', async () => {
  try {
    await ModelVersionManager.rollback('nonexistent_target_xyz')
    assert.fail('应抛出异常')
  } catch (err) {
    assert.ok(err.message.includes('没有找到') || err.message.includes('历史版本'))
  }
})

run('listVersions returns currentVersion=null for missing model', () => {
  const versions = ModelVersionManager.listVersions('nonexistent_model')
  assert.strictEqual(versions.currentVersion, null)
  assert.ok(Array.isArray(versions.archives))
})

// ============ Section 3: TrainingDataBuilder ============

console.log('\n=== TrainingDataBuilder ===')

run('_buildRow populates all 39 columns from a valid record', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map()
  batchCache.set(1, makeMockBatch(1))
  batchCache.set(2, makeMockBatch(2))
  batchCache.set(3, makeMockBatch(3))
  batchCache.set(4, makeMockBatch(4))
  batchCache.set(5, makeMockBatch(5))

  const record = makeMockRecord()
  const row = builder._buildRow(record, batchCache)

  // 验证所有列都有值
  const expectedCols = [
    'water_binder_ratio', 'cement_amount', 'fly_ash_dosage', 'slag_dosage',
    'lithium_slag_dosage', 'composite_powder_dosage', 'sand_ratio',
    'superplasticizer_dosage', 'has_fly_ash', 'has_slag', 'has_lithium_slag',
    'has_composite_powder', 'has_superplasticizer', 'cement_strength_28d',
    'cement_standard_consistency', 'fly_ash_activity_index',
    'fly_ash_water_demand_ratio', 'slag_activity_index', 'slag_fluidity_ratio',
    'lithium_slag_activity_index', 'lithium_slag_water_demand_ratio',
    'composite_powder_activity_index', 'composite_powder_fluidity_ratio',
    'sand_fineness_modulus', 'sand_mb_value', 'sand_mud_content',
    'stone_crushing_value', 'stone_needle_flake',
    'super_water_reducing_rate', 'super_solid_content', 'super_recommended_dosage',
    'feature_slump', 'temperature', 'humidity', 'curing_age',
    'target_strength_28d', 'target_slump', 'target_density',
    'target_superplasticizer_dosage'
  ]

  for (const col of expectedCols) {
    assert.ok(col in row, `列 ${col} 应在行数据中`)
  }

  // 验证部分值
  assert.strictEqual(row.water_binder_ratio, 0.45)
  assert.strictEqual(row.cement_amount, 350)
  assert.strictEqual(row.has_fly_ash, 1, 'fly_ash_dosage=15 > 0 → has_fly_ash=1')
  assert.strictEqual(row.has_slag, 0, 'slag_dosage=0 → has_slag=0')
  assert.strictEqual(row.cement_strength_28d, 52.5)
  assert.strictEqual(row.feature_slump, 180)
  assert.strictEqual(row.target_strength_28d, 42.5)
  assert.strictEqual(row.target_density, 2380)
  assert.strictEqual(row.target_superplasticizer_dosage, 1.9)
  assert.strictEqual(row.temperature, 20)
  assert.strictEqual(row.humidity, 95)
  assert.strictEqual(row.curing_age, 28)
})

run('has_* flags computed from dosage values', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map()
  batchCache.set(1, makeMockBatch(1))

  // 所有掺量为 0，所有 has_* 应为 0
  const record = makeMockRecord({
    fly_ash_dosage: 0,
    slag_dosage: 0,
    lithium_slag_dosage: 0,
    composite_powder_dosage: 0,
    superplasticizer_dosage: 0
  })
  const row = builder._buildRow(record, batchCache)
  assert.strictEqual(row.has_fly_ash, 0)
  assert.strictEqual(row.has_slag, 0)
  assert.strictEqual(row.has_lithium_slag, 0)
  assert.strictEqual(row.has_composite_powder, 0)
  assert.strictEqual(row.has_superplasticizer, 0)
})

run('missing batch IDs produce -1 for batch-sourced columns', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map() // 空的 batch cache
  batchCache.set(1, makeMockBatch(1))

  const record = makeMockRecord({
    slagBatchId: 999, // 不存在的 batch
    flyAshBatchId: null
  })
  const row = builder._buildRow(record, batchCache)
  assert.strictEqual(row.slag_activity_index, -1, '不存在的 batch 应返回 -1')
  assert.strictEqual(row.fly_ash_activity_index, -1, 'null batchId 应返回 -1')
})

run('_mergeMultiSand averages fields from multiple sand batches', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map()
  batchCache.set(10, makeMockBatch(10, { finenessModulus: 2.5, mbValue: 0.30, mudContent: 2.0 }))
  batchCache.set(11, makeMockBatch(11, { finenessModulus: 3.5, mbValue: 0.50, mudContent: 4.0 }))

  const sandIds = [10, 11]

  const avgFm = builder._mergeMultiSand(sandIds, 'finenessModulus', batchCache)
  assert.strictEqual(avgFm, 3.0, '(2.5 + 3.5) / 2 = 3.0')

  const avgMb = builder._mergeMultiSand(sandIds, 'mbValue', batchCache)
  assert.strictEqual(avgMb, 0.4, '(0.30 + 0.50) / 2 = 0.4')

  const avgMud = builder._mergeMultiSand(sandIds, 'mudContent', batchCache)
  assert.strictEqual(avgMud, 3.0, '(2.0 + 4.0) / 2 = 3.0')
})

run('_mergeMultiSand returns -1 for empty array', () => {
  const builder = new TrainingDataBuilder()
  const result = builder._mergeMultiSand([], 'finenessModulus', new Map())
  assert.strictEqual(result, -1)
})

run('_mergeMultiSand with single batch ID returns that batch field value', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map()
  batchCache.set(10, makeMockBatch(10, { finenessModulus: 2.8 }))

  const result = builder._mergeMultiSand([10], 'finenessModulus', batchCache)
  assert.strictEqual(result, 2.8)
})

run('_mergeMultiStone averages fields from multiple stone batches', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map()
  batchCache.set(20, makeMockBatch(20, { crushingValue: 8.0, needleFlakeContent: 4.0 }))
  batchCache.set(21, makeMockBatch(21, { crushingValue: 10.0, needleFlakeContent: 6.0 }))

  const stoneIds = [20, 21]

  const avgCv = builder._mergeMultiStone(stoneIds, 'crushingValue', batchCache)
  assert.strictEqual(avgCv, 9.0, '(8.0 + 10.0) / 2 = 9.0')

  const avgNf = builder._mergeMultiStone(stoneIds, 'needleFlakeContent', batchCache)
  assert.strictEqual(avgNf, 5.0, '(4.0 + 6.0) / 2 = 5.0')
})

run('_buildRow handles array sandBatchId/stoneBatchId from parsed JSON', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map()
  batchCache.set(10, makeMockBatch(10, { finenessModulus: 2.5 }))
  batchCache.set(11, makeMockBatch(11, { finenessModulus: 3.5 }))

  // JSON.parse 后的数组（非字符串）
  const record = makeMockRecord({
    sandBatchId: [10, 11],
    stoneBatchId: [20]
  })
  const row = builder._buildRow(record, batchCache)
  assert.strictEqual(row.sand_fineness_modulus, 3.0, '(2.5 + 3.5) / 2 = 3.0')
  assert.strictEqual(row.stone_crushing_value, -1, 'stoneId=20不在cache中')
})

run('getFeatureSubset returns correct subsets', () => {
  const builder = new TrainingDataBuilder()

  const strength = builder.getFeatureSubset('strength_28d')
  assert.ok(strength.includes('water_binder_ratio'))
  assert.ok(!strength.includes('feature_slump'), 'strength_28d 不应含 feature_slump')

  const density = builder.getFeatureSubset('density')
  assert.ok(!density.includes('feature_slump'), 'density 不应含 feature_slump')

  const sp = builder.getFeatureSubset('superplasticizer_dosage')
  assert.ok(sp.includes('feature_slump'), 'superplasticizer_dosage 应含 feature_slump')

  const unknown = builder.getFeatureSubset('unknown_target')
  assert.ok(unknown.includes('feature_slump'), '未知目标应返回所有特征')
})

run('_loadBaseTrainingData loads XLSX from docs/', async () => {
  const builder = new TrainingDataBuilder()
  const baseRows = await builder._loadBaseTrainingData()

  if (baseRows.length > 0) {
    console.log(`  基座数据加载成功: ${baseRows.length} 行`)
    // 验证第一行有正确的列名
    const firstRow = baseRows[0]
    assert.ok('water_binder_ratio' in firstRow)
    assert.ok('cement_amount' in firstRow)
  } else {
    // 如果没有基座文件（CI 环境），跳过此测试
    console.log('  跳过基座加载测试（未找到 XLSX 文件）')
  }
})

run('_exportAuditCsv writes file correctly', async () => {
  const builder = new TrainingDataBuilder()
  const csvContent = 'col1,col2\n1,2\n3,4'
  const version = '20260728_120000'
  const filePath = builder._exportAuditCsv(csvContent, version)

  try {
    assert.ok(fs.existsSync(filePath))
    const content = fs.readFileSync(filePath, 'utf-8')
    assert.strictEqual(content, csvContent)
    assert.ok(filePath.includes('archive'))
    assert.ok(filePath.includes(version))
  } finally {
    // 清理
    try { fs.rmSync(path.dirname(path.dirname(filePath)), { recursive: true, force: true }) } catch {}
  }
})

run('_buildRow with missing batch in cache returns -1', () => {
  const builder = new TrainingDataBuilder()
  const emptyCache = new Map()

  const record = makeMockRecord({
    cementBatchId: 999 // 不在 cache 中的 batchId
  })
  const row = builder._buildRow(record, emptyCache)
  assert.strictEqual(row.cement_strength_28d, -1, '缺失 batch 应返回 -1')
  assert.strictEqual(row.cement_standard_consistency, -1)
})

// ============ Section 4: Integration - CSV output format ============

console.log('\n=== Integration: CSV output ===')

run('_rowsToCsv produces correct CSV string', () => {
  const builder = new TrainingDataBuilder()
  const batchCache = new Map()
  batchCache.set(1, makeMockBatch(1))
  batchCache.set(2, makeMockBatch(2))
  batchCache.set(3, makeMockBatch(3))
  batchCache.set(4, makeMockBatch(4))
  batchCache.set(5, makeMockBatch(5))

  const record = makeMockRecord()
  const rows = [builder._buildRow(record, batchCache)]

  // 获取 CSV
  const header = [
    'water_binder_ratio', 'target_strength_28d'
  ]
  const csv = builder._rowsToCsv(header, rows)
  const lines = csv.trim().split('\n')
  assert.strictEqual(lines[0], 'water_binder_ratio,target_strength_28d')
  assert.strictEqual(lines[1], '0.45,42.5')
})

// ============ 汇总 ============

console.log('\n=== 测试完成 ===')

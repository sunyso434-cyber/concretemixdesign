/**
 * generate-base-training-csv.js
 * 生成统一格式基座训练数据 CSV（39 列，新 schema）
 *
 * 数据源：docs/newtemplate_training_data_processed.xlsx（38 列、181 行）
 *   - 含 feature_slump / composite_powder_fluidity_ratio / target_superplasticizer_dosage
 *   - 缺 target_slump（Worker 不用，补 -1）
 *
 * 输出：resources/models/base_training_data.csv
 *   - 与 TrainingDataBuilder.CSV_HEADER / trainingWorker 期望的 39 列完全对齐
 *   - 随包发布（package.json build.files 已含 resources/models/**）
 *
 * 用法：node scripts/generate-base-training-csv.js
 */

const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

// ============ 39 列 CSV_HEADER（与 TrainingDataBuilder.CSV_HEADER 保持一致） ============
const CSV_HEADER = [
  // 配合比列
  'water_binder_ratio', 'cement_amount', 'fly_ash_dosage', 'slag_dosage',
  'lithium_slag_dosage', 'composite_powder_dosage', 'sand_ratio', 'superplasticizer_dosage',
  // Flag 列
  'has_fly_ash', 'has_slag', 'has_lithium_slag', 'has_composite_powder', 'has_superplasticizer',
  // 材料属性列
  'cement_strength_28d', 'cement_standard_consistency',
  'fly_ash_activity_index', 'fly_ash_water_demand_ratio',
  'slag_activity_index', 'slag_fluidity_ratio',
  'lithium_slag_activity_index', 'lithium_slag_water_demand_ratio',
  'composite_powder_activity_index', 'composite_powder_fluidity_ratio',
  'sand_fineness_modulus', 'sand_mb_value', 'sand_mud_content',
  'stone_crushing_value', 'stone_needle_flake',
  'super_water_reducing_rate', 'super_solid_content', 'super_recommended_dosage',
  // 特征坍落度
  'feature_slump',
  // 环境列
  'temperature', 'humidity', 'curing_age',
  // 目标列
  'target_strength_28d', 'target_slump', 'target_density', 'target_superplasticizer_dosage'
]

const INPUT = path.join(__dirname, '..', 'docs', 'newtemplate_training_data_processed.xlsx')
const OUTPUT = path.join(__dirname, '..', 'resources', 'models', 'base_training_data.csv')

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`[generate-base-training-csv] 源文件不存在: ${INPUT}`)
    process.exit(1)
  }

  const wb = XLSX.readFile(INPUT)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 })

  if (rawData.length < 2) {
    console.error('[generate-base-training-csv] 源文件无数据行')
    process.exit(1)
  }

  const xlsxHeader = rawData[0]
  const lines = [CSV_HEADER.join(',')]
  let rowCount = 0

  for (let i = 1; i < rawData.length; i++) {
    const rawRow = rawData[i]
    if (!rawRow || rawRow.length === 0) continue

    // 跳过全空行
    const hasValue = rawRow.some(v => v !== undefined && v !== null && v !== '')
    if (!hasValue) continue

    const out = CSV_HEADER.map(col => {
      const idx = xlsxHeader.indexOf(col)
      if (idx === -1) return -1 // 缺失列（如 target_slump）补 -1
      const v = rawRow[idx]
      if (v === undefined || v === null || v === '') return -1
      const n = Number(v)
      return Number.isFinite(n) ? n : -1
    })

    lines.push(out.join(','))
    rowCount++
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf-8')

  console.log(`[generate-base-training-csv] 已生成 ${OUTPUT}`)
  console.log(`  - 表头列数: ${CSV_HEADER.length}`)
  console.log(`  - 数据行数: ${rowCount}`)
}

main()

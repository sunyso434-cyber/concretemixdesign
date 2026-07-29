/**
 * TrainingDataBuilder.js
 * 训练数据拼装器：从 TrialTestRecord JOIN material_batches 拼装训练 CSV
 *
 * 数据策略：Plan B — 基座 181 行 + 用户数据重复采样×5
 *
 * 流程：
 *   1. _loadBaseTrainingData()    ← 读取基座 XLSX（优先 resources/，回退 docs/）
 *   2. buildFromTrialRecords()    ← 查询 TrialTestRecord + JOIN material_batches
 *   3. _buildRow()                ← 按列映射表拼装单行
 *   4. _mergeMultiSand/Stone()    ← 多砂/多石等权平均
 *   5. CSV 输出                   ← 拼接基座 + 用户数据（重复采样×5）
 *
 * 列映射表：32 维特征 + 环境列 + 目标列 = 39 列
 *   - 配合比列：从 TrialTestRecord 取值
 *   - 材料属性列：从 material_batches JOIN 取值
 *   - Flag 列：从用量计算（>0 ? 1 : 0）
 *   - 多砂/多石：等权平均合并
 *   - 环境列：固定默认值
 *   - 目标列：从实测值取值
 */

const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const DataValidator = require('./DataValidator')

// ============ 列映射表定义 ============

/**
 * 列定义类型：
 *   - record      : 从 TrialTestRecord 直接取值
 *   - flag        : 从用量字段计算（>0 ? 1 : 0）
 *   - batch       : 从 material_batches JOIN 取单一批次属性
 *   - multi_sand  : 多砂 batch 等权平均
 *   - multi_stone : 多石 batch 等权平均
 *   - target      : 从实测值取值
 *   - default     : 使用固定默认值
 */

const COLUMN_DEFS = [
  // ===== 配合比列 (from record) =====
  { name: 'water_binder_ratio',             source: 'record',   recordField: 'water_binder_ratio' },
  { name: 'cement_amount',                  source: 'record',   recordField: 'cement_amount' },
  { name: 'fly_ash_dosage',                 source: 'record',   recordField: 'fly_ash_dosage' },
  { name: 'slag_dosage',                    source: 'record',   recordField: 'slag_dosage' },
  { name: 'lithium_slag_dosage',            source: 'record',   recordField: 'lithium_slag_dosage' },
  { name: 'composite_powder_dosage',        source: 'record',   recordField: 'composite_powder_dosage' },
  { name: 'sand_ratio',                     source: 'record',   recordField: 'sand_ratio' },
  { name: 'superplasticizer_dosage',        source: 'record',   recordField: 'superplasticizer_dosage' },

  // ===== Flag 列 (computed) =====
  { name: 'has_fly_ash',           source: 'flag',   dosageField: 'fly_ash_dosage' },
  { name: 'has_slag',              source: 'flag',   dosageField: 'slag_dosage' },
  { name: 'has_lithium_slag',      source: 'flag',   dosageField: 'lithium_slag_dosage' },
  { name: 'has_composite_powder',  source: 'flag',   dosageField: 'composite_powder_dosage' },
  { name: 'has_superplasticizer',  source: 'flag',   dosageField: 'superplasticizer_dosage' },

  // ===== 材料属性列 (from batch JOIN) =====
  { name: 'cement_strength_28d',            source: 'batch',      batchIdField: 'cementBatchId', batchField: 'compressiveStrength28d' },
  { name: 'cement_standard_consistency',    source: 'batch',      batchIdField: 'cementBatchId', batchField: 'standardConsistency' },
  { name: 'fly_ash_activity_index',         source: 'batch',      batchIdField: 'flyAshBatchId', batchField: 'activityIndex28d' },
  { name: 'fly_ash_water_demand_ratio',     source: 'batch',      batchIdField: 'flyAshBatchId', batchField: 'waterDemandRatio' },
  { name: 'slag_activity_index',            source: 'batch',      batchIdField: 'slagBatchId', batchField: 'activityIndex28d' },
  { name: 'slag_fluidity_ratio',            source: 'batch',      batchIdField: 'slagBatchId', batchField: 'fluidityRatio' },
  { name: 'lithium_slag_activity_index',    source: 'batch',      batchIdField: 'lithiumSlagBatchId', batchField: 'activityIndex28d' },
  { name: 'lithium_slag_water_demand_ratio',source: 'batch',      batchIdField: 'lithiumSlagBatchId', batchField: 'waterDemandRatio' },
  { name: 'composite_powder_activity_index',source: 'batch',      batchIdField: 'compositePowderBatchId', batchField: 'activityIndex28d' },
  { name: 'composite_powder_fluidity_ratio',source: 'batch',      batchIdField: 'compositePowderBatchId', batchField: 'fluidityRatio' },

  // ===== 多砂多石等权平均 =====
  { name: 'sand_fineness_modulus',  source: 'multi_sand',  batchField: 'finenessModulus' },
  { name: 'sand_mb_value',          source: 'multi_sand',  batchField: 'mbValue' },
  { name: 'sand_mud_content',       source: 'multi_sand',  batchField: 'mudContent' },
  { name: 'stone_crushing_value',   source: 'multi_stone', batchField: 'crushingValue' },
  { name: 'stone_needle_flake',     source: 'multi_stone', batchField: 'needleFlakeContent' },

  // ===== 减水剂属性 (from batch JOIN) =====
  { name: 'super_water_reducing_rate',    source: 'batch', batchIdField: 'superplasticizerBatchId', batchField: 'waterReducingRate' },
  { name: 'super_solid_content',          source: 'batch', batchIdField: 'superplasticizerBatchId', batchField: 'solidContent' },
  { name: 'super_recommended_dosage',     source: 'batch', batchIdField: 'superplasticizerBatchId', batchField: 'recommendedDosage' },

  // ===== 特征坍落度 (from record) =====
  { name: 'feature_slump', source: 'record', recordField: 'slump' },

  // ===== 环境列 (fixed defaults) =====
  { name: 'temperature', source: 'default', value: 20 },
  { name: 'humidity',    source: 'default', value: 95 },
  { name: 'curing_age',  source: 'default', value: 28 },

  // ===== 目标列 =====
  { name: 'target_strength_28d',            source: 'target', recordField: 'trialTestedStrength' },
  { name: 'target_slump',                   source: 'target', recordField: 'trialTestedSlump' },
  { name: 'target_density',                 source: 'target', recordField: 'trialTestedDensity' },
  { name: 'target_superplasticizer_dosage', source: 'target', recordField: 'trialTestedDosage' }
]

// CSV 列名顺序（从 COLUMN_DEFS 提取）
const CSV_HEADER = COLUMN_DEFS.map(c => c.name)

// ============ 特征子集定义 ============

// 所有非目标、非环境的特征列名（供 getFeatureSubset 使用）
const ALL_FEATURES = CSV_HEADER.filter(c =>
  !c.startsWith('target_') &&
  c !== 'temperature' && c !== 'humidity' && c !== 'curing_age'
)

const FEATURE_SUBSETS = {
  strength_28d:             ALL_FEATURES.filter(f => f !== 'feature_slump'),  // 31 维
  density:                  ALL_FEATURES.filter(f => f !== 'feature_slump'),  // 31 维
  superplasticizer_dosage:  ALL_FEATURES,                                      // 32 维（含 feature_slump）
}

// ============ 基座 XLSX 搜索路径 ============

function getResourcesDir() {
  const isPackaged = __dirname.includes('app.asar')
  if (isPackaged) {
    const asarPath = __dirname.split('app.asar')[0]
    return path.join(asarPath, 'app.asar.unpacked', 'resources')
  }
  return path.join(__dirname, '..', '..', '..', '..', 'resources')
}

function getDocsDir() {
  return path.join(getResourcesDir(), '..', 'docs')
}

// ============ TrainingDataBuilder ============

class TrainingDataBuilder {
  /**
   * @param {Object} [options]
   * @param {Function} [options.getBatchById] - 外部批次查询函数，用于测试注入
   * @param {Object} [options.models] - Sequelize 模型注入，用于测试/离线模式
   */
  constructor(options = {}) {
    this._getBatchById = options.getBatchById || null
    this._models = options.models || null
  }

  /**
   * 设置 Sequelize 模型（由 buildFromTrialRecords 内部使用）
   * @param {Object} models
   */
  _getTrialTestModel() {
    if (this._models && this._models.TrialTestRecord) {
      return this._models.TrialTestRecord
    }
    // lazy require（避免模块加载时依赖 database）
    const { TrialTestRecord } = require('../../db/models/TrialTestRecord')
    return TrialTestRecord
  }

  /**
   * 设置外部批次查询函数
   * @param {Function} fn - async (batchId) => batchData | null
   */
  setBatchResolver(fn) {
    this._getBatchById = fn
  }

  /**
   * ============ 主入口 ============
   *
   * 从 TrialTestRecord 查询 + JOIN material_batches 拼装训练 CSV
   *
   * @param {Object} [opts]
   * @param {string} [opts.status]     - 筛选状态（默认取所有）
   * @param {boolean} [opts.exportCsv] - 是否导出审计 CSV 快照
   * @param {boolean} [opts.skipValidation] - 是否跳过物理范围检查
   * @returns {Promise<{
   *   csv: string,
   *   header: string[],
   *   userRows: number,
   *   baseRows: number,
   *   totalRows: number,
   *   version: string,
   *   validation: Object|null,
   *   exportPath: string|null
   * }>}
   */
  async buildFromTrialRecords(opts = {}) {
    const model = this._getTrialTestModel()
    const where = opts.status ? { trialStatus: opts.status } : {}
    const records = await model.findAll({
      where,
      order: [['createdAt', 'ASC']]
    })

    // 加载基座数据
    const baseRows = await this._loadBaseTrainingData()

    // 构建批次数据缓存（批量加载所有涉及的批次 ID）
    const batchIds = this._collectBatchIds(records)
    const batchCache = await this._loadBatchCache(batchIds)

    // 拼装用户行
    const userRows = []
    for (const record of records) {
      const row = this._buildRow(record, batchCache)
      if (row) {
        userRows.push(row)
      }
    }

    // 用户数据重复采样 ×5（Plan B）
    const sampledUserRows = []
    for (let i = 0; i < 5; i++) {
      for (const row of userRows) {
        sampledUserRows.push({ ...row })
      }
    }

    // 合并：基座 + 用户数据
    const allRows = [...baseRows, ...sampledUserRows]

    // 验证
    const validation = opts.skipValidation ? null : DataValidator.validateBatch(allRows)

    // 导出 CSV
    const version = this._generateTimestamp()
    const csv = this._rowsToCsv(CSV_HEADER, allRows)
    let exportPath = null
    if (opts.exportCsv !== false) {
      exportPath = this._exportAuditCsv(csv, version)
    }

    return {
      csv,
      header: CSV_HEADER,
      userRows: sampledUserRows.length,
      baseRows: baseRows.length,
      totalRows: allRows.length,
      version,
      validation,
      exportPath
    }
  }

  /**
   * ============ 拼装单行 ============
   *
   * 按列映射表从 record + batchCache 拼装单行数据
   *
   * @param {Object} record - TrialTestRecord 实例（或其 JSON）
   * @param {Map<number, Object>} batchCache - batchId → batchData
   * @returns {Object|null} 行数据对象，如果缺少关键列则返回 null
   */
  _buildRow(record, batchCache) {
    const recordData = record.toJSON ? record.toJSON() : record
    const row = {}

    for (const colDef of COLUMN_DEFS) {
      let value

      switch (colDef.source) {
        case 'record':
        case 'target':
          value = recordData[colDef.recordField]
          break

        case 'flag':
          value = (recordData[colDef.dosageField] > 0) ? 1 : 0
          break

        case 'batch': {
          const batchId = recordData[colDef.batchIdField]
          value = this._getBatchField(batchId, colDef.batchField, batchCache)
          break
        }

        case 'multi_sand': {
          const sandIds = this._normalizeIdArray(recordData.sandBatchId)
          value = this._mergeMultiSand(sandIds, colDef.batchField, batchCache)
          break
        }

        case 'multi_stone': {
          const stoneIds = this._normalizeIdArray(recordData.stoneBatchId)
          value = this._mergeMultiStone(stoneIds, colDef.batchField, batchCache)
          break
        }

        case 'default':
          value = colDef.value
          break

        default:
          value = null
      }

      row[colDef.name] = value !== undefined && value !== null ? value : -1
    }

    return row
  }

  /**
   * 从 batchCache 获取单一批次的字段值
   * @private
   */
  _getBatchField(batchId, field, batchCache) {
    if (!batchId) return -1
    const key = Number(batchId)
    const batch = batchCache.get(key)
    if (!batch) return -1
    const val = batch[field]
    return val !== undefined && val !== null ? val : -1
  }

  /**
   * 多砂等权平均合并
   *
   * @param {number[]} sandBatchIds - 砂批次 ID 数组（始终是数组）
   * @param {string} field - MaterialBatch 字段名
   * @param {Map<number, Object>} batchCache
   * @returns {number} 等权平均值，无有效值时返回 -1
   */
  _mergeMultiSand(sandBatchIds, field, batchCache) {
    if (!sandBatchIds || sandBatchIds.length === 0) return -1
    return this._averageBatchField(sandBatchIds, field, batchCache)
  }

  /**
   * 多石等权平均合并
   *
   * @param {number[]} stoneBatchIds - 石批次 ID 数组
   * @param {string} field
   * @param {Map<number, Object>} batchCache
   * @returns {number}
   */
  _mergeMultiStone(stoneBatchIds, field, batchCache) {
    if (!stoneBatchIds || stoneBatchIds.length === 0) return -1
    return this._averageBatchField(stoneBatchIds, field, batchCache)
  }

  /**
   * 计算多个批次的字段等权平均值
   * @private
   */
  _averageBatchField(batchIds, field, batchCache) {
    const validValues = []

    for (const id of batchIds) {
      const key = Number(id)
      const batch = batchCache.get(key)
      if (!batch) continue
      const val = batch[field]
      if (val !== undefined && val !== null && Number.isFinite(val)) {
        validValues.push(val)
      }
    }

    if (validValues.length === 0) return -1
    const sum = validValues.reduce((a, b) => a + b, 0)
    return Math.round((sum / validValues.length) * 10000) / 10000
  }

  /**
   * 标准化批次 ID 数组（处理 JSON 字符串或数组）
   * @private
   */
  _normalizeIdArray(val) {
    if (!val) return []
    if (Array.isArray(val)) return val.map(Number)
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val)
        return Array.isArray(parsed) ? parsed.map(Number) : [Number(val)]
      } catch {
        return [Number(val)]
      }
    }
    return [Number(val)]
  }

  /**
   * ============ 基座训练数据读取 ============
   *
   * 优先读取 resources/ 下的 XLSX，回退到 docs/
   * 按优先级尝试多个文件名
   *
   * @returns {Promise<Object[]>}
   */
  async _loadBaseTrainingData() {
    const candidates = [
      path.join(getResourcesDir(), 'training_base.xlsx'),
      path.join(getResourcesDir(), '..', 'docs', 'newtemplate_training_data_processed.xlsx'),
      path.join(getResourcesDir(), '..', 'docs', 'newtemplate_training_data.xlsx'),
      path.join(getResourcesDir(), '..', 'docs', 'template_training_data.xlsx'),
      path.join(getDocsDir(), 'newtemplate_training_data_processed.xlsx'),
      path.join(getDocsDir(), 'newtemplate_training_data.xlsx'),
      path.join(getDocsDir(), 'template_training_data.xlsx')
    ]

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        return this._parseXlsxRows(filePath)
      }
    }

    // 没有找到基座文件，返回空数组
    console.warn('[TrainingDataBuilder] 未找到基座训练数据文件，返回空基座')
    return []
  }

  /**
   * 解析 XLSX 文件为行对象数组
   * @private
   * @param {string} filePath
   * @returns {Object[]}
   */
  _parseXlsxRows(filePath) {
    const wb = XLSX.readFile(filePath)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 })

    if (rawData.length < 2) return []

    const xlsxHeader = rawData[0]
    const rows = []

    for (let i = 1; i < rawData.length; i++) {
      const row = {}
      const rawRow = rawData[i]
      if (!rawRow || rawRow.length === 0) continue

      // 跳过全空行
      const hasValue = rawRow.some(v => v !== undefined && v !== null && v !== '')
      if (!hasValue) continue

      for (let j = 0; j < xlsxHeader.length; j++) {
        const colName = xlsxHeader[j]
        // 只取 CSV_HEADER 中存在的列
        if (CSV_HEADER.includes(colName)) {
          const rawVal = rawRow[j]
          row[colName] = (rawVal !== undefined && rawVal !== null && rawVal !== '')
            ? Number(rawVal) : -1
        }
      }

      rows.push(row)
    }

    return rows
  }

  /**
   * ============ 特征子集 ============
   *
   * @param {string} targetName
   * @returns {string[]} 特征列名数组
   */
  getFeatureSubset(targetName) {
    return FEATURE_SUBSETS[targetName] || ALL_FEATURES
  }

  /**
   * ============ 审计 CSV 导出 ============
   *
   * @param {string} csvContent
   * @param {string} version
   * @returns {string} 导出文件路径
   */
  _exportAuditCsv(csvContent, version) {
    const modelsDir = getResourcesDir() + '/models'
    const archiveDir = path.join(modelsDir, 'archive', version)
    fs.mkdirSync(archiveDir, { recursive: true })

    const filePath = path.join(archiveDir, 'training_data_audit.csv')
    fs.writeFileSync(filePath, csvContent, 'utf-8')
    return filePath
  }

  /**
   * 批量加载 batchCache（收集所有涉及的批次 ID 后批量查询）
   * @private
   * @param {Set<number>} batchIds
   * @returns {Promise<Map<number, Object>>}
   */
  async _loadBatchCache(batchIds) {
    const cache = new Map()

    if (batchIds.size === 0) return cache

    // 如果有外部注入的 resolve 函数，用它
    if (this._getBatchById) {
      for (const id of batchIds) {
        try {
          const batch = await this._getBatchById(id)
          if (batch) {
            const data = batch.toJSON ? batch.toJSON() : batch
            cache.set(id, data)
          }
        } catch {
          // 单条查询失败，跳过
        }
      }
      return cache
    }

    // 否则使用 Sequelize 批量查询
    try {
      const { MaterialBatch } = require('../../db/models/MaterialBatch')
      const batches = await MaterialBatch.findAll({
        where: { id: Array.from(batchIds) }
      })
      for (const batch of batches) {
        cache.set(batch.id, batch.toJSON())
      }
    } catch (err) {
      console.warn('[TrainingDataBuilder] 加载批次数据失败:', err.message)
    }

    return cache
  }

  /**
   * 收集所有记录中引用的批次 ID
   * @private
   * @param {Object[]} records
   * @returns {Set<number>}
   */
  _collectBatchIds(records) {
    const ids = new Set()
    const batchIdFields = [
      'cementBatchId', 'flyAshBatchId', 'slagBatchId',
      'lithiumSlagBatchId', 'compositePowderBatchId',
      'superplasticizerBatchId'
    ]
    const arrayFields = ['sandBatchId', 'stoneBatchId']

    for (const record of records) {
      const data = record.toJSON ? record.toJSON() : record

      // 单个 ID 字段
      for (const field of batchIdFields) {
        const id = data[field]
        if (id) ids.add(Number(id))
      }

      // 数组 ID 字段
      for (const field of arrayFields) {
        const ids_arr = this._normalizeIdArray(data[field])
        for (const id of ids_arr) {
          ids.add(Number(id))
        }
      }
    }

    return ids
  }

  /**
   * 将行数组转为 CSV 字符串
   * @private
   */
  _rowsToCsv(header, rows) {
    const lines = [header.join(',')]
    for (const row of rows) {
      const vals = header.map(col => {
        const v = row[col]
        return v !== undefined && v !== null ? v : -1
      })
      lines.push(vals.join(','))
    }
    return lines.join('\n')
  }

  /**
   * 生成时间戳
   * @private
   */
  _generateTimestamp() {
    const now = new Date()
    const Y = now.getFullYear()
    const M = String(now.getMonth() + 1).padStart(2, '0')
    const D = String(now.getDate()).padStart(2, '0')
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    const s = String(now.getSeconds()).padStart(2, '0')
    return `${Y}${M}${D}_${h}${m}${s}`
  }
}

module.exports = TrainingDataBuilder

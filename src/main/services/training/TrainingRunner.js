/**
 * TrainingRunner.js
 * 训练执行器：训练逻辑唯一来源（IPC 与 AI skill 共用）
 *
 * 职责：
 *   1. 训练锁 isTraining（防并发，审查 M4）
 *   2. runTraining() —— 完整训练流程：
 *      构建 CSV（基座 + 试配记录 ×5）→ 校验 → 写临时 CSV → 归档旧模型 →
 *      Worker 训练 → 清预测缓存
 *   3. 模型目录 / 归档 / 版本 / 回滚辅助函数（从 trainingHandler 迁入，避免循环依赖）
 *
 * 返回契约（IPC 与 skill 两端共用，不漂移）：
 *   { success, error, results, modelVersion, archivedVersion, reports, summary }
 *   success/error 必含，其余可选。
 *
 * 进度回调：onProgress({ message, percent, timestamp })，透传不丢字段。
 */

const fs = require('fs')
const path = require('path')
const XGBoostTrainingService = require('../XGBoostTrainingService')
const XGBoostPredictionService = require('../XGBoostPredictionService')
const TrainingDataBuilder = require('./TrainingDataBuilder')
const { getUserModelsDir, getBuiltinModelsDir, readModelFile } = require('./modelPaths')

// ============ 常量 ============

const MODEL_FILES = {
  strength28d: 'strength28d.json',
  superplasticizer_dosage: 'superplasticizerdosage.json',
  density: 'density.json'
}

const TARGET_NAMES = [
  { key: 'strength_28d', label: '28d 强度', file: 'strength28d.json' },
  { key: 'density', label: '容重', file: 'density.json' },
  { key: 'superplasticizer_dosage', label: '减水剂掺量', file: 'superplasticizerdosage.json' }
]

// 基座训练数据文件名（统一格式 CSV，39 列）
const BASE_TRAINING_CSV_NAME = 'base_training_data.csv'

// ============ 目录管理 ============
// getUserModelsDir / getBuiltinModelsDir / readModelFile 已统一到 ./modelPaths（训练与预测共用）

/**
 * 获取基座训练数据 CSV 路径（新格式 base_training_data.csv）
 */
function getBaseTrainingCsvPath() {
  const candidates = [
    path.join(getUserModelsDir(), BASE_TRAINING_CSV_NAME),
    path.join(getBuiltinModelsDir(), BASE_TRAINING_CSV_NAME)
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// ============ 训练锁（审查 M4）============

let isTraining = false

function getTrainingState() {
  return isTraining
}

// ============ 模型版本归档 ============

/**
 * 生成版本号（时间戳格式 YYYYMMDD_HHMMSS）
 */
function generateVersion() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * 获取归档目录路径
 */
function getArchiveDir() {
  return path.join(getUserModelsDir(), 'archive')
}

/**
 * 归档当前模型：训练前复制到 userData/models/archive/<version>/
 * @returns {string|null} 版本号，无模型时返回 null
 */
async function archiveCurrentModels() {
  const version = generateVersion()
  const archiveDir = path.join(getArchiveDir(), version)

  let hasAny = false
  for (const target of TARGET_NAMES) {
    const info = readModelFile(target.key)
    if (info && info.data.trees && info.data.trees.length > 0) {
      fs.mkdirSync(archiveDir, { recursive: true })
      fs.copyFileSync(info.path, path.join(archiveDir, target.file))
      hasAny = true
    }
  }

  return hasAny ? version : null
}

/**
 * 列出所有归档版本（最新在前）
 */
function listArchiveVersions() {
  const archiveDir = getArchiveDir()
  if (!fs.existsSync(archiveDir)) return []

  return fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dirPath = path.join(archiveDir, d.name)
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'))
      const models = files.map(f => {
        const fp = path.join(dirPath, f)
        try {
          const data = JSON.parse(fs.readFileSync(fp, 'utf-8'))
          return {
            file: f,
            target: data.target || f.replace('.json', ''),
            rmse: data.training_info?.rmse,
            rSquared: data.training_info?.r_squared,
            samples: data.training_info?.samples,
            nEstimators: data.training_info?.n_estimators
          }
        } catch {
          return { file: f, target: f.replace('.json', '') }
        }
      })
      return {
        version: d.name,
        date: d.name.replace(/(\d{8})_(\d{6})/, '$1 $2'),
        models,
        fileCount: files.length
      }
    })
    .sort((a, b) => b.version.localeCompare(a.version))
}

/**
 * 回滚到指定版本（文件复制）
 */
function rollbackToVersion(version) {
  const archiveDir = path.join(getArchiveDir(), version)
  if (!fs.existsSync(archiveDir)) {
    throw new Error(`版本 ${version} 的归档不存在`)
  }

  const userDir = getUserModelsDir()
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true })
  }

  const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'))
  for (const file of files) {
    fs.copyFileSync(path.join(archiveDir, file), path.join(userDir, file))
  }

  XGBoostPredictionService.clearCache()

  return { success: true, version, files }
}

/**
 * 预览归档版本的模型指标
 */
function previewArchivedMetrics(version) {
  const archiveDir = path.join(getArchiveDir(), version)
  if (!fs.existsSync(archiveDir)) {
    return { success: false, error: `版本 ${version} 的归档不存在` }
  }

  const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'))
  const models = files.map(f => {
    const fp = path.join(archiveDir, f)
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf-8'))
      return {
        file: f,
        target: data.target || f.replace('.json', ''),
        rmse: data.training_info?.rmse,
        rSquared: data.training_info?.r_squared,
        samples: data.training_info?.samples,
        nEstimators: data.training_info?.n_estimators,
        date: data.training_info?.date
      }
    } catch {
      return { file: f, target: f.replace('.json', '') }
    }
  })

  return { success: true, version, models }
}

// ============ 模型信息读取 ============

/**
 * 获取当前所有模型的摘要信息
 */
function getCurrentModelSummary() {
  const models = []
  for (const target of TARGET_NAMES) {
    const info = readModelFile(target.key)
    if (info) {
      models.push({
        key: target.key,
        label: target.label,
        file: target.file,
        source: info.source,
        exists: true,
        version: info.data.model_version || '1.0',
        trainingInfo: info.data.training_info || null,
        treeCount: info.data.trees?.length || 0,
        featureCount: info.data.feature_names?.length || 0,
        baseScore: info.data.base_score
      })
    } else {
      models.push({
        key: target.key,
        label: target.label,
        file: target.file,
        source: null,
        exists: false
      })
    }
  }
  return models
}

/**
 * 获取模型状态摘要（用于 UI 顶部展示）
 */
function getModelStateSummary() {
  const models = getCurrentModelSummary()
  const existing = models.filter(m => m.exists)

  if (existing.length === 0) {
    return { status: 'none', message: '无可用模型' }
  }

  const representative = existing.find(m => m.trainingInfo) || existing[0]
  const avgRmse = existing
    .filter(m => m.trainingInfo?.rmse)
    .reduce((sum, m, _, arr) => sum + m.trainingInfo.rmse / arr.length, 0)

  const allFromUser = existing.every(m => m.source === 'user')

  return {
    status: allFromUser ? 'user' : 'builtin',
    message: allFromUser ? '用户训练模型' : '内置模型',
    modelCount: existing.length,
    averageRmse: avgRmse || null,
    trainingDate: representative.trainingInfo?.date || null,
    totalSamples: representative.trainingInfo?.samples || null,
    allFromUser
  }
}

// ============ 参数校验 ============

/**
 * nTrials 校验：整数、clamp [1,200]，非数字默认 50
 * 注意：0 不再有「跳过调参」语义（有意废弃，见计划风险节）
 */
function sanitizeNTrials(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 50
  return Math.max(1, Math.min(Math.floor(n), 200))
}

// ============ 核心训练流程 ============

/**
 * 执行一次完整训练
 *
 * @param {Object} [options]
 * @param {number} [options.nTrials]   - TPE 调参试验次数（clamp [1,200]，默认 50）
 * @param {number} [options.timeoutMs] - 训练超时（毫秒），透传给 Worker
 * @param {Function} [onProgress]      - 进度回调 (data: {message, percent, timestamp}) => void
 * @returns {Promise<Object>} 返回契约见文件头
 */
async function runTraining(options = {}, onProgress) {
  if (isTraining) {
    return { success: false, error: '训练进行中，请稍后' }
  }
  isTraining = true

  try {
    const nTrials = sanitizeNTrials(options.nTrials)
    const timeoutMs = options.timeoutMs

    // 1. 构建训练 CSV（基座 + 试配记录 ×5）
    const builder = new TrainingDataBuilder()
    const buildResult = await builder.buildFromTrialRecords({ exportCsv: false })

    // 2. 空数据校验（防止「只有表头 → Worker 全目标跳过 → 假成功」）
    if (buildResult.totalRows <= 0) {
      return { success: false, error: '没有可用的训练数据（基座和试配记录都为空）' }
    }

    // 3. 写临时 CSV（固定文件名覆盖式，保留最新一份供审计）
    const tmpDir = path.join(getUserModelsDir(), 'tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const csvPath = path.join(tmpDir, 'training_current.csv')
    fs.writeFileSync(csvPath, buildResult.csv, 'utf-8')

    // 4. 归档当前模型（训练前备份）
    const archivedVersion = await archiveCurrentModels()

    // 5. Worker 训练（进度结构化透传）
    const results = await XGBoostTrainingService.trainWithWorker(
      { csvPath, outputDir: getUserModelsDir(), nTrials, timeoutMs },
      (progressMsg) => {
        if (typeof onProgress !== 'function') return
        onProgress({
          message: progressMsg?.message ?? progressMsg,
          percent: progressMsg?.percent ?? null,
          timestamp: Date.now()
        })
      }
    )

    // 6. 清空预测缓存，让新模型生效
    XGBoostPredictionService.clearCache()

    const modelVersion = generateVersion()

    return {
      success: true,
      results,
      modelVersion,
      archivedVersion,
      reports: results.reports,
      summary: results.summary,
      totalRows: buildResult.totalRows,
      baseRows: buildResult.baseRows,
      userRows: buildResult.userRows
    }
  } catch (error) {
    console.error('[TrainingRunner] 训练失败:', error)
    return { success: false, error: error.message }
  } finally {
    isTraining = false // 无论成功失败都释放锁
  }
}

module.exports = {
  // 状态
  get isTraining() { return getTrainingState() },
  // 目录/文件
  getUserModelsDir,
  getBuiltinModelsDir,
  getBaseTrainingCsvPath,
  readModelFile,
  getArchiveDir,
  // 版本/归档
  generateVersion,
  archiveCurrentModels,
  listArchiveVersions,
  rollbackToVersion,
  previewArchivedMetrics,
  // 信息
  getCurrentModelSummary,
  getModelStateSummary,
  // 校验
  sanitizeNTrials,
  // 核心
  runTraining
}

/**
 * trainingHandler.js
 * 训练 IPC 处理器：训练启动/状态查询/回滚/模型信息
 *
 * 职责：
 *   1. training:run         - 启动训练（含训练锁 + Worker Thread）
 *   2. training:getStatus   - 查询训练状态
 *   3. training:rollback    - 回滚到上一版本（文件复制）
 *   4. training:getInfo     - 获取当前模型信息 + 训练数据统计 + 历史版本列表
 *   5. training:progress    - (event) 推送训练进度到渲染进程
 *
 * 依赖 Task C1: XGBoostTrainingService（Worker Thread）
 * 依赖 Task C3: 训练锁 isTraining
 *
 * 审查 M3: 回滚用文件复制
 * 审查 M4: 训练锁防并发
 * 审查 N3: Worker Thread 执行，不阻塞主进程
 * 审查 P12: 组件卸载时清理 progress 监听器
 */

const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const XGBoostTrainingService = require('../services/XGBoostTrainingService')
const XGBoostPredictionService = require('../services/XGBoostPredictionService')

// ============ 常量 ============

// 模型文件映射（与 XGBoostPredictionService 保持一致）
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

// ============ 模型目录管理 ============

/**
 * 获取用户模型目录（userData/models/）
 * 用户训练的模型存放在此，优先级高于内置 resources/models/
 */
function getUserModelsDir() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'models')
}

/**
 * 获取内置模型目录（resources/models/）
 */
function getBuiltinModelsDir() {
  const isPackaged = __dirname.includes('app.asar')
  if (isPackaged) {
    const asarPath = __dirname.split('app.asar')[0]
    return path.join(asarPath, 'app.asar.unpacked', 'resources', 'models')
  }
  // 开发环境：以 main.js 所在目录为基准
  return path.join(__dirname, '..', '..', '..', 'resources', 'models')
}

/**
 * 读取模型文件（优先读 userData，回退内置）
 */
function readModelFile(targetKey) {
  const fileName = targetKey.replace(/_/g, '') + '.json'
  const userDir = getUserModelsDir()
  const userPath = path.join(userDir, fileName)
  if (fs.existsSync(userPath)) {
    return { path: userPath, data: JSON.parse(fs.readFileSync(userPath, 'utf-8')), source: 'user' }
  }
  const builtinDir = getBuiltinModelsDir()
  const builtinPath = path.join(builtinDir, fileName)
  if (fs.existsSync(builtinPath)) {
    return { path: builtinPath, data: JSON.parse(fs.readFileSync(builtinPath, 'utf-8')), source: 'builtin' }
  }
  return null
}

/**
 * 获取基座训练数据 CSV 路径
 */
function getBaseTrainingCsvPath() {
  const userDir = getUserModelsDir()
  const userCsv = path.join(userDir, 'real_training_data.csv')
  if (fs.existsSync(userCsv)) return userCsv

  const builtinDir = getBuiltinModelsDir()
  const builtinCsv = path.join(builtinDir, 'real_training_data.csv')
  if (fs.existsSync(builtinCsv)) return builtinCsv

  return null
}

// ============ 训练锁（审查 M4）============
let isTraining = false

// ============ 模型版本归档（审查 M3）============

/**
 * 生成版本号（时间戳格式）
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
 * 归档旧模型：训练前将当前模型复制到归档目录
 * @returns {string|null} 版本号，无模型时返回 null
 */
async function archiveCurrentModels() {
  const version = generateVersion()
  const archiveDir = path.join(getArchiveDir(), version)

  let hasAny = false
  for (const target of TARGET_NAMES) {
    const info = readModelFile(target.key)
    if (info && info.data.trees && info.data.trees.length > 0) {
      const destDir = path.dirname(archiveDir)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true })
      }
      const destPath = path.join(archiveDir, target.file)
      fs.copyFileSync(info.path, destPath)
      hasAny = true
    }
  }

  return hasAny ? version : null
}

/**
 * 列出所有归档版本
 */
function listArchiveVersions() {
  const archiveDir = getArchiveDir()
  if (!fs.existsSync(archiveDir)) return []

  const versions = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dirPath = path.join(archiveDir, d.name)
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'))
      // 尝试读模型指标
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
    .sort((a, b) => b.version.localeCompare(a.version)) // 最新在前

  return versions
}

/**
 * 回滚到指定版本（文件复制，审查 M3）
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
    const srcPath = path.join(archiveDir, file)
    const destPath = path.join(userDir, file)
    fs.copyFileSync(srcPath, destPath)
    console.log(`[Training] 回滚 ${file}: ${srcPath} → ${destPath}`)
  }

  // 清空预测缓存，让新模型生效
  XGBoostPredictionService.clearCache()

  return { success: true, version, files }
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

  // 取第一个有 trainingInfo 的模型作为代表
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

// ============ IPC 处理器 ============

function registerHandlers() {
  // ============ training:run ============
  ipcMain.handle('training:run', async (event, options = {}) => {
    console.log('[Training] training:run 被调用')

    // 训练锁检查（审查 M4）
    if (isTraining) {
      return { success: false, error: '训练进行中，请稍后' }
    }
    isTraining = true

    try {
      // 查找训练数据文件
      const csvPath = getBaseTrainingCsvPath()
      if (!csvPath) {
        return { success: false, error: '未找到训练数据文件 (real_training_data.csv)' }
      }

      // 确保用户模型目录存在
      const userModelDir = getUserModelsDir()
      if (!fs.existsSync(userModelDir)) {
        fs.mkdirSync(userModelDir, { recursive: true })
      }

      // 归档当前模型（训练前备份，审查 M3）
      const archivedVersion = await archiveCurrentModels()
      console.log(`[Training] 当前模型已归档: ${archivedVersion || '无模型可归档'}`)

      // 构建进度推送函数
      const sendProgress = (message) => {
        try {
          event.sender.send('training:progress', { message, timestamp: Date.now() })
        } catch (e) {
          // 渲染进程已断开时忽略
        }
      }

      sendProgress('准备训练...')

      // 调用 Worker Thread 训练（审查 N3）
      const results = await XGBoostTrainingService.trainWithWorker(
        {
          csvPath,
          outputDir: userModelDir,
          nTrials: options.nTrials ?? 50
        },
        (progressMsg) => {
          sendProgress(progressMsg)
        }
      )

      sendProgress('训练完成，正在更新模型缓存...')

      // 清空预测缓存，让新模型生效
      XGBoostPredictionService.clearCache()

      const modelVersion = generateVersion()
      console.log(`[Training] 训练完成, 模型版本: ${modelVersion}`)

      return {
        success: true,
        results,
        modelVersion,
        archivedVersion,
        reports: results.reports,
        summary: results.summary
      }
    } catch (error) {
      console.error('[Training] 训练失败:', error)
      return { success: false, error: error.message }
    } finally {
      isTraining = false // 无论成功失败都释放锁（审查 M4）
    }
  })

  // ============ training:getStatus ============
  ipcMain.handle('training:getStatus', async () => {
    return {
      isTraining,
      activeCount: XGBoostTrainingService.activeCount
    }
  })

  // ============ training:getInfo ============
  ipcMain.handle('training:getInfo', async () => {
    const models = getCurrentModelSummary()
    const summary = getModelStateSummary()
    const history = listArchiveVersions()

    // 获取试配数据条数（如果 TrialTestRecord 表已存在）
    let trialRecordCount = 0
    try {
      const { sequelize } = require('../db/database')
      const [result] = await sequelize.query(
        "SELECT COUNT(*) as count FROM trial_test_records"
      )
      trialRecordCount = result[0]?.count || 0
    } catch (e) {
      // 表不存在时返回 0
      trialRecordCount = 0
    }

    return {
      success: true,
      models,
      summary,
      history,
      trialRecordCount,
      csvPath: getBaseTrainingCsvPath()
    }
  })

  // ============ training:rollback ============
  ipcMain.handle('training:rollback', async (event, { version } = {}) => {
    console.log('[Training] training:rollback', version || '回滚到上一版本')

    try {
      let targetVersion = version

      if (!targetVersion) {
        // 未指定版本，回滚到最新归档
        const versions = listArchiveVersions()
        if (versions.length === 0) {
          return { success: false, error: '没有可回滚的历史版本' }
        }
        // 第一个就是最新版本
        targetVersion = versions[0].version
      }

      const result = rollbackToVersion(targetVersion)
      console.log(`[Training] 已回滚到版本: ${targetVersion}`)

      return { success: true, ...result }
    } catch (error) {
      console.error('[Training] 回滚失败:', error)
      return { success: false, error: error.message }
    }
  })

  // ============ training:previewArchivedMetrics ============
  ipcMain.handle('training:previewArchivedMetrics', async (event, { version }) => {
    try {
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
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  console.log('[Training] IPC 处理器已注册')
}

module.exports = { registerHandlers }

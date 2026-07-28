/**
 * ModelVersionManager.js
 * 模型版本管理器：归档旧模型 → 写入新模型 → 支持回滚和历史查询
 *
 * 文件布局：
 *   resources/models/
 *     strength28d.json          ← 当前生效模型
 *     density.json
 *     superplasticizerdosage.json
 *     archive/
 *       20260728_120000/        ← 每次 saveModel 生成的时间戳目录
 *         strength28d.json.vX.bak
 *         ...
 *       20260729_083000/
 *         ...
 *
 * 使用方式：
 *   const mvm = require('./ModelVersionManager')
 *   await mvm.saveModel('strength_28d', modelJson)
 *   await mvm.rollback('strength_28d')
 *   const versions = mvm.listVersions('strength_28d')
 */

const fs = require('fs')
const path = require('path')

/**
 * 获取模型目录路径（兼容开发模式和 Electron 打包模式）
 * 与 XGBoostPredictionService.getModelsDir 保持相同逻辑
 */
function getModelsDir() {
  const isPackaged = __dirname.includes('app.asar')
  if (isPackaged) {
    const asarPath = __dirname.split('app.asar')[0]
    return path.join(asarPath, 'app.asar.unpacked', 'resources', 'models')
  }
  return path.join(__dirname, '..', '..', '..', '..', 'resources', 'models')
}

// 目标名 → 文件名映射（与 XGBoostPredictionService.MODEL_FILES 保持一致）
const TARGET_FILE_MAP = {
  strength28d: 'strength28d.json',
  strength_28d: 'strength28d.json',
  density: 'density.json',
  superplasticizer_dosage: 'superplasticizerdosage.json',
  superplasticizerdosage: 'superplasticizerdosage.json'
}

class ModelVersionManager {
  constructor() {
    this._modelsDir = getModelsDir()
  }

  /**
   * 生成版本号：YYYYMMDD_HHMMSS
   * @returns {string}
   */
  generateVersion() {
    const now = new Date()
    const Y = now.getFullYear()
    const M = String(now.getMonth() + 1).padStart(2, '0')
    const D = String(now.getDate()).padStart(2, '0')
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    const s = String(now.getSeconds()).padStart(2, '0')
    return `${Y}${M}${D}_${h}${m}${s}`
  }

  /**
   * 获取目标对应的模型文件名
   * @param {string} targetName
   * @returns {string}
   */
  _getModelFilename(targetName) {
    const filename = TARGET_FILE_MAP[targetName]
    if (filename) return filename
    // 兜底：去掉下划线
    return `${String(targetName).replace(/_/g, '')}.json`
  }

  /**
   * 获取归档目录路径
   * @param {string} version
   * @returns {string}
   */
  _getArchiveDir(version) {
    return path.join(this._modelsDir, 'archive', version)
  }

  /**
   * 保存模型：归档旧模型 → 写入新模型
   *
   * @param {string} targetName - 目标名称（如 'strength_28d'）
   * @param {Object} modelJson - 模型 JSON 对象
   * @returns {{ version: string, path: string }}
   */
  async saveModel(targetName, modelJson) {
    const filename = this._getModelFilename(targetName)
    const modelPath = path.join(this._modelsDir, filename)
    const version = this.generateVersion()

    // 归档旧模型（如果存在）
    if (fs.existsSync(modelPath)) {
      const archiveDir = this._getArchiveDir(version)
      fs.mkdirSync(archiveDir, { recursive: true })

      const oldContent = fs.readFileSync(modelPath, 'utf-8')
      const oldVersion = this._extractVersion(oldContent)
      const archiveFilename = `${filename}.v${oldVersion}.bak`
      fs.writeFileSync(path.join(archiveDir, archiveFilename), oldContent)
    }

    // 写入新模型（注入版本号）
    modelJson.model_version = version
    modelJson.updated_at = new Date().toISOString()
    fs.writeFileSync(modelPath, JSON.stringify(modelJson, null, 2))

    return { version, path: modelPath }
  }

  /**
   * 从模型文件内容中提取版本号
   * @param {string} content
   * @returns {string}
   */
  _extractVersion(content) {
    try {
      const parsed = JSON.parse(content)
      return parsed.model_version || parsed.training_info?.version || 'unknown'
    } catch {
      return 'corrupted'
    }
  }

  /**
   * 回滚到上一个版本
   * 从最新归档复制回 models/ 目录
   *
   * @param {string} targetName
   * @returns {{ targetName: string, version: string, path: string }}
   */
  async rollback(targetName) {
    const filename = this._getModelFilename(targetName)
    const archives = this._listArchives(targetName, filename)

    if (archives.length === 0) {
      throw new Error(`没有找到 ${targetName} 的历史版本可供回滚`)
    }

    // 取最新归档
    const latest = archives[archives.length - 1]
    const content = fs.readFileSync(latest.path, 'utf-8')
    const modelPath = path.join(this._modelsDir, filename)
    fs.writeFileSync(modelPath, content)

    return {
      targetName,
      version: latest.version,
      path: modelPath
    }
  }

  /**
   * 列出目标模型的所有历史版本
   *
   * @param {string} targetName
   * @returns {{ currentVersion: string|null, archives: Array<{version: string, date: string, filename: string}> }}
   */
  listVersions(targetName) {
    const filename = this._getModelFilename(targetName)
    const modelPath = path.join(this._modelsDir, filename)

    // 获取当前版本
    let currentVersion = null
    if (fs.existsSync(modelPath)) {
      try {
        const content = fs.readFileSync(modelPath, 'utf-8')
        const model = JSON.parse(content)
        currentVersion = model.model_version || model.training_info?.version || null
      } catch {
        currentVersion = 'corrupted'
      }
    }

    // 列出归档
    const archives = this._listArchives(targetName, filename)

    return {
      currentVersion,
      archives: archives.map(a => ({
        version: a.version,
        date: a.date,
        filename: a.filename
      }))
    }
  }

  /**
   * 扫描 archive 目录，列出目标模型的所有归档文件
   * @private
   * @param {string} targetName
   * @param {string} filename
   * @returns {Array<{version: string, date: string, path: string, filename: string}>}
   */
  _listArchives(targetName, filename) {
    const archiveRoot = path.join(this._modelsDir, 'archive')
    if (!fs.existsSync(archiveRoot)) return []

    const versions = []
    let dirEntries
    try {
      dirEntries = fs.readdirSync(archiveRoot)
    } catch {
      return []
    }

    for (const dir of dirEntries) {
      const dirPath = path.join(archiveRoot, dir)
      let stat
      try {
        stat = fs.statSync(dirPath)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue

      let files
      try {
        files = fs.readdirSync(dirPath)
      } catch {
        continue
      }

      for (const file of files) {
        if (file.startsWith(filename) && file.endsWith('.bak')) {
          versions.push({
            version: dir,
            date: this._formatDateFromVersion(dir),
            path: path.join(dirPath, file),
            filename: file
          })
        }
      }
    }

    versions.sort((a, b) => a.version.localeCompare(b.version))
    return versions
  }

  /**
   * 将 YYYYMMDD_HHMMSS 格式转为可读日期
   * @private
   */
  _formatDateFromVersion(version) {
    // 匹配 YYYYMMDD_HHMMSS
    const m = version.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/)
    if (m) {
      return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
    }
    return version
  }
}

module.exports = new ModelVersionManager()

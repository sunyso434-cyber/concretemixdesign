/**
 * modelPaths.js
 * 模型路径与读取的唯一来源：训练与预测共用
 *
 * 关键约定：用户训练模型（userData/models）优先，内置模型（resources/models）回退。
 *
 * 修复历史 bug：训练把新模型写入 getUserModelsDir()，但 XGBoostPredictionService
 * 之前只从内置 resources/models 读取，导致训练后预测结果不变。
 * 统一后，训练与预测都走这里，用户训练结果才能真正生效。
 */

const fs = require('fs')
const path = require('path')

/**
 * 获取用户模型目录（userData/models/）
 * 非 Electron 环境兜底（复刻 db/database.js 模式），jest / node 直跑不崩
 */
function getUserModelsDir() {
  try {
    const { app } = require('electron')
    if (app && app.getPath) return path.join(app.getPath('userData'), 'models')
  } catch (e) {
    // 非 Electron 环境
  }
  const basePath = process.env.USER_DATA_PATH || process.env.APPDATA || path.join(process.cwd(), 'data')
  return path.join(basePath, 'concrete-mixdesign', 'models')
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
  return path.join(__dirname, '..', '..', '..', '..', 'resources', 'models')
}

/**
 * 读取模型文件：优先用户训练模型，回退内置
 * @param {string} targetKey 目标 key（如 'strength_28d'，会去掉下划线拼文件名）
 * @returns {{ path: string, data: Object, source: 'user'|'builtin' } | null}
 */
function readModelFile(targetKey) {
  const fileName = targetKey.replace(/_/g, '') + '.json'
  const userPath = path.join(getUserModelsDir(), fileName)
  if (fs.existsSync(userPath)) {
    return { path: userPath, data: JSON.parse(fs.readFileSync(userPath, 'utf-8')), source: 'user' }
  }
  const builtinPath = path.join(getBuiltinModelsDir(), fileName)
  if (fs.existsSync(builtinPath)) {
    return { path: builtinPath, data: JSON.parse(fs.readFileSync(builtinPath, 'utf-8')), source: 'builtin' }
  }
  return null
}

module.exports = {
  getUserModelsDir,
  getBuiltinModelsDir,
  readModelFile
}

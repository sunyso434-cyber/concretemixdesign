const { ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function isImageFile(filename) {
  if (!filename) return false
  const ext = path.extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function getPhotosDir() {
  const current = global.workspaceManager?.current()
  if (!current || !current.path) {
    return null
  }
  return path.join(current.path, 'photos')
}

class VisionHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // 上传图片到工作区 photos/ 目录
    ipcMain.handle('vision:upload', async (_event, { sourcePath, name }) => {
      try {
        if (!sourcePath) {
          return { success: false, error: '文件路径为空' }
        }

        const photosDir = getPhotosDir()
        if (!photosDir) {
          return { success: false, error: '请先打开工作区' }
        }

        // 校验文件类型
        const displayName = name || path.basename(sourcePath)
        if (!isImageFile(displayName)) {
          return { success: false, error: `不支持的文件类型：${path.extname(displayName)}（仅支持 jpg/jpeg/png/webp）` }
        }

        // 确保 photos 目录存在
        await fs.promises.mkdir(photosDir, { recursive: true })

        // 处理重名：若同名文件已存在，加时间戳后缀
        let destName = displayName
        let destPath = path.join(photosDir, destName)
        if (fs.existsSync(destPath)) {
          const ext = path.extname(displayName)
          const base = path.basename(displayName, ext)
          const ts = Date.now()
          destName = `${base}_${ts}${ext}`
          destPath = path.join(photosDir, destName)
        }

        await fs.promises.copyFile(sourcePath, destPath)
        console.log('[vision:upload] 图片已保存:', destPath)

        return { success: true, path: destPath, name: destName }
      } catch (err) {
        console.error('[vision:upload] 失败:', err.message)
        return { success: false, error: err.message }
      }
    })

    // 列出工作区 photos/ 目录下的图片文件
    ipcMain.handle('vision:list', async () => {
      try {
        const photosDir = getPhotosDir()
        if (!photosDir) {
          return { success: false, error: '请先打开工作区' }
        }

        // 确保 photos 目录存在
        await fs.promises.mkdir(photosDir, { recursive: true })

        const entries = await fs.promises.readdir(photosDir, { withFileTypes: true })
        const images = entries
          .filter(e => e.isFile() && isImageFile(e.name))
          .map(e => ({
            name: e.name,
            path: path.join(photosDir, e.name).replace(/\\/g, '/'),
            size: null  // size 可在后续按需补充
          }))
          // 按修改时间倒序（新的在前）
          .sort((a, b) => {
            try {
              const statA = fs.statSync(a.path)
              const statB = fs.statSync(b.path)
              return statB.mtimeMs - statA.mtimeMs
            } catch (_) { return 0 }
          })

        return { success: true, data: images }
      } catch (err) {
        console.error('[vision:list] 失败:', err.message)
        return { success: false, error: err.message }
      }
    })
  }
}

module.exports = new VisionHandler()

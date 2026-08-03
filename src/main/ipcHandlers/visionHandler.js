const { ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

// 上传图片统一存到工作区 raw/images/（老板 2026-08-02 决策：图片作为工作区原始素材，AI 知识库可索引）
const IMAGES_DIR_REL = path.join('raw', 'images')

function isImageFile(filename) {
  if (!filename) return false
  const ext = path.extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function getImagesDir() {
  const current = global.workspaceManager?.current()
  if (!current || !current.path) {
    return null
  }
  return path.join(current.path, IMAGES_DIR_REL)
}

/**
 * 确保图片目录存在，并处理重名（同名已存在 → 加时间戳后缀）。
 * 桌面 vision:upload 与远程 saveImageToWorkspace 共用，行为与抽取前一致。
 * @param {string} dir  图片目录绝对路径（<工作区>/raw/images）
 * @param {string} name 目标文件名
 * @returns {Promise<{ destName: string, destPath: string }>}
 */
async function prepareImagesDest(dir, name) {
  await fs.promises.mkdir(dir, { recursive: true })
  let destName = name
  let destPath = path.join(dir, destName)
  if (await fs.promises.access(destPath).then(() => true).catch(() => false)) {
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    const ts = Date.now()
    destName = `${base}_${ts}${ext}`
    destPath = path.join(dir, destName)
  }
  return { destName, destPath }
}

/**
 * 把图片 buffer 保存到工作区 raw/images/ 目录（远程图片上传 R9 复用）。
 * 与桌面 vision:upload 共用重名/目录逻辑，仅写入方式不同（buffer 写文件 vs 源文件 copy）。
 * @param {{ sourceBuffer: Buffer, name: string, workspacePath: string }} param
 * @returns {Promise<{ path: string, name: string }>} 保存后的绝对路径与文件名
 */
async function saveImageToWorkspace({ sourceBuffer, name, workspacePath }) {
  if (!sourceBuffer || !Buffer.isBuffer(sourceBuffer)) throw new Error('图片数据为空')
  if (!name || typeof name !== 'string') throw new Error('缺少文件名')
  if (!workspacePath) throw new Error('缺少工作区路径')
  const dir = path.join(workspacePath, IMAGES_DIR_REL)
  const { destName, destPath } = await prepareImagesDest(dir, name)
  await fs.promises.writeFile(destPath, sourceBuffer)
  return { path: destPath, name: destName }
}

class VisionHandler {
  constructor() {
    this.registerHandlers()
  }

  registerHandlers() {
    // 上传图片到工作区 raw/images/ 目录（老板 2026-08-02 决策：图片进原始素材区）
    // 支持两种数据来源：sourcePath（磁盘文件拷贝：选文件/拖拽）或 dataUrl（base64：剪贴板粘贴图）
    ipcMain.handle('vision:upload', async (_event, { sourcePath, name, dataUrl }) => {
      try {
        const imagesDir = getImagesDir()
        if (!imagesDir) {
          return { success: false, error: '请先打开工作区' }
        }

        // 校验文件类型
        const displayName = name || (sourcePath ? path.basename(sourcePath) : 'image.png')
        if (!isImageFile(displayName)) {
          return { success: false, error: `不支持的文件类型：${path.extname(displayName)}（仅支持 jpg/jpeg/png/webp）` }
        }

        // 确保图片目录存在 + 处理重名（复用共享 helper，行为与抽取前一致）
        const { destName, destPath } = await prepareImagesDest(imagesDir, displayName)

        if (dataUrl) {
          // 剪贴板粘贴图：解析 data:image/<type>;base64,<bytes> 前缀后写 buffer
          const m = /^data:[^;]+;base64,(.+)$/.exec(String(dataUrl))
          if (!m) {
            return { success: false, error: '图片数据格式错误' }
          }
          await fs.promises.writeFile(destPath, Buffer.from(m[1], 'base64'))
        } else if (sourcePath) {
          await fs.promises.copyFile(sourcePath, destPath)
        } else {
          return { success: false, error: '缺少图片数据（sourcePath 或 dataUrl）' }
        }
        console.log('[vision:upload] 图片已保存:', destPath)

        return { success: true, path: destPath, name: destName }
      } catch (err) {
        console.error('[vision:upload] 失败:', err.message)
        return { success: false, error: err.message }
      }
    })

    // 列出工作区 raw/images/ 目录下的图片文件
    ipcMain.handle('vision:list', async () => {
      try {
        const imagesDir = getImagesDir()
        if (!imagesDir) {
          return { success: false, error: '请先打开工作区' }
        }

        // 确保图片目录存在
        await fs.promises.mkdir(imagesDir, { recursive: true })

        const entries = await fs.promises.readdir(imagesDir, { withFileTypes: true })
        const images = entries
          .filter(e => e.isFile() && isImageFile(e.name))
          .map(e => ({
            name: e.name,
            path: path.join(imagesDir, e.name).replace(/\\/g, '/'),
            size: null  // size 可在后续按需补充
          }))

        // 批量异步获取 stat，避免 sort 回调中 sync I/O 阻塞事件循环
        const withStats = await Promise.all(
          images.map(async (img) => {
            try {
              const stat = await fs.promises.stat(img.path)
              return { ...img, mtimeMs: stat.mtimeMs }
            } catch (_) { return { ...img, mtimeMs: 0 } }
          })
        )
        withStats.sort((a, b) => b.mtimeMs - a.mtimeMs)

        return { success: true, data: withStats.map(({ mtimeMs, ...img }) => img) }
      } catch (err) {
        console.error('[vision:list] 失败:', err.message)
        return { success: false, error: err.message }
      }
    })
  }
}

const visionHandler = new VisionHandler()
// 共享保存函数：供桌面 vision:upload 与远程 RemoteImageApi 复用（R9 抽取）
visionHandler.saveImageToWorkspace = saveImageToWorkspace
module.exports = visionHandler

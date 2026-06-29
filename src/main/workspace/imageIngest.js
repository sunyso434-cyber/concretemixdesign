const fs = require('fs').promises
const fsSync = require('fs')
const path = require('path')
const crypto = require('crypto')
const { createError } = require('../agent/ErrorCodes')

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

const OCR_SYSTEM_PROMPT = '你是图像 OCR 助手。请提取图片中的所有文字，并简要描述图片内容。输出格式：\n\nOCR文本：\n<文字>\n\n描述：\n<描述>'

function isImageFile(filename) {
  if (!filename) return false
  const ext = path.extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function getCacheKey(imagePath) {
  const buf = fsSync.readFileSync(imagePath)
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  return hash
}

function getCachedDescription(imagePath, cacheDir) {
  try {
    const hash = getCacheKey(imagePath)
    const cacheFile = path.join(cacheDir, `${hash}.json`)
    if (!fsSync.existsSync(cacheFile)) return null
    // 校验 mtime
    const cachedMtime = fsSync.statSync(cacheFile).mtimeMs
    const imageMtime = fsSync.statSync(imagePath).mtimeMs
    if (imageMtime > cachedMtime) return null
    return JSON.parse(fsSync.readFileSync(cacheFile, 'utf-8'))
  } catch {
    return null
  }
}

function setCachedDescription(imagePath, data, cacheDir) {
  try {
    if (!fsSync.existsSync(cacheDir)) fsSync.mkdirSync(cacheDir, { recursive: true })
    const hash = getCacheKey(imagePath)
    const cacheFile = path.join(cacheDir, `${hash}.json`)
    fsSync.writeFileSync(cacheFile, JSON.stringify(data, null, 2))
  } catch (err) {
    console.warn('[imageIngest] setCachedDescription failed:', err.message)
  }
}

/**
 * 异步 ingest 单张图片
 * @param {object} args
 * @param {string} args.imagePath - 绝对路径
 * @param {string} args.cacheDir - 缓存目录
 * @param {object} args.visionService - VisionService 实例
 * @returns {Promise<{ocrText: string, description: string, imagePath: string, cachedAt: string}>}
 */
async function ingestImage({ imagePath, cacheDir, visionService }) {
  if (!visionService) throw createError('E-SYS-999', 'VisionService 不可用', '请稍后重试')

  // 读缓存
  const cached = getCachedDescription(imagePath, cacheDir)
  if (cached) return { ...cached, cachedAt: 'cache-hit' }

  // 读图转 base64
  const buf = await fs.readFile(imagePath)
  const ext = path.extname(imagePath).toLowerCase().slice(1) || 'jpeg'
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  const base64 = `data:${mime};base64,${buf.toString('base64')}`

  // 调视觉 API
  const result = await visionService.analyze({
    base64,
    systemPrompt: OCR_SYSTEM_PROMPT,
    userPrompt: '请提取 OCR 文本并描述图片内容'
  })

  // 解析响应
  const ocrMatch = result.content.match(/OCR文本[：:]\s*([\s\S]*?)(?=\n\n描述|$)/)
  const descMatch = result.content.match(/描述[：:]\s*([\s\S]*?)$/)
  const data = {
    ocrText: ocrMatch ? ocrMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : result.content,
    imagePath
  }

  // 写缓存
  setCachedDescription(imagePath, data, cacheDir)
  return { ...data, cachedAt: new Date().toISOString() }
}

module.exports = {
  isImageFile,
  getCachedDescription,
  setCachedDescription,
  ingestImage
}

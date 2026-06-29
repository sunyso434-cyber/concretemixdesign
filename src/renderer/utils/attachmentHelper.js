/**
 * 附件解析辅助函数
 * 用于检测消息中的配合比数据、处理上传的Excel和MD附件
 */

import { parseExcelFile, autoMatchMaterials } from '../pages/AIAnalysisPage_Upload'
import { getAllMaterials } from '../services/MaterialService'

/**
 * 根据文件扩展名判断附件类型
 * @param {string} filename
 * @returns {'xlsx'|'md'|'unsupported'|null}
 */
export const getAttachmentType = (filename) => {
  if (!filename) return null
  const ext = filename.split('.').pop()?.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (ext === 'md') return 'md'
  return 'unsupported'
}

/**
 * 检测用户消息是否明确要求进入分析模式
 * @param {string} text
 * @returns {boolean}
 */
export const detectAnalysisModeIntent = (text) => {
  if (!text) return false
  const patterns = [
    /使用分析模式/,
    /进入分析模式/,
    /开启分析模式/,
    /分析模式/,
  ]
  return patterns.some(p => p.test(text))
}

/**
 * 处理上传的Excel附件，返回配合比数据和材料映射
 * @param {File} file
 * @returns {Promise<{mixDesigns, materialMapping, unmatchedMaterials}>}
 */
export const processExcelAttachment = async (file) => {
  const mixDesigns = await parseExcelFile(file)
  const materials = await getAllMaterials()
  const { newMapping, unmatchedMaterials } = autoMatchMaterials(mixDesigns, materials)
  return { mixDesigns, materialMapping: newMapping, unmatchedMaterials }
}

/**
 * 仅保留「未自动匹配」条目所涉及的材料类型，用于材料选择器缩小候选项范围。
 * unmatchedMaterials 元素格式与 autoMatchMaterials 一致：`名称(类型)`
 * @param {Array<{id:number,type:string,name:string}>} allMaterials
 * @param {Set<string>|string[]} unmatchedMaterials
 * @returns {Array}
 */
export const filterMaterialsForUnmatched = (allMaterials, unmatchedMaterials) => {
  if (!allMaterials?.length) return []
  if (!unmatchedMaterials || (unmatchedMaterials.size === 0 && (!Array.isArray(unmatchedMaterials) || unmatchedMaterials.length === 0))) {
    return allMaterials
  }
  const entries = unmatchedMaterials instanceof Set ? [...unmatchedMaterials] : unmatchedMaterials
  const types = new Set()
  for (const entry of entries) {
    if (typeof entry !== 'string') continue
    const open = entry.lastIndexOf('(')
    const close = entry.lastIndexOf(')')
    if (open > 0 && close > open) {
      types.add(entry.slice(open + 1, close))
    }
  }
  if (types.size === 0) return allMaterials
  return allMaterials.filter(m => m?.type && types.has(m.type))
}

/**
 * 处理上传的MD附件，读取内容
 * @param {File} file
 * @returns {Promise<string>}
 */
export const processMarkdownAttachment = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.onload = (e) => resolve(e.target.result)
    reader.readAsText(file)
  })
}

/**
 * 压缩图片并转 base64
 * @param {File} file
 * @param {object} options - { maxDimension: number, quality: number, maxSizeMb: number }
 * @returns {Promise<{base64: string, sizeKB: number, originalName: string, width: number, height: number}>}
 */
export const processImageAttachment = async (file, options = {}) => {
  const maxDimension = options.maxDimension || 1024
  const quality = options.quality || 0.8
  const maxSizeMb = options.maxSizeMb || 10

  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`图片超过 ${maxSizeMb}MB，请压缩后再上传`)
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round(height * (maxDimension / width))
            width = maxDimension
          } else {
            width = Math.round(width * (maxDimension / height))
            height = maxDimension
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024)
        resolve({
          base64: dataUrl,
          sizeKB,
          originalName: file.name,
          width,
          height
        })
      }
      img.onerror = () => reject(new Error('图片格式不支持'))
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}
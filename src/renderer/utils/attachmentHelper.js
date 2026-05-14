/**
 * 附件解析辅助函数
 * 用于检测消息中的配合比数据、处理上传的Excel和MD附件
 */

import { parseExcelFile, autoMatchMaterials } from '../pages/AIAnalysisPage_Upload'
import { getAllMaterials } from '../services/MaterialService'

/**
 * 检测消息文本中是否包含配合比数据
 * 检测规则：
 * - 同时出现"水胶比"和"强度"关键词
 * - 或出现"配合比"关键词 + 数字模式
 * @param {string} text
 * @returns {boolean}
 */
export const detectMixDesignDataInText = (text) => {
  if (!text) return false
  const hasWaterBinder = /水胶比/.test(text)
  const hasStrength = /强度|R\d/.test(text)
  const hasMixDesign = /配合比/.test(text)
  const hasNumericPattern = /\d+\.\d+|\d+kg/.test(text)
  return (hasWaterBinder && hasStrength) || (hasMixDesign && hasNumericPattern)
}

/**
 * 根据文件扩展名判断附件类型
 * @param {string} filename
 * @returns {'xlsx'|'md'|'unsupported'|null}
 */
export const getAttachmentType = (filename) => {
  if (!filename) return null
  const ext = filename.split('.').pop()?.toLowerCase()
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
 * 处理上传的MD附件，读取内容
 * @param {File} file
 * @returns {Promise<string>}
 */
export const processMarkdownAttachment = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file)
  })
}
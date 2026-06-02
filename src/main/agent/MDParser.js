const fs = require('fs')
const path = require('path')
const matter = require('gray-matter')

class MDParser {
  constructor() {
    this.requiredFields = ['name', 'description']
    this.namePattern = /^[a-z0-9_]+$/
  }

  /**
   * 解析MD技能文件
   * @param {string} filePath - MD文件路径
   * @returns {object} 解析后的技能定义
   */
  parse(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8')
    const { data, content: body } = matter(content)

    // 验证必填字段
    this._validateRequiredFields(data, filePath)

    // 验证name格式
    this._validateName(data.name, filePath)

    // 提取占位符
    const placeholders = this._extractPlaceholders(body)

    return {
      name: data.name,
      description: data.description,
      category: data.category || 'custom',
      requiresConfirmation: data.requiresConfirmation || false,
      version: data.version || '1.0.0',
      parameters: data.parameters || {},
      body: body,
      placeholders: placeholders,
      filePath: filePath
    }
  }

  /**
   * 验证必填字段
   */
  _validateRequiredFields(data, filePath) {
    for (const field of this.requiredFields) {
      if (!data[field]) {
        throw new Error(`文件 ${filePath} 缺少${field}字段`)
      }
    }
  }

  /**
   * 验证name格式
   */
  _validateName(name, filePath) {
    if (!this.namePattern.test(name)) {
      throw new Error(`文件 ${filePath} 的name只能包含小写字母、数字和下划线`)
    }
  }

  /**
   * 提取正文中的{{param_name}}占位符
   */
  _extractPlaceholders(body) {
    const placeholders = []
    const regex = /\{\{(\w+)\}\}/g
    let match

    while ((match = regex.exec(body)) !== null) {
      if (!placeholders.includes(match[1])) {
        placeholders.push(match[1])
      }
    }

    return placeholders
  }

  /**
   * 批量解析目录下的所有MD文件
   */
  parseDirectory(dirPath) {
    const skills = []

    if (!fs.existsSync(dirPath)) {
      return skills
    }

    const files = fs.readdirSync(dirPath)

    for (const file of files) {
      if (file.endsWith('.md')) {
        try {
          const filePath = path.join(dirPath, file)
          const skill = this.parse(filePath)
          skills.push(skill)
        } catch (error) {
          console.error(`解析MD技能文件失败: ${file}`, error.message)
        }
      }
    }

    return skills
  }
}

module.exports = MDParser

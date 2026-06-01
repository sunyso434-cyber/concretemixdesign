/**
 * Skill 注册与发现中心
 * 自动扫描 skills 目录，统一管理所有 Skill
 */

const fs = require('fs')
const path = require('path')
const SchemaValidator = require('./SchemaValidator')

class SkillRegistry {
  constructor() {
    this._skills = new Map()
    this._validator = new SchemaValidator()
    this._builtinDir = path.join(__dirname, '../skills')
    this._userDir = path.join(
      require('os').homedir(),
      '.concrete-mixdesign',
      'skills'
    )
  }

  /**
   * 自动发现并加载所有 skills
   */
  async discover() {
    // 1. 加载内置 skills
    await this._loadFromDir(this._builtinDir, { builtin: true })

    // 2. 确保用户目录存在
    this._ensureUserDir()

    // 3. 加载用户自定义 skills
    await this._loadFromDir(this._userDir, { builtin: false })

    console.log(`[SkillRegistry] 已加载 ${this._skills.size} 个 skills: ${this.skillNames.join(', ')}`)
  }

  /**
   * 确保用户 skill 目录存在，如果不存在则创建并放入示例文件
   */
  _ensureUserDir() {
    if (!fs.existsSync(this._userDir)) {
      fs.mkdirSync(this._userDir, { recursive: true })
      console.log(`[SkillRegistry] 已创建用户 skill 目录: ${this._userDir}`)

      // 创建示例 skill 文件
      this._createSampleSkill()
    }
  }

  /**
   * 创建示例 skill 文件
   */
  _createSampleSkill() {
    const samplePath = path.join(this._userDir, 'example-skill.js')
    if (fs.existsSync(samplePath)) return

    const sampleContent = `/**
 * 示例 Skill - 自定义工具示例
 *
 * 使用方法：
 * 1. 复制此文件并重命名（如 my-tool.js）
 * 2. 修改 name、description、parameters
 * 3. 在 execute 函数中实现你的业务逻辑
 * 4. 重启应用，新工具会自动加载
 */

module.exports = {
  // ===== 元数据 =====
  name: 'my_custom_tool',
  description: '我的自定义工具描述',
  version: '1.0.0',
  category: 'custom',

  // ===== 参数定义 =====
  parameters: {
    input: {
      type: 'string',
      description: '输入参数说明',
      required: true
    },
    count: {
      type: 'number',
      description: '数量（可选）',
      required: false,
      min: 1,
      max: 100
    }
  },

  // ===== 执行逻辑 =====
  async execute(args, context) {
    const { input, count = 1 } = args
    const { logger } = context

    logger.info(\`执行自定义工具: input=\${input}, count=\${count}\`)

    // 在这里实现你的业务逻辑
    const result = {
      message: \`处理完成: \${input}\`,
      count
    }

    return {
      success: true,
      data: result
    }
  }
}
`

    try {
      fs.writeFileSync(samplePath, sampleContent, 'utf8')
      console.log(`[SkillRegistry] 已创建示例 skill: ${samplePath}`)
    } catch (error) {
      console.error('[SkillRegistry] 创建示例 skill 失败:', error.message)
    }
  }

  /**
   * 获取用户 skill 目录路径
   * @returns {string} 目录路径
   */
  getUserDir() {
    return this._userDir
  }

  /**
   * 获取所有用户自定义 skill 的信息
   * @returns {object[]} skill 信息列表
   */
  getUserSkills() {
    return Array.from(this._skills.values())
      .filter(skill => !skill._builtin)
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        version: skill.version || '1.0.0',
        filePath: skill._filePath
      }))
  }

  /**
   * 从目录加载 skills
   * @param {string} dir - 目录路径
   * @param {object} options - 选项
   */
  async _loadFromDir(dir, { builtin }) {
    if (!fs.existsSync(dir)) return

    const files = fs.readdirSync(dir)
    for (const file of files) {
      if (file.endsWith('.js')) {
        const skillPath = path.join(dir, file)
        try {
          const skill = require(skillPath)
          this.register(skill, { builtin, filePath: skillPath })
        } catch (error) {
          console.error(`[SkillRegistry] 加载 skill 失败: ${file}`, error.message)
        }
      }
    }
  }

  /**
   * 注册 skill
   * @param {object} skill - skill 定义
   * @param {object} options - 选项
   */
  register(skill, { builtin = true, filePath = null } = {}) {
    // 验证 skill 定义
    this._validateSkill(skill)

    // 标记元数据
    skill._builtin = builtin
    skill._filePath = filePath
    skill._registeredAt = new Date().toISOString()

    this._skills.set(skill.name, skill)
    return this
  }

  /**
   * 验证 skill 定义
   * @param {object} skill - skill 定义
   */
  _validateSkill(skill) {
    if (!skill.name) throw new Error('Skill 必须有 name')
    if (!skill.description) throw new Error('Skill 必须有 description')
    if (!skill.parameters) throw new Error('Skill 必须有 parameters')
    if (typeof skill.execute !== 'function') throw new Error('Skill 必须有 execute 函数')
  }

  /**
   * 获取所有 skill 的 JSON Schema (传给 LLM)
   * @returns {object[]} JSON Schema 数组
   */
  getToolSchemas() {
    return Array.from(this._skills.values()).map(skill => ({
      type: 'function',
      function: {
        name: skill.name,
        description: skill.description,
        parameters: {
          type: 'object',
          properties: this._validator.toJsonSchemaProperties(skill.parameters),
          required: this._validator.getRequiredParams(skill.parameters)
        }
      }
    }))
  }

  /**
   * 获取 skill
   * @param {string} name - skill 名称
   * @returns {object|null} skill 定义
   */
  getSkill(name) {
    return this._skills.get(name) || null
  }

  /**
   * 获取 skill 元数据
   * @param {string} name - skill 名称
   * @returns {object|null} 元数据
   */
  getSkillMeta(name) {
    const skill = this._skills.get(name)
    if (!skill) return null
    return {
      name: skill.name,
      description: skill.description,
      version: skill.version || '1.0.0',
      category: skill.category || 'general',
      builtin: skill._builtin,
      requiresConfirmation: skill.requiresConfirmation || false,
      registeredAt: skill._registeredAt
    }
  }

  /**
   * 获取所有 skill 名称
   * @returns {string[]} 名称列表
   */
  get skillNames() {
    return Array.from(this._skills.keys())
  }

  /**
   * 获取 skill 数量
   * @returns {number}
   */
  get size() {
    return this._skills.size
  }

  /**
   * 检查 skill 是否存在
   * @param {string} name - skill 名称
   * @returns {boolean}
   */
  has(name) {
    return this._skills.has(name)
  }
}

module.exports = SkillRegistry

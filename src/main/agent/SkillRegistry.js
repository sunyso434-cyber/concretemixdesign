/**
 * Skill 注册与发现中心
 * 自动扫描 skills 目录，统一管理所有 Skill
 */

const fs = require('fs')
const path = require('path')
const SchemaValidator = require('./SchemaValidator')
const MDParser = require('./MDParser')
const { wrapBlueprintAsSkill } = require('../skills/blueprint-loader')

/**
 * 常驻 skill 名称：始终加载进 tools，作为技能路由的兜底
 */
const RESIDENT_SKILL_NAMES = ['ask_user', 'todo_manage', 'web_search', 'web_fetch', 'recall_session']

/**
 * 关键词匹配停用词：不参与匹配的常见口语/虚词
 */
const KEYWORD_STOPWORDS = new Set([
  '的', '了', '吗', '吧', '和', '与', '请', '帮我', '一个', '什么',
  '我', '你', '是', '在', '有', '就', '要', '把', '被', '这', '那',
  '也', '都', '很', '不', '会', '能', '想', '给', '一下', '然后',
  '请问', '我想', '我要', '请你', '现在', '怎么', '如何', '可以', '需要'
])

class SkillRegistry {
  constructor(options = {}) {
    this._skills = new Map()
    this._validator = new SchemaValidator()
    this._builtinDir = path.join(__dirname, '../skills')
    this._userDir = options.userDir || path.join(
      require('os').homedir(),
      '.concrete-mixdesign',
      'skills'
    )
    this._mdParser = new MDParser()
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
      const filePath = path.join(dir, file)

      if (file.endsWith('.js')) {
        // JS格式技能（支持单技能对象或技能数组）
        try {
          const mod = require(filePath)
          const list = Array.isArray(mod) ? mod : [mod]
          for (const skill of list) {
            this.register(skill, { builtin, filePath })
          }
        } catch (error) {
          console.error(`[SkillRegistry] 加载 JS skill 失败: ${file}`, error.message)
        }
      } else if (file.endsWith('.md')) {
        // MD格式技能
        try {
          const skill = this._loadMDSkill(filePath)
          this.register(skill, { builtin, filePath })
        } catch (error) {
          console.error(`[SkillRegistry] 加载 MD skill 失败: ${file}`, error.message)
        }
      } else if (fs.statSync(filePath).isDirectory()) {
        // 蓝图技能：子目录中包含 blueprint.yaml
        const blueprintPath = path.join(filePath, 'blueprint.yaml')
        if (fs.existsSync(blueprintPath)) {
          try {
            const skill = wrapBlueprintAsSkill(filePath)
            this.register(skill, { builtin, filePath: blueprintPath })
          } catch (error) {
            console.error(`[SkillRegistry] 加载 blueprint skill 失败: ${file}`, error.message)
          }
        }
      }
    }
  }

  /**
   * 加载MD格式技能
   * @param {string} filePath - MD文件路径
   * @returns {object} 技能定义
   */
  _loadMDSkill(filePath) {
    const parsed = this._mdParser.parse(filePath)

    // trigger_mode：缺失走 silent default 'function'；非法值才 warn + 降级
    let triggerMode
    if (parsed.triggerMode === undefined) {
      triggerMode = 'function'
    } else if (['function', 'soft'].includes(parsed.triggerMode)) {
      triggerMode = parsed.triggerMode
    } else {
      console.warn(
        `[SkillRegistry] invalid trigger_mode "${parsed.triggerMode}" in ${filePath}, defaulting to "function"`
      )
      triggerMode = 'function'
    }

    // MD技能不需要execute函数，但需要标记为MD技能
    return {
      name: parsed.name,
      description: parsed.description,
      parameters: parsed.parameters,
      // 不需要execute函数
      version: parsed.version,
      category: parsed.category,
      _isMDSkill: true,
      _mdBody: parsed.body,
      _placeholders: parsed.placeholders,
      _triggerMode: triggerMode,
      _filePath: filePath
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

    // MD技能不需要execute函数
    if (!skill._isMDSkill) {
      if (typeof skill.execute !== 'function') throw new Error('JS Skill 必须有 execute 函数')
    }
  }

  /**
   * 单个 skill 转 JSON Schema (传给 LLM)
   * getToolSchemas / getRelevantToolSchemas 共用，避免重复实现
   * @param {object} skill - skill 定义
   * @returns {object} JSON Schema
   */
  _skillToToolSchema(skill) {
    return {
      type: 'function',
      function: {
        name: skill.name,
        description: skill.description,
        parameters: {
          type: 'object',
          properties: this._validator.toJsonSchemaProperties(skill.parameters),
          required: this._validator.getRequiredParams(skill.parameters || {})
        }
      }
    }
  }

  /**
   * 获取所有 skill 的 JSON Schema (传给 LLM)
   * @returns {object[]} JSON Schema 数组
   */
  getToolSchemas() {
    return Array.from(this._skills.values())
      .filter(skill => !skill._isMDSkill || skill._triggerMode !== 'soft')
      .map(skill => this._skillToToolSchema(skill))
  }

  /**
   * 按需加载：只返回常驻 + todo 指定 + 关键词匹配的 skill schema（技能路由）
   *
   * - 常驻 skill（存在才加入，缺失容错）
   * - todo 指定：planSteps 里每步的 suggestedSkill / skill
   * - 关键词匹配：recentMessages + planSteps.content 抽取关键词，命中 skill 的 name/description
   * 输出与 getToolSchemas 相同的 JSON-Schema 形状，按注册顺序去重
   *
   * @param {string} sessionId - 会话 id（预留，暂不参与筛选）
   * @param {Array<string|object>} recentMessages - 近期消息（字符串或含 content 的对象）
   * @param {Array<object>} planSteps - 计划步骤（可含 suggestedSkill / skill / content）
   * @returns {object[]} JSON Schema 数组
   */
  getRelevantToolSchemas(sessionId, recentMessages, planSteps) {
    const relevantNames = new Set()

    // 1. 常驻 skill：存在才加入（缺失容错）
    for (const name of RESIDENT_SKILL_NAMES) {
      if (this._skills.has(name)) relevantNames.add(name)
    }

    // 2. todo 指定 + todo 内容关键词素材
    const todoTexts = []
    if (Array.isArray(planSteps)) {
      for (const step of planSteps) {
        if (!step || typeof step !== 'object') continue
        const name = step.suggestedSkill || step.skill
        if (name) relevantNames.add(name)
        if (step.content) todoTexts.push(step.content)
      }
    }

    // 3. 关键词匹配（用户近期消息 + todo 内容）
    const keywords = this._extractKeywords(recentMessages).concat(this._extractKeywords(todoTexts))
    if (keywords.length > 0) {
      for (const skill of this._skills.values()) {
        if (relevantNames.has(skill.name)) continue
        if (skill._isMDSkill && skill._triggerMode === 'soft') continue
        if (this._matchesKeywords(skill, keywords)) relevantNames.add(skill.name)
      }
    }

    // 4. 复用 schema 构建逻辑，按注册顺序去重输出
    return Array.from(this._skills.values())
      .filter(skill => relevantNames.has(skill.name))
      .filter(skill => !skill._isMDSkill || skill._triggerMode !== 'soft')
      .map(skill => this._skillToToolSchema(skill))
  }

  /**
   * 从消息列表中抽取关键词（简单健壮版）
   *
   * - 按非中英文/非数字切分
   * - 丢弃长度 < 2 的 token 与停用词
   * - 中文连续片段生成重叠二元组（如"水泥强度" → 水泥/泥强/强度），提高召回
   *
   * @param {Array<string|object>} messages - 消息列表（字符串或含 content 的对象）
   * @returns {string[]} 去重后的关键词数组
   */
  _extractKeywords(messages) {
    const keywords = new Set()
    const items = Array.isArray(messages) ? messages : []
    for (const item of items) {
      const text = String(typeof item === 'string' ? item : (item && item.content) || '')
      const segments = text.split(/[^0-9a-zA-Z一-龥]+/).filter(Boolean)
      for (let segment of segments) {
        segment = segment.toLowerCase()
        if (segment.length < 2) continue
        if (KEYWORD_STOPWORDS.has(segment)) continue
        if (/[一-龥]/.test(segment)) {
          // 中文连续片段：生成重叠二元组
          for (let i = 0; i + 1 < segment.length; i++) {
            const bigram = segment.slice(i, i + 2)
            if (!KEYWORD_STOPWORDS.has(bigram)) keywords.add(bigram)
          }
        } else {
          keywords.add(segment)
        }
      }
    }
    return Array.from(keywords)
  }

  /**
   * 判断 skill 是否被任一关键词命中（name 或 description 包含关键词）
   * @param {object} skill - skill 定义
   * @param {string[]} keywords - 关键词数组
   * @returns {boolean} 是否命中
   */
  _matchesKeywords(skill, keywords) {
    if (!keywords || keywords.length === 0) return false
    const name = (skill.name || '').toLowerCase()
    const desc = (skill.description || '').toLowerCase()
    return keywords.some(kw => name.includes(kw) || desc.includes(kw))
  }

  /**
   * 列出所有 triggerMode=soft 的 skill（用于 system-prompt 注入）
   * @returns {Array<{name, description, version, category}>}
   */
  listSoftSkills() {
    return Array.from(this._skills.values())
      .filter(s => s._triggerMode === 'soft')
      .map(s => ({
        name: s.name,
        description: s.description,
        version: s.version,
        category: s.category
      }))
  }

  /**
   * 判断指定 skill 是否为 soft trigger
   * @param {string} skillName
   * @returns {boolean}
   */
  isSoftTrigger(skillName) {
    const skill = this._skills.get(skillName)
    return skill ? skill._triggerMode === 'soft' : false
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

  /**
   * 获取所有 skills 的快照 Map（防止外部直接修改内部状态）
   * @returns {Map<string, object>}
   */
  getUserSkillsMap() {
    return new Map(this._skills)
  }

  /**
   * 注销一个 skill
   * @param {string} name - skill 名称
   */
  unregister(name) {
    this._skills.delete(name)
  }

  /**
   * 清空所有 skills
   */
  reset() {
    this._skills.clear()
  }
}

module.exports = SkillRegistry

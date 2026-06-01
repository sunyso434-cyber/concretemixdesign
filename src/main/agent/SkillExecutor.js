/**
 * Skill 执行引擎
 * 统一的 Skill 执行入口，包含参数验证、错误标准化、上下文注入
 */

const SchemaValidator = require('./SchemaValidator')
const ErrorCodes = require('./ErrorCodes')

class SkillExecutor {
  /**
   * @param {object} options
   * @param {import('./SkillRegistry')} options.skillRegistry - Skill 注册表
   * @param {import('./ContextProvider')} options.contextProvider - 上下文提供者
   */
  constructor({ skillRegistry, contextProvider }) {
    this.registry = skillRegistry
    this.contextProvider = contextProvider
    this.validator = new SchemaValidator()
  }

  /**
   * 执行 Skill
   * @param {string} skillName - Skill 名称
   * @param {object} args - 参数
   * @returns {object} 执行结果
   */
  async execute(skillName, args) {
    // 1. 查找 Skill
    const skill = this.registry.getSkill(skillName)
    if (!skill) {
      return ErrorCodes.createError(
        ErrorCodes.SKILL_NOT_FOUND,
        `Skill "${skillName}" 不存在`,
        `可用的 skills: ${this.registry.skillNames.join(', ')}`
      )
    }

    // 2. 参数验证
    const validation = this.validator.validate(args, skill.parameters)
    if (!validation.valid) {
      return ErrorCodes.createError(
        validation.errorCode,
        validation.errorMessage,
        validation.hint,
        validation.details
      )
    }

    // 3. 获取上下文
    const context = this.contextProvider.getForSkill(skillName)

    // 4. 执行
    try {
      const startTime = Date.now()
      const result = await skill.execute(args, context)
      const duration = Date.now() - startTime

      // 5. 标准化返回格式
      const normalized = this._normalizeResult(result, skill)

      // 添加执行元数据
      if (normalized.success) {
        normalized._meta = {
          skill: skillName,
          duration,
          timestamp: new Date().toISOString()
        }
      }

      return normalized
    } catch (error) {
      // 6. 错误标准化
      return this._handleError(error, skill)
    }
  }

  /**
   * 标准化返回结果
   * @param {*} result - 原始结果
   * @param {object} skill - Skill 定义
   * @returns {object} 标准化结果
   */
  _normalizeResult(result, skill) {
    // 如果已经是标准格式，直接使用
    if (result && typeof result === 'object' && 'success' in result) {
      return result
    }
    // 否则包装成标准格式
    return { success: true, data: result }
  }

  /**
   * 处理执行错误
   * @param {Error} error - 错误对象
   * @param {object} skill - Skill 定义
   * @returns {object} 标准错误响应
   */
  _handleError(error, skill) {
    // 检查是否是已知的业务错误
    if (error.code && ErrorCodes[error.code]) {
      return ErrorCodes.createError(
        error.code,
        error.message,
        error.hint || '请检查输入参数',
        error.details
      )
    }

    // 检查 Skill 自定义的错误处理
    if (skill.errors) {
      for (const [key, errorDef] of Object.entries(skill.errors)) {
        if (error.message?.includes(errorDef.code) || error.message?.includes(key)) {
          return ErrorCodes.createError(
            errorDef.code,
            errorDef.message,
            errorDef.hint,
            { originalError: error.message }
          )
        }
      }
    }

    // 默认错误处理
    console.error(`[SkillExecutor] Skill "${skill.name}" 执行异常:`, error)
    return ErrorCodes.createError(
      ErrorCodes.UNKNOWN,
      `Skill "${skill.name}" 执行失败: ${error.message}`,
      '请检查输入参数或联系开发者',
      { originalError: error.message, stack: error.stack }
    )
  }

  /**
   * 获取所有可用的 Skill 列表 (给 LLM 用)
   * @returns {object[]} Skill 摘要列表
   */
  listSkills() {
    return Array.from(this.registry._skills.values()).map(skill => ({
      name: skill.name,
      description: skill.description,
      version: skill.version || '1.0.0',
      category: skill.category || 'general',
      builtin: skill._builtin
    }))
  }
}

module.exports = SkillExecutor

/**
 * 技能调试器
 * 预览生成的指令，单步执行，帮助用户调试MD技能
 */

const { buildMDInstruction } = require('./mdInstructionBuilder')

class SkillDebugger {
  constructor({ skillRegistry, skillExecutor, deepseekService }) {
    this.registry = skillRegistry
    this.executor = skillExecutor
    this.ds = deepseekService
  }

  /**
   * 预览MD技能的执行指令
   * @param {string} skillName - 技能名称
   * @param {object} args - 用户参数
   * @returns {object} 预览结果
   */
  previewInstruction(skillName, args) {
    const skill = this.registry.getSkill(skillName)

    if (!skill) {
      return {
        success: false,
        error: `技能 ${skillName} 不存在`
      }
    }

    if (!skill._isMDSkill) {
      return {
        success: false,
        error: `技能 ${skillName} 不是MD技能，无法预览指令`
      }
    }

    // 构建指令（改用纯函数，不再依赖 AgentOrchestrator）
    const instruction = buildMDInstruction(skill, args)

    return {
      success: true,
      data: {
        skillName: skill.name,
        description: skill.description,
        args: args,
        instruction: instruction,
        mdBody: skill._mdBody,
        placeholders: skill._placeholders
      }
    }
  }

  /**
   * 验证MD技能文件格式
   * @param {string} skillName - 技能名称
   * @returns {object} 验证结果
   */
  validateSkill(skillName) {
    const skill = this.registry.getSkill(skillName)

    if (!skill) {
      return {
        success: false,
        error: `技能 ${skillName} 不存在`
      }
    }

    if (!skill._isMDSkill) {
      return {
        success: false,
        error: `技能 ${skillName} 不是MD技能`
      }
    }

    const issues = []

    // 检查必填字段
    if (!skill.description) {
      issues.push({ field: 'description', message: '缺少description字段' })
    }

    // 检查参数定义
    if (skill.parameters) {
      for (const [name, param] of Object.entries(skill.parameters)) {
        if (!param.type) {
          issues.push({ field: `parameters.${name}.type`, message: `参数 ${name} 缺少type字段` })
        }
        if (!param.description) {
          issues.push({ field: `parameters.${name}.description`, message: `参数 ${name} 缺少description字段` })
        }
      }
    }

    // 检查占位符是否都有对应的参数定义
    if (skill._placeholders) {
      for (const placeholder of skill._placeholders) {
        if (!skill.parameters || !skill.parameters[placeholder]) {
          issues.push({ field: `body`, message: `占位符 {{${placeholder}}} 没有对应的参数定义` })
        }
      }
    }

    return {
      success: true,
      data: {
        skillName: skill.name,
        description: skill.description,
        isMD: true,
        parameters: skill.parameters,
        placeholders: skill._placeholders,
        issues: issues,
        valid: issues.length === 0
      }
    }
  }

  /**
   * 列出所有MD技能
   * @returns {object} MD技能列表
   */
  listMDSkills() {
    const mdSkills = []

    for (const [name, skill] of this.registry._skills) {
      if (skill._isMDSkill) {
        mdSkills.push({
          name: skill.name,
          description: skill.description,
          parameters: skill.parameters,
          placeholders: skill._placeholders
        })
      }
    }

    return {
      success: true,
      data: {
        count: mdSkills.length,
        skills: mdSkills
      }
    }
  }
}

module.exports = SkillDebugger

/**
 * 创建技能 Skill
 * 让用户通过对话方式创建自定义 Skill
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  name: 'create_skill',
  description: '创建新的自定义技能。当用户想要增加新功能、创建自定义工具、或扩展AI能力时调用。例如"我想加一个自密实混凝土配合比设计的功能"、"帮我创建一个XX工具"。',
  version: '1.0.0',
  category: 'system',

  parameters: {
    skillName: {
      type: 'string',
      description: '技能名称（英文，用下划线分隔），如 scc_mix_design',
      required: true
    },
    description: {
      type: 'string',
      description: '技能描述，AI会根据这个描述决定何时调用此技能',
      required: true
    },
    functionality: {
      type: 'string',
      description: '功能详细描述，包括输入参数、处理逻辑、输出结果。不填则使用 description',
      required: false
    },
    parameters: {
      type: 'object',
      description: '技能参数定义，格式为 { paramName: { type, description, required, min?, max?, enum? } }',
      required: false
    },
    executeCode: {
      type: 'string',
      description: 'execute 函数的完整函数体代码（JavaScript）。必须包含完整的业务逻辑，不能留 TODO。可以使用 context 中的 materialService、mixDesignService、knowledgeService 等服务，以及 args 中的参数。示例："const { strength } = args; const materials = await context.materialService.getAllMaterials(); return { success: true, data: materials }"',
      required: true
    },
    exampleUsage: {
      type: 'string',
      description: '使用示例，如"用户说：设计一个C40自密实混凝土，坍落度650mm"',
      required: false
    }
  },

  errors: {
    NAME_EXISTS: {
      code: 'SKILL_VALIDATION_FAILED',
      message: '技能名称已存在',
      hint: '请使用不同的技能名称',
      recovery: 'change_name'
    },
    CREATE_FAILED: {
      code: 'SKILL_LOAD_FAILED',
      message: '创建技能失败',
      hint: '请检查参数是否正确',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { skillName, description, functionality, parameters, executeCode, exampleUsage } = args
    const { logger } = context

    // functionality 不填时降级用 description
    const effectiveFunctionality = functionality || description || '自定义技能'

    logger.info(`创建技能: ${skillName}`)

    // 检查技能名是否已存在
    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')
    const filePath = path.join(userDir, `${skillName}.js`)

    if (fs.existsSync(filePath)) {
      return { success: false, error: this.errors.NAME_EXISTS, details: { skillName } }
    }

    // 确保目录存在
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true })
    }

    // 生成参数定义
    const paramsCode = this._generateParameters(parameters || {})

    // 生成技能代码（executeCode 为必填，使用完整实现）
    const skillCode = this._generateSkillCode({
      skillName,
      description,
      functionality: effectiveFunctionality,
      paramsCode,
      executeCode,
      exampleUsage
    })

    try {
      // 写入文件
      fs.writeFileSync(filePath, skillCode, 'utf8')
      logger.info(`技能文件已创建: ${filePath}`)

      // 重新加载技能
      const { getSkillRegistry } = require('../ipcHandlers/agentHandler')
      const registry = getSkillRegistry()
      if (registry) {
        // 清除旧的并重新加载
        registry._skills.delete(skillName)
        await registry.discover()
        logger.info(`技能已重新加载，当前共 ${registry.size} 个技能`)
      }

      return {
        success: true,
        type: 'skill_created',
        data: {
          skillName,
          filePath,
          description
        },
        message: `技能 "${skillName}" 已创建成功！文件保存在:\n${filePath}\n\n技能已自动加载，可以直接使用。`,
        suggestions: [
          `试试调用 ${skillName} 测试一下`,
          '需要修改这个技能吗？',
          '还要创建其他技能吗？'
        ]
      }
    } catch (error) {
      logger.error('创建技能失败:', error)
      return {
        success: false,
        error: this.errors.CREATE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  /**
   * 生成参数定义代码
   */
  _generateParameters(params) {
    if (!params || Object.keys(params).length === 0) {
      return `{
    // 在这里定义参数
    // input: {
    //   type: 'string',
    //   description: '输入参数说明',
    //   required: true
    // }
  }`
    }

    const entries = Object.entries(params).map(([key, def]) => {
      const parts = [`    ${key}: {`]
      parts.push(`      type: '${def.type || 'string'}',`)
      parts.push(`      description: '${def.description || key}',`)
      parts.push(`      required: ${def.required !== false}`)
      if (def.min !== undefined) parts.push(`      min: ${def.min},`)
      if (def.max !== undefined) parts.push(`      max: ${def.max},`)
      if (def.enum) parts.push(`      enum: ${JSON.stringify(def.enum)},`)
      parts.push('    }')
      return parts.join('\n')
    })

    return `{\n${entries.join(',\n')}\n  }`
  },

  /**
   * 生成技能代码
   */
  _generateSkillCode({ skillName, description, functionality, paramsCode, executeCode, exampleUsage }) {
    // 对 executeCode 中的单引号和反引号进行转义，防止注入
    const safeCode = (executeCode || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

    return `/**
 * ${description}
 *
 * 功能说明：${functionality}
 * ${exampleUsage ? `使用示例：${exampleUsage}` : ''}
 */

module.exports = {
  name: '${skillName}',
  description: '${description}',
  version: '1.0.0',
  category: 'custom',

  parameters: ${paramsCode},

  async execute(args, context) {
    const { logger } = context
    logger.info('执行 ${skillName}:', args)

    try {
      ${safeCode}
    } catch (error) {
      logger.error('${skillName} 执行失败:', error)
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: '执行失败: ' + error.message,
          hint: '请检查输入参数或联系开发者'
        }
      }
    }
  }
}
`
  }
}

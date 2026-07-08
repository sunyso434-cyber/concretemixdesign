/**
 * 创建技能 Skill
 * 让用户通过对话方式创建自定义 Skill
 *
 * 支持两种格式：
 * - md：纯声明式，直接根据参数生成 MD 文件（无需 LLM）
 * - blueprint：由主 agent 直接生成完整蓝图 YAML 并通过 rawBlueprint 参数传入，
 *              本技能只负责解析、校验、试算、落盘。
 *              主 agent 在生成 rawBlueprint 前应先调用 prepare_blueprint_authoring
 *              获取蓝图创作规范。
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
// v10.2.0：复用 blueprint-utils 解析 rawBlueprint（与 manage_skills 共享）
const blueprintUtils = require('./blueprint-utils')

module.exports = {
  name: 'create_skill',
  description: '创建新的自定义技能。仅当用户明确说"创建/添加/新建一个技能/工具"，且确认没有功能重复的已有技能时才调用。调用前先用 manage_skills(list) 检查已有技能列表。若创建蓝图（blueprint）技能，请先调用 prepare_blueprint_authoring 获取创作规范并在本次对话中生成 rawBlueprint 内容。',
  version: '2.0.0',
  category: 'system',

  parameters: {
    type: {
      type: 'string',
      description: '资产类型：tool 或 skill。tool 走 function call；skill 走 description 触发 + body 注入',
      required: true,
      enum: ['tool', 'skill']
    },
    subType: {
      type: 'string',
      description: 'tool 类型：md（默认）或 blueprint',
      required: false,
      enum: ['md', 'blueprint'],
      default: 'md'
    },
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
    exampleUsage: {
      type: 'string',
      description: '使用示例，如"用户说：设计一个C40自密实混凝土，坍落度650mm"',
      required: false
    },
    rawBlueprint: {
      type: 'string',
      description: 'type=tool + subType=blueprint 时必填。完整的蓝图技能包内容，使用分段格式：=== meta.yaml === / === blueprint.yaml === / === tables/<表名>.json ===。生成前请先调用 prepare_blueprint_authoring 获取创作规范。',
      required: false
    }
  },

  errors: {
    E_LEGACY_FORMAT: {
      code: 'E_LEGACY_FORMAT',
      message: '参数 format 已废弃，请改用 type/subType',
      hint: '老调用 create_skill(format="md", ...) 改为 create_skill(type="tool", subType="md", ...)',
      recovery: 'use_type_subtype'
    },
    NAME_EXISTS: {
      code: 'SKILL_VALIDATION_FAILED',
      // v10.2.0 方案 5：引导 AI 用 manage_skills update 而不是换名字
      message: '技能名称已存在',
      hint: '如需修改/升级已有技能，请改用 manage_skills(action="update", skillName="<name>", rawBlueprint=...)（支持 rawBlueprint / patch / jsonPatch / content 4 种粒度）。不要换名字重建，会丢失现有数据。',
      recovery: 'use_manage_skills_update'
    },
    CREATE_FAILED: {
      code: 'SKILL_LOAD_FAILED',
      message: '创建技能失败',
      hint: '请检查参数是否正确',
      recovery: 'retry'
    },
    MISSING_RAW_BLUEPRINT: {
      code: 'SKILL_VALIDATION_FAILED',
      message: '创建蓝图技能时缺少 rawBlueprint 参数',
      hint: '请先调用 prepare_blueprint_authoring 获取蓝图创作规范，在本对话中生成完整蓝图内容后，再调用 create_skill 时通过 rawBlueprint 参数传入。',
      recovery: 'call_prepare_blueprint_authoring_first'
    },
    BLUEPRINT_PARSE_FAILED: {
      code: 'SKILL_VALIDATION_FAILED',
      message: '蓝图内容无法解析',
      hint: 'rawBlueprint 必须包含 === meta.yaml === 和 === blueprint.yaml === 分段，且内容为合法的 YAML',
      recovery: 'fix_raw_blueprint'
    },
    BLUEPRINT_VALIDATE_FAILED: {
      code: 'SKILL_VALIDATION_FAILED',
      message: '蓝图语法校验失败',
      hint: '请根据错误详情修正蓝图，特别注意：formula.var 不得出现在 expr 中；material 的 category/property 必须在白名单内',
      recovery: 'fix_raw_blueprint'
    }
  },

  async execute(args, context) {
    // 兼容老 format 参数
    if (args.format && !args.type) {
      return { success: false, error: this.errors.E_LEGACY_FORMAT }
    }

    const { type, subType = 'md', skillName, description, functionality, parameters, exampleUsage, rawBlueprint } = args
    const { logger } = context

    const validTypes = ['tool', 'skill']
    if (!validTypes.includes(type)) {
      return {
        success: false,
        error: {
          code: 'E_PARAM_INVALID',
          message: `不支持的 type: ${type}。必须是 tool 或 skill`,
          hint: 'tool 走 function call；skill 走 description 触发 + body 注入',
          recovery: 'change_type'
        }
      }
    }

    const effectiveFunctionality = functionality || description || '自定义技能'

    logger.info(`创建技能: ${skillName}, type: ${type}, subType: ${subType}`)

    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true })
    }

    if (type === 'skill') {
      return await this._createMDSoftSkill(args, context, userDir)
    }
    if (type === 'tool' && subType === 'md') {
      return await this._createMDSkill(args, context, userDir, effectiveFunctionality)
    }
    if (type === 'tool' && subType === 'blueprint') {
      return await this._createBlueprintSkill(
        { skillName, description, rawBlueprint },
        context,
        userDir
      )
    }

    return {
      success: false,
      error: {
        code: 'E_PARAM_INVALID',
        message: `不支持的组合: type=${type} subType=${subType}`
      }
    }
  },

  /**
   * 创建MD格式技能
   */
  async _createMDSkill(args, context, userDir, effectiveFunctionality) {
    const { skillName, description, parameters, exampleUsage } = args
    const { logger } = context

    const filePath = path.join(userDir, `${skillName}.md`)

    if (fs.existsSync(filePath)) {
      return { success: false, error: this.errors.NAME_EXISTS, details: { skillName } }
    }

    const mdContent = this._generateMDContent({
      skillName,
      description,
      functionality: effectiveFunctionality,
      parameters,
      exampleUsage
    })

    try {
      fs.writeFileSync(filePath, mdContent, 'utf8')
      logger.info(`MD技能文件已创建: ${filePath}`)

      const { getSkillRegistry } = require('../ipcHandlers/agentHandler')
      const registry = getSkillRegistry()
      if (registry) {
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
          description,
          format: 'md'
        },
        message: `MD技能 "${skillName}" 已创建成功！文件保存在:\n${filePath}\n\n技能已自动加载，可以直接使用。`,
        suggestions: [
          `试试调用 ${skillName} 测试一下`,
          '需要修改这个技能吗？',
          '还要创建其他技能吗？'
        ]
      }
    } catch (error) {
      logger.error('创建MD技能失败:', error)
      return {
        success: false,
        error: this.errors.CREATE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  /**
   * 创建软触发 Skill（method skill）
   * type=skill 时强制 trigger_mode=soft
   */
  async _createMDSoftSkill(args, context, userDir) {
    const { skillName, description, functionality, parameters, exampleUsage } = args
    const { logger } = context

    const filePath = path.join(userDir, `${skillName}.md`)
    if (fs.existsSync(filePath)) {
      return { success: false, error: this.errors.NAME_EXISTS, details: { skillName } }
    }

    const mdContent = this._generateMDContent({
      skillName,
      description,
      functionality: functionality || description,
      parameters,
      exampleUsage,
      triggerMode: 'soft'  // 强制 soft
    })

    try {
      fs.writeFileSync(filePath, mdContent, 'utf8')
      logger.info(`Soft skill 已创建: ${filePath}`)

      const { getSkillRegistry } = require('../ipcHandlers/agentHandler')
      const registry = getSkillRegistry()
      if (registry) {
        registry._skills.delete(skillName)
        await registry.discover()
      }

      return {
        success: true,
        type: 'skill_created',
        data: { skillName, filePath, description, type: 'skill', triggerMode: 'soft' },
        message: `方法论 Skill "${skillName}" 已创建（trigger_mode=soft）。`
      }
    } catch (error) {
      return { success: false, error: this.errors.CREATE_FAILED, details: { originalError: error.message } }
    }
  },

  /**
   * 生成MD内容
   */
  _generateMDContent({ skillName, description, functionality, parameters, exampleUsage, triggerMode = 'function' }) {
    let md = `---
name: ${skillName}
description: ${description}
category: custom
version: 1.0.0
trigger_mode: ${triggerMode}
parameters:
`

    if (parameters && Object.keys(parameters).length > 0) {
      for (const [name, param] of Object.entries(parameters)) {
        md += `  ${name}:
    type: ${param.type || 'string'}
    description: ${param.description || name}
    required: ${param.required !== false ? 'true' : 'false'}
`
      }
    } else {
      md += '  # 无参数\n'
    }

    md += `---

# ${description}

## 功能描述

${functionality || description}

## 执行步骤

1. 根据参数查询相关数据
2. 整理并返回结果

`

    if (exampleUsage) {
      md += `## 使用示例

${exampleUsage}
`
    }

    return md
  },

  /**
   * 创建蓝图格式技能（format='blueprint'）
   *
   * 流程：
   *   1. 校验 rawBlueprint 参数存在
   *   2. 解析 === 分段 ===
   *   3. BlueprintValidator 校验
   *   4. 默认参数试算（验证不崩溃）
   *   5. 保存到 ~/.concrete-mixdesign/skills/<name>/
   *   6. 重新加载技能注册表
   *
   * 不再调用任何 LLM：蓝图内容由主 agent 在同一对话中生成后通过 rawBlueprint 传入。
   */
  async _createBlueprintSkill({ skillName, description, rawBlueprint }, context, userDir) {
    const { logger } = context

    const skillDir = path.join(userDir, skillName)
    if (fs.existsSync(skillDir)) {
      return { success: false, error: this.errors.NAME_EXISTS, details: { skillName } }
    }

    if (!rawBlueprint || typeof rawBlueprint !== 'string' || rawBlueprint.trim().length === 0) {
      logger.warn(`[create-skill:blueprint] 缺少 rawBlueprint 参数`)
      return {
        success: false,
        error: this.errors.MISSING_RAW_BLUEPRINT,
        details: {
          nextAction: 'call_prepare_blueprint_authoring',
          hint: '第一步：调用 prepare_blueprint_authoring 获取创作规范；第二步：基于本次对话生成完整蓝图；第三步：把生成内容作为 rawBlueprint 参数再次调用 create_skill'
        }
      }
    }

    const parsed = this._parseRawBlueprint(rawBlueprint)
    if (!parsed) {
      logger.warn(`[create-skill:blueprint] rawBlueprint 解析失败`)
      return {
        success: false,
        error: this.errors.BLUEPRINT_PARSE_FAILED,
        details: {
          originalError: 'rawBlueprint 缺少 === meta.yaml === / === blueprint.yaml === 分段，或 YAML 语法错误',
          hint: '请按创作规范中的分段格式重新生成'
        }
      }
    }

    try {
      const { validate } = require('../services/BlueprintEngine/BlueprintValidator')
      validate(parsed.blueprint)
      logger.info(`[create-skill:blueprint] 校验通过`)
    } catch (ve) {
      logger.warn(`[create-skill:blueprint] 校验失败: ${ve.message}`)
      return {
        success: false,
        error: this.errors.BLUEPRINT_VALIDATE_FAILED,
        details: {
          originalError: ve.message,
          hint: '请修正 rawBlueprint 后重试。常见错误：①公式自引用（formula.var 出现在 expr 中）；②变量使用前未定义；③material 的 category/property 不在白名单内'
        }
      }
    }

    const dryRun = await this._dryRunBlueprint(parsed.blueprint, parsed.tables, parsed.meta)

    try {
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'meta.yaml'), parsed.rawMeta, 'utf8')
      fs.writeFileSync(path.join(skillDir, 'blueprint.yaml'), parsed.rawBlueprint, 'utf8')
      if (parsed.tables.length > 0) {
        const tablesDir = path.join(skillDir, 'tables')
        fs.mkdirSync(tablesDir, { recursive: true })
        for (const t of parsed.tables) {
          fs.writeFileSync(path.join(tablesDir, t.fileName), t.raw, 'utf8')
        }
      }
      logger.info(`[create-skill:blueprint] 蓝图技能已保存: ${skillDir}`)

      const { getSkillRegistry } = require('../ipcHandlers/agentHandler')
      const registry = getSkillRegistry()
      if (registry) {
        registry._skills.delete(skillName)
        await registry.discover()
        logger.info(`技能已重新加载，当前共 ${registry.size} 个技能`)
      }

      return {
        success: true,
        type: 'skill_created',
        data: {
          skillName,
          skillDir,
          description: parsed.meta.description || description,
          format: 'blueprint',
          dryRun,
          parameterCount: (parsed.meta.parameters || []).length,
          stepCount: (parsed.blueprint.steps || []).length,
          tableCount: parsed.tables.length
        },
        message: this._formatBlueprintSummary(skillName, skillDir, parsed, dryRun),
        suggestions: [
          dryRun.success ? `试试调用 ${skillName} 测试一下` : '试算未通过，建议检查蓝图步骤',
          '需要修改这个技能吗？',
          '还要创建其他技能吗？'
        ]
      }
    } catch (error) {
      logger.error('创建蓝图技能失败:', error)
      return {
        success: false,
        error: this.errors.CREATE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  /**
   * 解析主 agent 传入的 rawBlueprint：按 "=== <文件名> ===" 分段
   * v10.2.0：复用 blueprint-utils.parseRawBlueprint
   * @returns {object|null} { meta, blueprint, tables: [{fileName, content, raw}], rawMeta, rawBlueprint }
   */
  _parseRawBlueprint(rawText) {
    return blueprintUtils.parseRawBlueprint(rawText)
  },

  /**
   * 试算：用默认参数 + stub 材料跑一遍，验证不崩溃
   */
  _dryRunBlueprint(blueprint, tables, meta) {
    const BlueprintEngine = require('../services/BlueprintEngine')
    const FeatureFlag = require('../services/BlueprintEngine/FeatureFlag')

    if (!FeatureFlag.isEnabled()) {
      return Promise.resolve({ success: true, skipped: true, reason: '蓝图引擎已被全局禁用，跳过试算' })
    }

    const tablesIndex = {}
    for (const t of (tables || [])) {
      const key = (t.content && t.content.name) || t.fileName.replace(/\.json$/, '')
      tablesIndex[key] = t.content
    }

    const materialsIndex = this._buildStubMaterials(blueprint)
    const defaultParams = this._buildDefaultParams(meta)

    const engine = new BlueprintEngine({ tables: tablesIndex, materialsIndex })
    return engine.run(blueprint, defaultParams, { dryRun: true })
      .then(r => ({
        success: true,
        results: r.results,
        stepCount: (r.log || []).length
      }))
      .catch(e => ({
        success: false,
        error: `试算失败：${e.message}`
      }))
  },

  _buildStubMaterials(blueprint) {
    const index = {}
    for (const step of (blueprint.steps || [])) {
      if (step.type === 'material' && step.material_query) {
        const { category, property } = step.material_query
        if (!category || !property) continue
        if (!index[category]) index[category] = [{ name: `[stub-${category}]` }]
        if (index[category][0][property] === undefined) {
          index[category][0][property] = 1.0
        }
      }
      if (step.type === 'if_else') {
        const nested = [...(step.then || []), ...(step.else || [])]
        for (const ns of nested) {
          if (ns.type === 'material' && ns.material_query) {
            const { category, property } = ns.material_query
            if (!category || !property) continue
            if (!index[category]) index[category] = [{ name: `[stub-${category}]` }]
            if (index[category][0][property] === undefined) {
              index[category][0][property] = 1.0
            }
          }
        }
      }
    }
    return index
  },

  _buildDefaultParams(meta) {
    const params = {}
    for (const p of (meta && meta.parameters) || []) {
      if (p.default !== undefined) {
        params[p.name] = p.default
      } else if (p.options && p.options.length > 0) {
        params[p.name] = p.options[0]
      } else if (p.type === 'number') {
        params[p.name] = 1
      } else {
        params[p.name] = 'stub'
      }
    }
    return params
  },

  _formatBlueprintSummary(skillName, skillDir, parsed, dryRun) {
    const lines = [`蓝图技能 "${skillName}" 已创建成功！文件保存在:`, skillDir, '']
    lines.push(`参数：${(parsed.meta.parameters || []).length} 个`)
    lines.push(`步骤：${(parsed.blueprint.steps || []).length} 步`)
    lines.push(`数据表：${parsed.tables.length} 个`)
    if (dryRun.skipped) {
      lines.push(`试算：已跳过（${dryRun.reason}）`)
    } else if (dryRun.success) {
      const resultNames = Object.keys(dryRun.results || {}).join(', ')
      lines.push(`试算：通过（输出 ${resultNames || '无'}）`)
    } else {
      lines.push(`试算：未通过 — ${dryRun.error}`)
    }
    return lines.join('\n')
  },

  services: []
}

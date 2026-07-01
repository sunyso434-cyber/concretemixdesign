/**
 * 创建技能 Skill
 * 让用户通过对话方式创建自定义 Skill
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  name: 'create_skill',
  description: '创建新的自定义技能。仅当用户明确说"创建/添加/新建一个技能/工具"，且确认没有功能重复的已有技能时才调用。调用前先用 manage_skills(list) 检查已有技能列表。',
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
      description: 'execute 函数的完整函数体代码（JavaScript）。JS格式时必填，MD格式时可留空。必须包含完整的业务逻辑，不能留 TODO。可以使用 context 中的 materialService、mixDesignService、knowledgeService 等服务，以及 args 中的参数。示例："const { strength } = args; const materials = await context.materialService.getAllMaterials(); return { success: true, data: materials }"',
      required: false
    },
    exampleUsage: {
      type: 'string',
      description: '使用示例，如"用户说：设计一个C40自密实混凝土，坍落度650mm"',
      required: false
    },
    format: {
      type: 'string',
      description: '技能文件格式。md=纯声明式（用户写参数和步骤）；js=代码技能；blueprint=由 LLM 生成蓝图技能包（meta.yaml+blueprint.yaml+tables/*.json），经 BlueprintValidator 校验与试算后保存。默认 md',
      required: false,
      enum: ['js', 'md', 'blueprint']
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
    const { skillName, description, functionality, parameters, executeCode, exampleUsage, format = 'md' } = args
    const { logger } = context

    // functionality 不填时降级用 description
    const effectiveFunctionality = functionality || description || '自定义技能'

    logger.info(`创建技能: ${skillName}, 格式: ${format}`)

    // 检查技能名是否已存在
    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')

    // 确保目录存在
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true })
    }

    if (format === 'md') {
      return await this._createMDSkill(args, context, userDir, effectiveFunctionality)
    } else if (format === 'blueprint') {
      return await this._createBlueprintSkill(args, context, userDir, effectiveFunctionality)
    } else {
      return await this._createJSSkill(args, context, userDir, effectiveFunctionality)
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

    // 生成MD内容
    const mdContent = this._generateMDContent({
      skillName,
      description,
      functionality: effectiveFunctionality,
      parameters,
      exampleUsage
    })

    try {
      // 写入文件
      fs.writeFileSync(filePath, mdContent, 'utf8')
      logger.info(`MD技能文件已创建: ${filePath}`)

      // 重新加载技能
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
   * 创建JS格式技能
   */
  async _createJSSkill(args, context, userDir, effectiveFunctionality) {
    const { skillName, description, parameters, executeCode, exampleUsage } = args
    const { logger } = context

    const filePath = path.join(userDir, `${skillName}.js`)

    if (fs.existsSync(filePath)) {
      return { success: false, error: this.errors.NAME_EXISTS, details: { skillName } }
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
      logger.info(`JS技能文件已创建: ${filePath}`)

      // 重新加载技能
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
          format: 'js'
        },
        message: `JS技能 "${skillName}" 已创建成功！文件保存在:\n${filePath}\n\n技能已自动加载，可以直接使用。`,
        suggestions: [
          `试试调用 ${skillName} 测试一下`,
          '需要修改这个技能吗？',
          '还要创建其他技能吗？'
        ]
      }
    } catch (error) {
      logger.error('创建JS技能失败:', error)
      return {
        success: false,
        error: this.errors.CREATE_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  /**
   * 生成MD内容
   */
  _generateMDContent({ skillName, description, functionality, parameters, exampleUsage }) {
    let md = `---
name: ${skillName}
description: ${description}
category: custom
version: 1.0.0
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
   * 创建蓝图格式技能（format='blueprint'）
   * 流程：调 LLM 生成 meta.yaml + blueprint.yaml + tables/*.json →
   *      BlueprintValidator 校验（最多 3 次重试）→
   *      默认参数试算（验证不崩溃）→
   *      保存到 ~/.concrete-mixdesign/skills/<name>/ →
   *      返回结果（含试算摘要），由 agent 层提示用户确认。
   */
  async _createBlueprintSkill(args, context, userDir, effectiveFunctionality) {
    const { skillName, description, functionality, parameters, exampleUsage } = args
    const { logger } = context

    const skillDir = path.join(userDir, skillName)
    if (fs.existsSync(skillDir)) {
      return { success: false, error: this.errors.NAME_EXISTS, details: { skillName } }
    }

    // 解析 LLM 服务（测试可通过 context.llmService 注入 mock）
    const llmService = this._getLLMService(context)
    if (!llmService || typeof llmService.invoke !== 'function') {
      return {
        success: false,
        error: this.errors.CREATE_FAILED,
        details: { originalError: 'LLM 服务不可用（未配置 context.llmService）' }
      }
    }

    // 生成 + 校验 + 重试循环（最多 3 次）
    const MAX_ATTEMPTS = 3
    let prompt = this._buildBlueprintPrompt({ skillName, description, functionality, parameters, exampleUsage })
    let parsed = null
    let lastError = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let rawText
      try {
        rawText = await llmService.invoke(prompt)
      } catch (e) {
        lastError = `LLM 调用失败: ${e.message}`
        logger.warn(`[create-skill:blueprint] 第 ${attempt} 次 LLM 调用失败: ${e.message}`)
        // LLM 调用本身失败，不重试（重试也是同样错误）
        return {
          success: false,
          error: this.errors.CREATE_FAILED,
          details: { originalError: lastError }
        }
      }

      parsed = this._parseLLMOutput(rawText)
      if (!parsed) {
        lastError = 'LLM 输出无法解析为分段的 YAML/JSON（缺少 meta.yaml / blueprint.yaml 段落标记）'
        prompt = this._buildBlueprintPrompt({ skillName, description, functionality, parameters, exampleUsage }, lastError)
        logger.warn(`[create-skill:blueprint] 第 ${attempt} 次输出无法解析，重试`)
        continue
      }

      // 语法校验
      try {
        const { validate } = require('../services/BlueprintEngine/BlueprintValidator')
        validate(parsed.blueprint)
        logger.info(`[create-skill:blueprint] 第 ${attempt} 次校验通过`)
        lastError = null
        break
      } catch (ve) {
        lastError = ve.message
        prompt = this._buildBlueprintPrompt({ skillName, description, functionality, parameters, exampleUsage }, lastError)
        logger.warn(`[create-skill:blueprint] 第 ${attempt} 次校验失败: ${lastError}，重试`)
      }
    }

    if (lastError || !parsed) {
      return {
        success: false,
        error: this.errors.CREATE_FAILED,
        details: {
          originalError: `蓝图校验 ${MAX_ATTEMPTS} 次均未通过：${lastError}`,
          suggestion: '无法自动生成该蓝图，请联系开发者手写'
        }
      }
    }

    // 试算（用默认参数 + stub 材料验证不崩溃）
    const dryRun = await this._dryRunBlueprint(parsed.blueprint, parsed.tables, parsed.meta)

    // 保存文件
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

      // 重新加载技能
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
   * 解析 LLM 服务（优先用 context.llmService，便于测试注入；
   * 否则惰性实例化 DeepSeekService）
   */
  _getLLMService(context) {
    if (context && context.llmService && typeof context.llmService.invoke === 'function') {
      return context.llmService
    }
    try {
      const DeepSeekService = require('../services/DeepSeekService')
      return new DeepSeekService(null, context && context.systemService)
    } catch (e) {
      return null
    }
  },

  /**
   * 构造 LLM prompt（系统 + 用户）
   * @param {object} opts - { skillName, description, functionality, parameters, exampleUsage }
   * @param {string} [retryError] - 上次校验失败的原因（重试时附加）
   */
  _buildBlueprintPrompt(opts, retryError) {
    const { skillName, description, functionality, parameters, exampleUsage } = opts

    const paramList = this._formatParamList(parameters)

    const userPrompt = `任务：为【${description || skillName}】生成配合比设计蓝图技能包

技能名称：${skillName}
功能描述：${functionality || description || ''}
${exampleUsage ? `使用示例：${exampleUsage}\n` : ''}
输入参数：
${paramList}

输出要求：
1. 必须输出完整的 meta.yaml + blueprint.yaml +（如需查表）tables/<表名>.json
2. 蓝图必须能跑通：所有变量在使用前定义，公式不能自引用
3. 数值必须合理：水胶比 0.2~0.65、砂率 25%~55%、总质量 1800~2600 kg/m³
4. 严禁输出蓝图以外的任何内容（不要解释、不要 markdown 代码围栏）

可用的 7 种原子操作（blueprint.yaml 的 steps 数组中每个元素）：
- input：从用户参数读值。字段 var(变量名) / from(对应 meta.parameters 的 name) / value_map(可选映射) / default
- const：固定常数。字段 var / value
- material：从原材料管理读某材料属性。字段 var / material_query: { category, property }
  · category 仅允许：水泥/细骨料/粗骨料/粉煤灰/矿渣粉/锂渣/复合粉/减水剂
  · 禁止写 material_query.name（运行时填入）
- formula：数学表达式。字段 var / expr（支持 + - * / ** 及 round/max/min/sqrt/abs）
- table_lookup：查表插值。字段 var / table(表名) / lookup_mode(linear|bilinear|nearest) / keys(键名→"$变量名")
- if_else：条件分支。字段 condition / then(子步骤数组) / else(子步骤数组)
- output：标记最终输出。字段 var / name(中文名) / unit / precision

meta.yaml 结构：
  name / description / version / concrete_type / author / created_at
  parameters: [{ name, label, type(string|number|select), required, options?, min?, max?, default? }]

tables/<表名>.json 结构：
  { "name": "表名(与 table_lookup.table 一致)", "description": "...", "version": "1.0",
    "dimensions": [{ "name": "维度名", "unit": "...", "values": [...] }],
    "data": [[...]], "interpolation": "linear|bilinear" }

完整示例（普通混凝土 JGJ 55 简化版，供参考结构）：
---meta.yaml---
name: "普通混凝土_JGJ55"
description: "按 JGJ 55 设计普通混凝土配合比"
version: "1.0.0"
concrete_type: "normal"
parameters:
  - name: strength_grade
    label: "强度等级"
    type: select
    required: true
    options: ["C30", "C35", "C40"]
  - name: slump
    label: "坍落度(mm)"
    type: number
    required: true
    default: 180
---blueprint.yaml---
steps:
  - type: input
    var: fcu_k
    from: "strength_grade"
    value_map: { C30: 30, C35: 35, C40: 40 }
    default: 30
  - type: input
    var: sigma
    default: 5.0
  - type: input
    var: slump
    default: 180
  - type: material
    var: cement_strength
    material_query: { category: "水泥", property: "compressiveStrength28d" }
  - type: const
    var: rich_factor
    value: 1.0
  - type: formula
    var: fb
    expr: "rich_factor * cement_strength"
  - type: formula
    var: fcu_o
    expr: "fcu_k + 1.645 * sigma"
  - type: formula
    var: wb
    expr: "(0.53 * fb) / (fcu_o + 0.53 * 0.20 * fb)"
  - type: output
    var: wb
    name: "水胶比"
    unit: ""
    precision: 3
---end---

输出格式（必须严格按此分段，每段以 === <文件名> === 起始）：
=== meta.yaml ===
<YAML 内容>
=== blueprint.yaml ===
<YAML 内容>
=== tables/<表名>.json ===
<JSON 内容>
（如无数据表，可省略 tables 段）

${retryError ? `上次校验失败原因：${retryError}\n请修正上述问题并重新输出完整蓝图。` : ''}`

    return userPrompt
  },

  /**
   * 把 parameters 对象格式化为 prompt 用的列表文本
   */
  _formatParamList(parameters) {
    if (!parameters || Object.keys(parameters).length === 0) {
      return '（无显式参数，请根据功能描述自行推断并补充 meta.parameters）'
    }
    return Object.entries(parameters).map(([key, def]) =>
      `- ${key}: ${def.type || 'string'} — ${def.description || ''}${def.required !== false ? '（必填）' : ''}`
    ).join('\n')
  },

  /**
   * 解析 LLM 输出：按 "=== <文件名> ===" 分段
   * @returns {object|null} { meta, blueprint, tables: [{fileName, content, raw}], rawMeta, rawBlueprint }
   */
  _parseLLMOutput(rawText) {
    if (!rawText || typeof rawText !== 'string') return null
    // 去掉可能的 markdown 代码围栏
    const cleaned = rawText.replace(/```[a-zA-Z]*/g, '').replace(/```/g, '')
    const sections = {}
    const regex = /===\s*([^=\s][^=]*?)\s*===\s*\n([\s\S]*?)(?=\n===\s*[^=]|\s*$)/g
    let match
    while ((match = regex.exec(cleaned)) !== null) {
      const fileName = match[1].trim()
      sections[fileName] = match[2].trim()
    }
    if (!sections['meta.yaml'] || !sections['blueprint.yaml']) return null

    const yaml = require('js-yaml')
    let meta, blueprint
    try {
      meta = yaml.load(sections['meta.yaml']) || {}
      blueprint = yaml.load(sections['blueprint.yaml']) || {}
    } catch (e) {
      return null
    }
    if (!meta || !blueprint || !Array.isArray(blueprint.steps)) return null

    const tables = []
    for (const [fileName, content] of Object.entries(sections)) {
      if (fileName === 'meta.yaml' || fileName === 'blueprint.yaml') continue
      // tables/<表名>.json
      const tableMatch = fileName.match(/^tables\/(.+\.json)$/)
      if (tableMatch) {
        try {
          const parsed = JSON.parse(content)
          tables.push({ fileName: tableMatch[1], content: parsed, raw: content })
        } catch (e) {
          // 单个表解析失败不致命，跳过
        }
      }
    }

    return { meta, blueprint, tables, rawMeta: sections['meta.yaml'], rawBlueprint: sections['blueprint.yaml'] }
  },

  /**
   * 试算：用默认参数 + stub 材料跑一遍，验证不崩溃
   * @returns {{ success: boolean, results?: object, error?: string, skipped?: boolean }}
   */
  _dryRunBlueprint(blueprint, tables, meta) {
    const BlueprintEngine = require('../services/BlueprintEngine')
    const FeatureFlag = require('../services/BlueprintEngine/FeatureFlag')

    // 引擎被全局禁用时跳过试算（不视为蓝图缺陷）
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

  /**
   * 扫描蓝图中的 material 步骤，为每个 category 构造一个 stub 材料
   * （所有被引用的 property 设为占位值 1.0，确保试算不因缺料崩溃）
   */
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
      // if_else 内嵌套的 material 步骤也处理
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

  /**
   * 从 meta.parameters 构造默认参数（试算用）
   * 优先用 default；其次 select 的首个 option；number 用 1；其他用 "stub"
   */
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

  /**
   * 生成保存后的用户可见摘要
   */
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

  /**
   * 生成JS技能代码
   */
  _generateSkillCode({ skillName, description, functionality, paramsCode, executeCode, exampleUsage }) {
    // 使用 JSON.stringify 安全转义 executeCode，防止反引号/反斜杠/模板字符串被破坏
    const rawCode = executeCode || ''
    const safeCode = JSON.stringify(rawCode).slice(1, -1)

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
  },

  services: []
}

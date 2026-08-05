/**
 * 技能管理 Skill
 * 查看、管理用户自定义技能
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const yaml = require('js-yaml')
const blueprintUtils = require('./blueprint-utils')

module.exports = {
  name: 'manage_skills',
  // v10.2.0：补充 update 能力到 description，让 AI 知道可以用这个工具修改/升级已有技能
  description: '管理自定义技能。list=列表, source=读取源文件, info=查看元数据, update=修改或升级已有技能（支持整文件覆盖 / 局部 patch / JSON Patch / 蓝图 rawBlueprint 全量替换 4 种粒度），delete=删除（删除前自动备份）, help=帮助。例如"我有哪些自定义技能"、"升级 XX 技能为 v2"、"删除 XX 技能"、"技能系统怎么用"。',
  version: '2.0.0',
  category: 'system',
  isWrite: true,

  parameters: {
    action: {
      type: 'string',
      description: '操作类型：list=列表, delete=删除, info=查看信息, source=读取源文件, update=修改技能, help=帮助。不填默认 list',
      required: false,
      enum: ['list', 'delete', 'info', 'source', 'update', 'help']
    },
    skillName: {
      type: 'string',
      description: '技能名称（delete/info/source/update 时必填）。蓝图技能：可用目录名（dir.name）或 meta.yaml 里的 name 字段。',
      required: false
    },
    content: {
      type: 'string',
      description: '新的文件内容（update 时必填，整文件覆盖模式）',
      required: false
    },
    file: {
      type: 'string',
      description: '要操作的文件名（update/source 时可选）。蓝图技能可选: meta.yaml, blueprint.yaml, 或 tables/xxx.json。JS/MD技能不需要填',
      required: false
    },
    // v10.2.0：新增 3 个 update 粒度参数
    rawBlueprint: {
      type: 'string',
      description: '【update】蓝图全量替换模式：传入完整蓝图分段字符串（=== meta.yaml === / === blueprint.yaml === / === tables/xxx.json ===）。比 4 次单文件 update 更安全，会自动逐文件备份+校验。',
      required: false
    },
    patch: {
      type: 'object',
      description: '【update】局部文本 patch 模式（仅 .md/.yaml/.txt 文件）。结构：{ find: "要替换的旧文本", replace: "新文本", replaceAll: false }。传了 patch 就不要再传 content。',
      required: false,
      properties: {
        find: { type: 'string', description: '要查找的旧文本（精确匹配，含空格/换行）' },
        replace: { type: 'string', description: '替换的新文本' },
        replaceAll: { type: 'boolean', description: '是否替换所有出现位置（默认 false 只替换第一个）', default: false }
      }
    },
    jsonPatch: {
      type: 'array',
      description: '【update】JSON Patch 模式（仅 .json 文件，RFC 6902）。结构：[ { op: "replace|add|remove", path: "/0/field", value: ... } ]。',
      required: false
    }
  },

  errors: {
    NOT_FOUND: {
      code: 'SKILL_NOT_FOUND',
      message: '技能不存在',
      hint: '请检查技能名称是否正确',
      recovery: 'list_skills'
    },
    DELETE_FAILED: {
      code: 'SKILL_LOAD_FAILED',
      message: '删除技能失败',
      hint: '请稍后重试',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { action = 'list', skillName } = args
    const { logger } = context

    logger.info(`技能管理: action=${action}, skillName=${skillName}`)

    switch (action) {
      case 'list':
        return await this._listSkills(context)
      case 'delete':
        return await this._deleteSkill(skillName, context)
      case 'info':
        return await this._getSkillInfo(skillName, context)
      case 'source':
        return await this._getSkillSource(skillName, args.file, context)
      case 'update':
        // v10.2.0：把 args 注入 context，让 _updateSkill 能拿到 rawBlueprint/patch/jsonPatch
        return await this._updateSkill(skillName, args.content, args.file, { ...context, args })
      case 'help':
        return this._getHelp()
      default:
        return { success: false, error: { code: 'PARAM_INVALID', message: `未知操作: ${action}` } }
    }
  },

  async _listSkills(context) {
    const { logger } = context
    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')

    if (!fs.existsSync(userDir)) {
      return {
        success: true,
        data: { skills: [], message: '暂无自定义技能' }
      }
    }

    const entries = fs.readdirSync(userDir, { withFileTypes: true })
    const jsFiles = entries.filter(e => e.isFile() && e.name.endsWith('.js'))
    const dirEntries = entries.filter(e => e.isDirectory())
    const skills = []

    // ---- .js 技能 ----
    for (const file of jsFiles) {
      try {
        const filePath = path.join(userDir, file.name)
        const content = fs.readFileSync(filePath, 'utf8')

        // 简单解析 name 和 description
        const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/)
        const descMatch = content.match(/description:\s*['"]([^'"]+)['"]/)

        skills.push({
          fileName: file.name,
          name: nameMatch ? nameMatch[1] : file.name.replace('.js', ''),
          description: descMatch ? descMatch[1] : '无描述',
          triggerMode: 'function',
          filePath
        })
      } catch (error) {
        logger.warn(`解析技能文件失败: ${file.name}`, error)
      }
    }

    // ---- 蓝图技能（目录包含 meta.yaml） ----
    // v10.2.0 方案 1：用 dir.name 作为 name 字段（统一标识符），meta.name 作为 displayName
    // 修 P0 bug：原来 list 返回 meta.name，AI 拿这个当目录名去 source/update/delete，找不到目录
    for (const dir of dirEntries) {
      const metaPath = path.join(userDir, dir.name, 'meta.yaml')
      if (!fs.existsSync(metaPath)) continue

      try {
        const meta = yaml.load(fs.readFileSync(metaPath, 'utf8')) || {}
        const blueprintPath = path.join(userDir, dir.name, 'blueprint.yaml')

        let stepCount = 0
        if (fs.existsSync(blueprintPath)) {
          const bp = yaml.load(fs.readFileSync(blueprintPath, 'utf8')) || {}
          stepCount = (bp.steps || bp.blueprint?.steps || []).length
        }

        const tablesDir = path.join(userDir, dir.name, 'tables')
        let tableCount = 0
        if (fs.existsSync(tablesDir)) {
          tableCount = fs.readdirSync(tablesDir).filter(f => f.endsWith('.json')).length
        }

        const llmGenerated = meta.generated_by === 'llm'

        skills.push({
          fileName: dir.name,
          // v10.2.0：name 改为 dir.name（AI 拿来直接当目录名用不会出错）
          name: dir.name,
          displayName: meta.name || dir.name,
          description: meta.description || '无描述',
          filePath: path.join(userDir, dir.name),
          category: 'blueprint',
          triggerMode: 'function',
          stepCount,
          tableCount,
          llmGenerated
        })
      } catch (error) {
        logger.warn(`解析蓝图技能失败: ${dir.name}`, error)
      }
    }

    // ---- .md 技能（需要 gray-matter 解析 frontmatter） ----
    const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'))
    for (const file of mdFiles) {
      try {
        const filePath = path.join(userDir, file.name)
        const content = fs.readFileSync(filePath, 'utf8')
        const { data } = require('gray-matter')(content)
        const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/)
        const descMatch = content.match(/description:\s*['"]([^'"]+)['"]/)
        const tm = data.trigger_mode || 'function'

        skills.push({
          fileName: file.name,
          name: nameMatch ? nameMatch[1] : file.name.replace('.md', ''),
          description: descMatch ? descMatch[1] : '无描述',
          triggerMode: tm,
          filePath
        })
      } catch (error) {
        logger.warn(`解析 MD skill 失败: ${file.name}`, error)
      }
    }

    return {
      success: true,
      data: {
        skills,
        count: skills.length,
        directory: userDir
      }
    }
  },

  async _deleteSkill(skillName, context) {
    const { logger } = context

    if (!skillName) {
      return {
        success: false,
        error: { code: 'PARAM_MISSING', message: '请指定要删除的技能名称' }
      }
    }

    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')
    const filePath = path.join(userDir, `${skillName}.js`)
    // v10.2.0 方案 1：用 resolveBlueprintDir 智能查找（兼容 dir.name 或 meta.name）
    const blueprintDir = blueprintUtils.resolveBlueprintDir(userDir, skillName)
    const isBlueprint = blueprintDir !== null

    // ---- 蓝图技能：备份后删除整个目录 ----
    if (isBlueprint) {
      try {
        // 备份到 backups/skills/<skillName>-<timestamp>/
        const backupRoot = path.join(os.homedir(), '.concrete-mixdesign', 'backups', 'skills')
        const backupDir = path.join(backupRoot, `${skillName}-${Date.now()}`)
        this._copyDirSync(blueprintDir, backupDir)
        logger.info(`蓝图技能已备份到: ${backupDir}`)

        // 删除原目录
        fs.rmSync(blueprintDir, { recursive: true, force: true })
        logger.info(`蓝图技能已删除: ${blueprintDir}`)

        // 重新加载技能
        try {
          const { getSkillRegistry } = require('../ipcHandlers/agentHandler')
          const registry = getSkillRegistry()
          if (registry) {
            registry._skills.delete(skillName)
            await registry.discover()
          }
        } catch (e) {
          // 注册表重载失败不影响删除结果
          logger.warn('重新加载技能注册表失败:', e.message)
        }

        return {
          success: true,
          message: `蓝图技能 "${skillName}" 已删除`,
          backupPath: backupDir
        }
      } catch (error) {
        logger.error('删除蓝图技能失败:', error)
        return { success: false, error: this.errors.DELETE_FAILED }
      }
    }

    // ---- .js 技能（原逻辑） ----
    if (!fs.existsSync(filePath)) {
      return { success: false, error: this.errors.NOT_FOUND, details: { skillName } }
    }

    try {
      fs.unlinkSync(filePath)
      logger.info(`技能已删除: ${filePath}`)

      // 重新加载技能
      const { getSkillRegistry } = require('../ipcHandlers/agentHandler')
      const registry = getSkillRegistry()
      if (registry) {
        registry._skills.delete(skillName)
        await registry.discover()
      }

      return {
        success: true,
        message: `技能 "${skillName}" 已删除`
      }
    } catch (error) {
      logger.error('删除技能失败:', error)
      return { success: false, error: this.errors.DELETE_FAILED }
    }
  },

  async _getSkillInfo(skillName, context) {
    if (!skillName) {
      return {
        success: false,
        error: { code: 'PARAM_MISSING', message: '请指定技能名称' }
      }
    }

    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')
    const jsFilePath = path.join(userDir, `${skillName}.js`)
    // v10.2.0 方案 1：用 resolveBlueprintDir 智能查找
    const blueprintDir = blueprintUtils.resolveBlueprintDir(userDir, skillName)
    const isBlueprint = blueprintDir !== null

    // ---- 蓝图技能：展示 meta + blueprint 详情 ----
    if (isBlueprint) {
      try {
        const metaPath = path.join(blueprintDir, 'meta.yaml')
        const meta = yaml.load(fs.readFileSync(metaPath, 'utf8')) || {}
        const blueprintPath = path.join(blueprintDir, 'blueprint.yaml')

        let stepCount = 0
        let materialCategories = []
        let referencedTables = []

        if (fs.existsSync(blueprintPath)) {
          const bp = yaml.load(fs.readFileSync(blueprintPath, 'utf8')) || {}
          const steps = bp.steps || bp.blueprint?.steps || []
          stepCount = steps.length

          for (const step of steps) {
            if (step.type === 'material' && step.material_query && step.material_query.category) {
              materialCategories.push(step.material_query.category)
            }
            if (step.type === 'table_lookup' && step.table) {
              referencedTables.push(step.table)
            }
          }
        }

        const tablesDir = path.join(blueprintDir, 'tables')
        const tableFiles = fs.existsSync(tablesDir)
          ? fs.readdirSync(tablesDir).filter(f => f.endsWith('.json'))
          : []

        return {
          success: true,
          data: {
            skillName,
            category: 'blueprint',
            triggerMode: 'function',
            directory: blueprintDir,
            meta,
            stepCount,
            materialCategories: [...new Set(materialCategories)],
            referencedTables: [...new Set(referencedTables)],
            tableFiles,
            llmGenerated: meta.generated_by === 'llm'
          }
        }
      } catch (error) {
        return { success: false, error: { code: 'READ_FAILED', message: error.message } }
      }
    }

    // ---- .md 技能 ----
    const mdPath = path.join(userDir, `${skillName}.md`)
    if (fs.existsSync(mdPath)) {
      try {
        const content = fs.readFileSync(mdPath, 'utf-8')
        const { data } = require('gray-matter')(content)
        return {
          success: true,
          data: {
            skillName,
            category: 'markdown',
            filePath: mdPath,
            triggerMode: data.trigger_mode || 'function',
            content,
            files: { [`${skillName}.md`]: content }
          }
        }
      } catch (error) {
        return { success: false, error: { code: 'READ_FAILED', message: error.message } }
      }
    }

    // ---- .js 技能（原逻辑） ----
    if (!fs.existsSync(jsFilePath)) {
      return { success: false, error: this.errors.NOT_FOUND, details: { skillName } }
    }

    try {
      const content = fs.readFileSync(jsFilePath, 'utf8')
      return {
        success: true,
        data: {
          skillName,
          filePath: jsFilePath,
          triggerMode: 'function',
          content
        }
      }
    } catch (error) {
      return { success: false, error: { code: 'READ_FAILED', message: error.message } }
    }
  },

  /**
   * 读取技能源文件内容（供 LLM 阅读、分析、改进）
   */
  async _getSkillSource(skillName, file, context) {
    const { logger } = context

    if (!skillName) {
      return { success: false, error: { code: 'PARAM_MISSING', message: '请指定技能名称' } }
    }

    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')

    // ---- 蓝图技能 ----
    // v10.2.0 方案 1：用 resolveBlueprintDir 智能查找（兼容 dir.name 或 meta.name）
    const blueprintDir = blueprintUtils.resolveBlueprintDir(userDir, skillName)
    const isBlueprint = blueprintDir !== null

    if (isBlueprint) {
      try {
        // 指定了具体文件 → 只返回该文件
        if (file) {
          const filePath = path.join(blueprintDir, file)
          // 安全检查：防止路径穿越
          if (!filePath.startsWith(blueprintDir)) {
            return { success: false, error: { code: 'PATH_TRAVERSAL', message: '不允许的文件路径' } }
          }
          if (!fs.existsSync(filePath)) {
            return { success: false, error: { code: 'FILE_NOT_FOUND', message: `文件不存在: ${file}` } }
          }
          const content = fs.readFileSync(filePath, 'utf8')
          return {
            success: true,
            data: {
              skillName,
              category: 'blueprint',
              file,
              content
            }
          }
        }

        // 未指定文件 → 返回所有文件
        const files = {}
        for (const f of fs.readdirSync(blueprintDir, { recursive: true, withFileTypes: true })) {
          if (!f.isFile()) continue
          const relativePath = path.relative(blueprintDir, path.join(f.parentPath || f.path, f.name)).replace(/\\/g, '/')
          files[relativePath] = fs.readFileSync(path.join(f.parentPath || f.path, f.name), 'utf8')
        }

        return {
          success: true,
          data: {
            skillName,
            category: 'blueprint',
            directory: blueprintDir,
            files
          }
        }
      } catch (error) {
        logger.error('读取蓝图源文件失败:', error)
        return { success: false, error: { code: 'READ_FAILED', message: error.message } }
      }
    }

    // ---- .js 技能 ----
    const jsPath = path.join(userDir, `${skillName}.js`)
    if (fs.existsSync(jsPath)) {
      try {
        const content = fs.readFileSync(jsPath, 'utf8')
        return {
          success: true,
          data: {
            skillName,
            category: 'javascript',
            filePath: jsPath,
            content,
            files: { [`${skillName}.js`]: content }
          }
        }
      } catch (error) {
        return { success: false, error: { code: 'READ_FAILED', message: error.message } }
      }
    }

    // ---- .md 技能 ----
    const mdPath = path.join(userDir, `${skillName}.md`)
    if (fs.existsSync(mdPath)) {
      try {
        const content = fs.readFileSync(mdPath, 'utf8')
        return {
          success: true,
          data: {
            skillName,
            category: 'markdown',
            filePath: mdPath,
            content,
            files: { [`${skillName}.md`]: content }
          }
        }
      } catch (error) {
        return { success: false, error: { code: 'READ_FAILED', message: error.message } }
      }
    }

    return { success: false, error: this.errors.NOT_FOUND, details: { skillName } }
  },

  /**
   * 修改技能文件
   * 支持 JS、MD、蓝图三种格式
   * 修改后自动清除缓存并重新加载注册表
   */
  async _updateSkill(skillName, content, file, context) {
    const { logger } = context
    // v10.2.0：从 context 读 args 以支持多种更新模式
    const args = (context && context.args) ? context.args : { content, file }

    if (!skillName) {
      return { success: false, error: { code: 'PARAM_MISSING', message: '请指定技能名称' } }
    }

    // v10.2.0 方案 4：参数优先级 rawBlueprint > jsonPatch > patch > content
    const rawBlueprint = args.rawBlueprint
    const patch = args.patch
    const jsonPatch = args.jsonPatch
    const mode = rawBlueprint ? 'rawBlueprint' : jsonPatch ? 'jsonPatch' : patch ? 'patch' : content ? 'content' : null
    if (!mode) {
      return {
        success: false,
        error: {
          code: 'PARAM_MISSING',
          message: 'update 必须提供以下参数之一：rawBlueprint（蓝图全量）/ jsonPatch（JSON 字段）/ patch（文本 patch）/ content（整文件覆盖）'
        }
      }
    }

    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')

    // v10.2.0 方案 1：resolveBlueprintDir 智能查找
    const blueprintDir = blueprintUtils.resolveBlueprintDir(userDir, skillName)
    const isBlueprint = blueprintDir !== null

    if (isBlueprint) {
      try {
        // 方案 3：rawBlueprint 全量替换
        if (mode === 'rawBlueprint') {
          return await this._updateBlueprintFull(blueprintDir, rawBlueprint, skillName, logger)
        }
        // 方案 4：单文件 patch / jsonPatch / content
        if (!file) {
          return {
            success: false,
            error: { code: 'PARAM_MISSING', message: '蓝图单文件 patch / jsonPatch / content 必须传 file 参数', hint: '如要全量替换，请改用 rawBlueprint 参数' }
          }
        }
        const filePath = path.join(blueprintDir, file)
        if (!filePath.startsWith(blueprintDir)) {
          return { success: false, error: { code: 'PATH_TRAVERSAL', message: '不允许的文件路径' } }
        }
        return await this._updateBlueprintSingleFile(blueprintDir, filePath, file, mode, args, logger)
      } catch (error) {
        logger.error('更新蓝图技能失败:', error)
        return { success: false, error: { code: 'UPDATE_FAILED', message: error.message } }
      }
    }

    // ---- .js 技能 ----
    const jsPath = path.join(userDir, `${skillName}.js`)
    if (fs.existsSync(jsPath)) {
      try {
        if (mode !== 'content') {
          return { success: false, error: { code: 'UNSUPPORTED_MODE', message: `.js 技能只支持整文件覆盖（content 参数），不支持 ${mode} 模式` } }
        }
        const backupPath = jsPath + `.bak.${Date.now()}`
        fs.copyFileSync(jsPath, backupPath)
        fs.writeFileSync(jsPath, content, 'utf8')
        const resolvedPath = require.resolve(jsPath)
        if (resolvedPath) {
          delete require.cache[resolvedPath]
        }
        await this._reloadRegistry(logger)
        return { success: true, message: `JS技能 "${skillName}" 已更新`, backupPath }
      } catch (error) {
        logger.error('更新JS技能失败:', error)
        return { success: false, error: { code: 'UPDATE_FAILED', message: error.message } }
      }
    }

    // ---- .md 技能 ----
    const mdPath = path.join(userDir, `${skillName}.md`)
    if (fs.existsSync(mdPath)) {
      try {
        if (mode === 'jsonPatch') {
          return { success: false, error: { code: 'UNSUPPORTED_MODE', message: '.md 技能不支持 jsonPatch 模式' } }
        }
        if (mode === 'patch') {
          return await this._applyTextPatch(mdPath, patch, skillName, '.md', logger)
        }
        // content 模式
        const backupPath = mdPath + `.bak.${Date.now()}`
        fs.copyFileSync(mdPath, backupPath)
        fs.writeFileSync(mdPath, content, 'utf8')
        await this._reloadRegistry(logger)
        return { success: true, message: `MD技能 "${skillName}" 已更新`, backupPath }
      } catch (error) {
        logger.error('更新MD技能失败:', error)
        return { success: false, error: { code: 'UPDATE_FAILED', message: error.message } }
      }
    }

    return { success: false, error: this.errors.NOT_FOUND, details: { skillName } }
  },

  /**
   * v10.2.0 方案 3：蓝图全量替换（rawBlueprint 模式）
   */
  async _updateBlueprintFull(blueprintDir, rawBlueprint, skillName, logger) {
    const parsed = blueprintUtils.parseRawBlueprint(rawBlueprint)
    if (!parsed) {
      return {
        success: false,
        error: {
          code: 'BLUEPRINT_PARSE_FAILED',
          message: 'rawBlueprint 解析失败',
          hint: '必须包含 === meta.yaml === 和 === blueprint.yaml === 分段，且内容为合法 YAML'
        }
      }
    }

    const backupRoot = path.join(os.homedir(), '.concrete-mixdesign', 'backups', 'skills')
    const backupDir = path.join(backupRoot, `${skillName}-${Date.now()}`)
    this._copyDirSync(blueprintDir, backupDir)
    logger.info(`蓝图技能已备份到: ${backupDir}`)

    try {
      const { validate } = require('../services/BlueprintEngine/BlueprintValidator')
      validate(parsed.blueprint)

      fs.writeFileSync(path.join(blueprintDir, 'meta.yaml'), parsed.rawMeta, 'utf8')
      fs.writeFileSync(path.join(blueprintDir, 'blueprint.yaml'), parsed.rawBlueprint, 'utf8')
      if (parsed.tables.length > 0) {
        const tablesDir = path.join(blueprintDir, 'tables')
        fs.mkdirSync(tablesDir, { recursive: true })
        for (const t of parsed.tables) {
          fs.writeFileSync(path.join(tablesDir, t.fileName), t.raw, 'utf8')
        }
      }

      await this._reloadRegistry(logger)
      logger.info(`蓝图技能 rawBlueprint 全量更新成功: ${skillName}`)
      return {
        success: true,
        message: `蓝图技能 "${skillName}" 已全量更新`,
        mode: 'rawBlueprint',
        backupPath: backupDir,
        filesWritten: ['meta.yaml', 'blueprint.yaml', ...parsed.tables.map(t => `tables/${t.fileName}`)]
      }
    } catch (error) {
      logger.error(`蓝图 rawBlueprint 更新失败，开始回滚: ${error.message}`)
      try {
        this._removeDirSync(blueprintDir)
        this._copyDirSync(backupDir, blueprintDir)
        logger.info(`蓝图技能已回滚到备份: ${backupDir}`)
      } catch (rollbackErr) {
        logger.error(`回滚失败！原技能目录可能已损坏。备份位置: ${backupDir}`, rollbackErr)
      }
      return {
        success: false,
        error: {
          code: 'BLUEPRINT_VALIDATE_FAILED',
          message: `蓝图校验失败，已自动回滚到备份: ${error.message}`,
          hint: '请修正 rawBlueprint 后重试。常见错误：公式自引用、变量未定义、material 不在白名单',
          backupPath: backupDir
        }
      }
    }
  },

  /**
   * v10.2.0 方案 4：蓝图单文件更新（patch / jsonPatch / content 三种粒度）
   */
  async _updateBlueprintSingleFile(blueprintDir, filePath, file, mode, args, logger) {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: { code: 'FILE_NOT_FOUND', message: `文件不存在: ${file}。update 不能创建新文件，请用 create_skill。` } }
    }

    const backupRoot = path.join(os.homedir(), '.concrete-mixdesign', 'backups', 'skills')
    const backupDir = path.join(backupRoot, `${path.basename(blueprintDir)}-${Date.now()}`)
    this._copyDirSync(blueprintDir, backupDir)

    try {
      const ext = path.extname(file).toLowerCase()

      if (mode === 'jsonPatch' && ext !== '.json') {
        return { success: false, error: { code: 'UNSUPPORTED_MODE', message: `jsonPatch 模式仅支持 .json 文件，${file} 是 ${ext}` } }
      }

      let newContent
      if (mode === 'content') {
        newContent = args.content
      } else if (mode === 'patch') {
        const result = this._applyTextPatchToString(fs.readFileSync(filePath, 'utf8'), args.patch)
        if (!result.success) return { ...result, backupPath: backupDir }
        newContent = result.content
      } else if (mode === 'jsonPatch') {
        const result = this._applyJsonPatchToString(fs.readFileSync(filePath, 'utf8'), args.jsonPatch)
        if (!result.success) return { ...result, backupPath: backupDir }
        newContent = result.content
      }

      // blueprint.yaml 写完做 BlueprintValidator 校验
      if (file === 'blueprint.yaml') {
        try {
          const { validate } = require('../services/BlueprintEngine/BlueprintValidator')
          validate(yaml.load(newContent))
        } catch (ve) {
          this._removeDirSync(blueprintDir)
          this._copyDirSync(backupDir, blueprintDir)
          return {
            success: false,
            error: { code: 'BLUEPRINT_VALIDATE_FAILED', message: `蓝图校验失败，已回滚: ${ve.message}`, backupPath: backupDir }
          }
        }
      }

      fs.writeFileSync(filePath, newContent, 'utf8')
      await this._reloadRegistry(logger)
      return { success: true, message: `蓝图文件 "${file}" 已更新`, mode, file, backupPath: backupDir }
    } catch (error) {
      try {
        this._removeDirSync(blueprintDir)
        this._copyDirSync(backupDir, blueprintDir)
      } catch (_) {}
      logger.error('蓝图文件更新失败:', error)
      return { success: false, error: { code: 'UPDATE_FAILED', message: error.message, backupPath: backupDir } }
    }
  },

  /**
   * v10.2.0 方案 4：文本 patch 写入文件
   */
  async _applyTextPatch(filePath, patch, skillName, fileLabel, logger) {
    const original = fs.readFileSync(filePath, 'utf8')
    const result = this._applyTextPatchToString(original, patch)
    if (!result.success) return result

    const backupPath = filePath + `.bak.${Date.now()}`
    fs.copyFileSync(filePath, backupPath)
    fs.writeFileSync(filePath, result.content, 'utf8')
    await this._reloadRegistry(logger)
    return {
      success: true,
      message: `${skillName} ${fileLabel} 已 patch (${result.matches} 处匹配)`,
      mode: 'patch',
      backupPath,
      matches: result.matches
    }
  },

  /**
   * v10.2.0 方案 4：文本 patch 纯字符串处理
   */
  _applyTextPatchToString(original, patch) {
    if (!patch || typeof patch.find !== 'string' || typeof patch.replace !== 'string') {
      return { success: false, error: { code: 'PARAM_INVALID', message: 'patch 必须有 find 和 replace 字符串字段' } }
    }
    const occurrences = original.split(patch.find).length - 1
    if (occurrences === 0) {
      return {
        success: false,
        error: {
          code: 'PATCH_NOT_FOUND',
          message: 'patch.find 文本未在文件中找到',
          hint: `要查找的文本："${patch.find.slice(0, 100)}${patch.find.length > 100 ? '...' : ''}"`
        }
      }
    }
    if (!patch.replaceAll && occurrences > 1) {
      return {
        success: false,
        error: {
          code: 'PATCH_AMBIGUOUS',
          message: `匹配到 ${occurrences} 处，需设置 replaceAll=true 才会全部替换`,
          matches: occurrences
        }
      }
    }
    const newContent = patch.replaceAll
      ? original.split(patch.find).join(patch.replace)
      : original.replace(patch.find, patch.replace)
    return { success: true, content: newContent, matches: occurrences }
  },

  /**
   * v10.2.0 方案 4：JSON Patch（RFC 6902 简化版）
   * 支持 replace / add / remove，路径格式 /数字 或 /字符串
   */
  _applyJsonPatchToString(original, ops) {
    if (!Array.isArray(ops) || ops.length === 0) {
      return { success: false, error: { code: 'PARAM_INVALID', message: 'jsonPatch 必须是非空数组' } }
    }
    let data
    try {
      data = JSON.parse(original)
    } catch (e) {
      return { success: false, error: { code: 'JSON_PARSE_FAILED', message: '文件不是合法 JSON: ' + e.message } }
    }
    const supportedOps = ['replace', 'add', 'remove']
    for (const op of ops) {
      if (!supportedOps.includes(op.op)) {
        return { success: false, error: { code: 'UNSUPPORTED_OP', message: `不支持的 JSON Patch op: ${op.op}（仅支持 replace / add / remove）` } }
      }
      const pathParts = op.path.split('/').filter(Boolean)
      let target = data
      for (let i = 0; i < pathParts.length - 1; i++) {
        const key = pathParts[i]
        if (target[key] === undefined) {
          return { success: false, error: { code: 'PATH_NOT_FOUND', message: `路径不存在: ${op.path}` } }
        }
        target = target[key]
      }
      const lastKey = pathParts[pathParts.length - 1]
      if (op.op === 'replace') {
        if (target[lastKey] === undefined) {
          return { success: false, error: { code: 'PATH_NOT_FOUND', message: `路径不存在: ${op.path}` } }
        }
        target[lastKey] = op.value
      } else if (op.op === 'add') {
        if (Array.isArray(target)) {
          const idx = parseInt(lastKey, 10)
          target.splice(idx, 0, op.value)
        } else {
          target[lastKey] = op.value
        }
      } else if (op.op === 'remove') {
        if (Array.isArray(target)) {
          const idx = parseInt(lastKey, 10)
          target.splice(idx, 1)
        } else {
          delete target[lastKey]
        }
      }
    }
    return { success: true, content: JSON.stringify(data, null, 2) + '\n', matches: ops.length }
  },

  /**
   * v10.2.0：递归删除目录（用于回滚）
   */
  _removeDirSync(dir) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  },

  /**
   * 重新加载技能注册表（清除缓存 + 重新发现）
   */
  async _reloadRegistry(logger) {
    try {
      const { getSkillRegistry, registerWorkspacePseudoSkills } = require('../ipcHandlers/agentHandler')
      const registry = getSkillRegistry()
      if (registry) {
        registry._skills.clear()
        await registry.discover()
        // 重新注册工作区伪技能，避免 workspace_readPage 等工作区工具丢失
        if (typeof registerWorkspacePseudoSkills === 'function') {
          registerWorkspacePseudoSkills()
        }
        logger.info('技能注册表已重新加载（含工作区技能）')
      }
    } catch (e) {
      logger.warn('重新加载技能注册表失败:', e.message)
    }
  },

  _getHelp() {
    return {
      success: true,
      data: {
        message: '技能系统使用指南',
        sections: [
          {
            title: '什么是技能？',
            content: '技能是可扩展的工具模块，让 AI 能够执行特定任务。每个技能定义了参数和执行逻辑。'
          },
          {
            title: '如何创建技能？',
            content: '告诉我你想要什么功能，我会帮你创建。例如："帮我创建一个自密实混凝土配合比设计的技能"'
          },
          {
            title: '如何管理技能？',
            content: '使用"查看我的技能"列表，"删除XX技能"删除，"技能帮助"查看帮助。'
          },
          {
            title: '技能文件位置',
            content: `Windows: C:\\Users\\<用户名>\\.concrete-mixdesign\\skills\\`
          }
        ]
      }
    }
  },

  services: [],

  // ---- 内部工具函数 ----

  /**
   * 递归复制目录（用于删除前备份）
   */
  _copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true })
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        this._copyDirSync(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }
}

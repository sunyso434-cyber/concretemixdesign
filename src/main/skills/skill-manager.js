/**
 * 技能管理 Skill
 * 查看、管理用户自定义技能
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const yaml = require('js-yaml')

module.exports = {
  name: 'manage_skills',
  description: '管理自定义技能。当用户想要查看已有技能、删除技能、或了解技能系统时调用。例如"我有哪些自定义技能"、"删除XX技能"、"技能系统怎么用"。',
  version: '1.0.0',
  category: 'system',

  parameters: {
    action: {
      type: 'string',
      description: '操作类型：list=列表, delete=删除, info=查看信息, source=读取源文件, update=修改技能, help=帮助。不填默认 list',
      required: false,
      enum: ['list', 'delete', 'info', 'source', 'update', 'help']
    },
    skillName: {
      type: 'string',
      description: '技能名称（delete/info/source/update 时必填）',
      required: false
    },
    content: {
      type: 'string',
      description: '新的文件内容（update 时必填）',
      required: false
    },
    file: {
      type: 'string',
      description: '要操作的文件名（update/source 时可选）。蓝图技能可选: meta.yaml, blueprint.yaml, 或 tables/xxx.json。JS/MD技能不需要填',
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
        return await this._updateSkill(skillName, args.content, args.file, context)
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
          filePath
        })
      } catch (error) {
        logger.warn(`解析技能文件失败: ${file.name}`, error)
      }
    }

    // ---- 蓝图技能（目录包含 meta.yaml） ----
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
          name: meta.name || dir.name,
          description: meta.description || '无描述',
          filePath: path.join(userDir, dir.name),
          category: 'blueprint',
          stepCount,
          tableCount,
          llmGenerated
        })
      } catch (error) {
        logger.warn(`解析蓝图技能失败: ${dir.name}`, error)
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
    const blueprintDir = path.join(userDir, skillName)
    const isBlueprint = (
      fs.existsSync(blueprintDir) &&
      fs.statSync(blueprintDir).isDirectory() &&
      fs.existsSync(path.join(blueprintDir, 'meta.yaml'))
    )

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
    const blueprintDir = path.join(userDir, skillName)
    const isBlueprint = (
      fs.existsSync(blueprintDir) &&
      fs.statSync(blueprintDir).isDirectory() &&
      fs.existsSync(path.join(blueprintDir, 'meta.yaml'))
    )

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
    const blueprintDir = path.join(userDir, skillName)
    const isBlueprint = (
      fs.existsSync(blueprintDir) &&
      fs.statSync(blueprintDir).isDirectory() &&
      fs.existsSync(path.join(blueprintDir, 'meta.yaml'))
    )

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

    if (!skillName) {
      return { success: false, error: { code: 'PARAM_MISSING', message: '请指定技能名称' } }
    }
    if (!content) {
      return { success: false, error: { code: 'PARAM_MISSING', message: '请提供新的文件内容' } }
    }

    const userDir = path.join(os.homedir(), '.concrete-mixdesign', 'skills')

    // ---- 蓝图技能 ----
    const blueprintDir = path.join(userDir, skillName)
    const isBlueprint = (
      fs.existsSync(blueprintDir) &&
      fs.statSync(blueprintDir).isDirectory() &&
      fs.existsSync(path.join(blueprintDir, 'meta.yaml'))
    )

    if (isBlueprint) {
      try {
        // 指定了具体文件 → 只更新该文件
        if (file) {
          const filePath = path.join(blueprintDir, file)
          if (!filePath.startsWith(blueprintDir)) {
            return { success: false, error: { code: 'PATH_TRAVERSAL', message: '不允许的文件路径' } }
          }
          // 确保父目录存在（如 tables/xxx.json）
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, content, 'utf8')
          logger.info(`蓝图文件已更新: ${filePath}`)
        } else {
          // 未指定文件 → content 必须是有效的 blueprint.yaml 内容
          const blueprintPath = path.join(blueprintDir, 'blueprint.yaml')
          fs.writeFileSync(blueprintPath, content, 'utf8')
          logger.info(`蓝图 blueprint.yaml 已更新: ${blueprintPath}`)
        }

        // 重新加载注册表
        await this._reloadRegistry(logger)

        return {
          success: true,
          message: `蓝图技能 "${skillName}" 已更新`,
          file: file || 'blueprint.yaml'
        }
      } catch (error) {
        logger.error('更新蓝图技能失败:', error)
        return { success: false, error: { code: 'UPDATE_FAILED', message: error.message } }
      }
    }

    // ---- .js 技能 ----
    const jsPath = path.join(userDir, `${skillName}.js`)
    if (fs.existsSync(jsPath)) {
      try {
        // 备份
        const backupPath = jsPath + `.bak.${Date.now()}`
        fs.copyFileSync(jsPath, backupPath)

        // 写入新内容
        fs.writeFileSync(jsPath, content, 'utf8')

        // 清除 require 缓存
        const resolvedPath = require.resolve(jsPath)
        if (resolvedPath) {
          delete require.cache[resolvedPath]
        }

        // 重新加载注册表
        await this._reloadRegistry(logger)

        return {
          success: true,
          message: `JS技能 "${skillName}" 已更新`,
          backupPath
        }
      } catch (error) {
        logger.error('更新JS技能失败:', error)
        return { success: false, error: { code: 'UPDATE_FAILED', message: error.message } }
      }
    }

    // ---- .md 技能 ----
    const mdPath = path.join(userDir, `${skillName}.md`)
    if (fs.existsSync(mdPath)) {
      try {
        // 备份
        const backupPath = mdPath + `.bak.${Date.now()}`
        fs.copyFileSync(mdPath, backupPath)

        // 写入新内容
        fs.writeFileSync(mdPath, content, 'utf8')

        // 重新加载注册表
        await this._reloadRegistry(logger)

        return {
          success: true,
          message: `MD技能 "${skillName}" 已更新`,
          backupPath
        }
      } catch (error) {
        logger.error('更新MD技能失败:', error)
        return { success: false, error: { code: 'UPDATE_FAILED', message: error.message } }
      }
    }

    return { success: false, error: this.errors.NOT_FOUND, details: { skillName } }
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

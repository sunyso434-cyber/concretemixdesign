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
      description: '操作类型：list=列表, delete=删除, info=查看信息, help=帮助。不填默认 list',
      required: false,
      enum: ['list', 'delete', 'info', 'help']
    },
    skillName: {
      type: 'string',
      description: '技能名称（delete/info 时必填）',
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

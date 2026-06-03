/**
 * 技能管理 Skill
 * 查看、管理用户自定义技能
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

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

    const files = fs.readdirSync(userDir).filter(f => f.endsWith('.js'))
    const skills = []

    for (const file of files) {
      try {
        const filePath = path.join(userDir, file)
        const content = fs.readFileSync(filePath, 'utf8')

        // 简单解析 name 和 description
        const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/)
        const descMatch = content.match(/description:\s*['"]([^'"]+)['"]/)

        skills.push({
          fileName: file,
          name: nameMatch ? nameMatch[1] : file.replace('.js', ''),
          description: descMatch ? descMatch[1] : '无描述',
          filePath
        })
      } catch (error) {
        logger.warn(`解析技能文件失败: ${file}`, error)
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
    const filePath = path.join(userDir, `${skillName}.js`)

    if (!fs.existsSync(filePath)) {
      return { success: false, error: this.errors.NOT_FOUND, details: { skillName } }
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return {
        success: true,
        data: {
          skillName,
          filePath,
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

  services: []
}

// agentHandler 技能管理 + 调试 IPC 域（从 agentHandler.js 拆分，优化项 2，行为不变）
// 由主文件 registerAgentHandlers 调用：registerSkillIpc(ipcMain, deps)
// deps: { getSkillRegistry, getSkillExecutor, getSkillDebugger（函数取当前值）, initSkillSystem, registerWorkspacePseudoSkills }
// 拆分原则：仅移动注册闭包，channel 名、参数、返回结构原样保留。
function registerSkillIpc(ipcMain, deps) {
  const { getSkillRegistry, getSkillExecutor, getSkillDebugger, initSkillSystem, registerWorkspacePseudoSkills } = deps

  // ===== Skill 管理 =====

  ipcMain.handle('skill:listAll', async () => {
    // 如果未初始化，尝试初始化
    if (!getSkillRegistry()) {
      try {
        await initSkillSystem()
      } catch (err) {
        return { success: false, error: 'Skill 系统初始化失败: ' + err.message }
      }
    }
    const skills = getSkillExecutor() ? getSkillExecutor().listSkills() : []
    return { success: true, skills }
  })

  ipcMain.handle('skill:getUserDir', async () => {
    if (!getSkillRegistry()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    return { success: true, dir: getSkillRegistry().getUserDir() }
  })

  ipcMain.handle('skill:getUserSkills', async () => {
    if (!getSkillRegistry()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const skills = getSkillRegistry().getUserSkills()
    return { success: true, skills }
  })

  ipcMain.handle('skill:openUserDir', async () => {
    if (!getSkillRegistry()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const { shell } = require('electron')
    const dir = getSkillRegistry().getUserDir()
    shell.openPath(dir)
    return { success: true }
  })

  ipcMain.handle('skill:reload', async () => {
    if (!getSkillRegistry()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      // 重新发现 skills
      getSkillRegistry()._skills.clear()
      await getSkillRegistry().discover()
      // 重新注册工作区伪技能（避免丢失 workspace_readPage 等）
      registerWorkspacePseudoSkills()
      return { success: true, count: getSkillRegistry().size, names: getSkillRegistry().skillNames }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:getInfo', async (_event, { skillName }) => {
    if (!getSkillRegistry()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const fs = require('fs')
    const path = require('path')
    const userDir = getSkillRegistry().getUserDir()

    // 检查.js文件
    let filePath = path.join(userDir, `${skillName}.js`)
    let isMD = false

    if (!fs.existsSync(filePath)) {
      // 检查.md文件
      filePath = path.join(userDir, `${skillName}.md`)
      isMD = true
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: '技能文件不存在' }
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return { success: true, data: { skillName, filePath, content, isMD } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:delete', async (_event, { skillName }) => {
    if (!getSkillRegistry()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const fs = require('fs')
    const path = require('path')
    const userDir = getSkillRegistry().getUserDir()

    // 检查.js文件
    let filePath = path.join(userDir, `${skillName}.js`)
    if (!fs.existsSync(filePath)) {
      // 检查.md文件
      filePath = path.join(userDir, `${skillName}.md`)
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: '技能文件不存在' }
    }

    try {
      fs.unlinkSync(filePath)
      // 重新加载
      getSkillRegistry()._skills.delete(skillName)
      await getSkillRegistry().discover()
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ===== Skill 调试 =====

  ipcMain.handle('skill:debug:preview', async (_event, { skillName, args }) => {
    if (!getSkillDebugger()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      return getSkillDebugger().previewInstruction(skillName, args || {})
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:debug:validate', async (_event, { skillName }) => {
    if (!getSkillDebugger()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      return getSkillDebugger().validateSkill(skillName)
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:debug:listMD', async () => {
    if (!getSkillDebugger()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    try {
      return getSkillDebugger().listMDSkills()
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('skill:create', async (_event, { skillName, description, functionality, template }) => {
    if (!getSkillRegistry()) {
      return { success: false, error: 'Skill 系统未初始化' }
    }
    const fs = require('fs')
    const path = require('path')
    const userDir = getSkillRegistry().getUserDir()
    const filePath = path.join(userDir, `${skillName}.js`)

    if (fs.existsSync(filePath)) {
      return { success: false, error: { code: 'NAME_EXISTS', message: '技能名称已存在' } }
    }

    // 模板系统：根据 template 类型生成不同骨架
    const templates = {
      query: `/**
 * ${description || '查询类技能'}
 *
 * 功能：从数据库或外部源查询数据，返回结构化结果
 * 示例：查询材料列表、查询历史记录、查询规范条款
 */

module.exports = {
  name: '${skillName}',
  description: '${description || '查询类技能'}',
  version: '1.0.0',
  category: 'query',

  parameters: {
    keyword: {
      type: 'string',
      description: '搜索关键词',
      required: false
    },
    limit: {
      type: 'integer',
      description: '返回条数，默认 10',
      required: false,
      min: 1,
      max: 100
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { keyword, limit = 10 } = args

    logger.info('执行查询: keyword=' + keyword + ', limit=' + limit)

    try {
      // TODO: 在这里实现你的查询逻辑
      // 可以使用 context 中的服务：
      //   context.materialService  - 材料库
      //   context.mixDesignService - 配合比服务

      const results = []

      return {
        success: true,
        data: { results, total: results.length }
      }
    } catch (error) {
      logger.error('查询失败:', error)
      return {
        success: false,
        error: { code: 'QUERY_FAILED', message: '查询失败: ' + error.message }
      }
    }
  }
}
`,

      calculate: `/**
 * ${description || '计算类技能'}
 *
 * 功能：根据输入参数执行数学计算或工程计算
 * 示例：配合比计算、强度预测、成本估算
 */

module.exports = {
  name: '${skillName}',
  description: '${description || '计算类技能'}',
  version: '1.0.0',
  category: 'core',

  parameters: {
    input: {
      type: 'number',
      description: '输入数值',
      required: true,
      min: 0
    },
    unit: {
      type: 'string',
      description: '单位（可选）',
      required: false,
      enum: ['MPa', 'kg/m3', 'mm', '%']
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { input, unit } = args

    logger.info('开始计算: input=' + input + (unit ? ' ' + unit : ''))

    try {
      // TODO: 在这里实现你的计算逻辑
      // 可以使用 context 中的服务：
      //   context.mixDesignService     - 配合比计算
      //   context.mixDesignOptimizer   - 成本优化
      //   context.xgboostPrediction    - 强度预测

      const result = {
        input,
        output: input, // 替换为实际计算结果
        unit: unit || '',
        formula: '待实现'
      }

      return {
        success: true,
        data: result
      }
    } catch (error) {
      logger.error('计算失败:', error)
      return {
        success: false,
        error: { code: 'CALCULATION_FAILED', message: '计算失败: ' + error.message }
      }
    }
  }
}
`,

      check: `/**
 * ${description || '检查类技能'}
 *
 * 功能：校验数据是否符合规范、标准或业务规则
 * 示例：规范合规检查、参数范围校验、数据完整性检查
 */

module.exports = {
  name: '${skillName}',
  description: '${description || '检查类技能'}',
  version: '1.0.0',
  category: 'analysis',

  parameters: {
    data: {
      type: 'object',
      description: '待检查的数据对象',
      required: true
    },
    strict: {
      type: 'boolean',
      description: '是否严格模式（默认 false）',
      required: false
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { data, strict = false } = args

    logger.info('开始检查: strict=' + strict)

    try {
      // TODO: 在这里实现你的检查逻辑
      // 可以使用 context 中的服务：
      //   context.materialService  - 材料库

      const issues = []     // 发现的问题
      const warnings = []   // 警告信息

      // 示例检查逻辑：
      // if (!data.strength) {
      //   issues.push({ field: 'strength', message: '缺少强度等级' })
      // }

      const passed = issues.length === 0

      return {
        success: true,
        data: {
          passed,
          issues,
          warnings,
          summary: passed ? '检查通过' : '发现 ' + issues.length + ' 个问题'
        }
      }
    } catch (error) {
      logger.error('检查失败:', error)
      return {
        success: false,
        error: { code: 'CHECK_FAILED', message: '检查失败: ' + error.message }
      }
    }
  }
}
`
    }

    // 选择模板，默认用 query
    const selectedTemplate = templates[template] || templates.query
    const skillCode = selectedTemplate

    try {
      // 确保目录存在
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true })
      }
      fs.writeFileSync(filePath, skillCode, 'utf8')
      // 重新加载
      await getSkillRegistry().discover()
      return { success: true, data: { skillName, filePath } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = { registerSkillIpc }
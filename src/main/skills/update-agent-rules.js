/**
 * update_agent_rules Skill - 把用户口述的新规则写入 agent.md
 *
 * 触发场景：用户说"以后报告都用仿宋"/"记住 C30 用 P.O 42.5"/"加一条规则 xxx"时调用。
 *
 * 设计要点：
 * - 走 ask_user skill 弹确认框，用户点"同意写入"才真正落盘（老板 2026-07-23 拍板）
 * - 只支持列表项增删（addItem / removeItem），不整段替换，防止误删核心规则
 * - 全部段落可写（老板 2026-07-23 拍板）
 * - 段落/子段落不存在时自动创建（add 场景）
 * - 复用 AgentMdService.saveToFile（已有 .bak 备份 + 串行队列 + chokidar 监听）
 * - 复用 AgentMdParser.formatToMarkdown（parsed → markdown 字符串）
 * - 不依赖外部服务：services: []
 *
 * 数据流：
 *   getCached() 拿深拷贝 parsed → 在副本上应用修改 → ask_user 确认
 *   → formatToMarkdown(parsed) → saveToFile(markdown) → chokidar 自动刷新缓存
 *
 * 并发说明：
 *   设置界面的 agent.md 内嵌编辑入口已于 2026-07-23 移除，外部并发写入风险极低。
 *   残留并发可能仅来自 LearningService.autoAcceptHighConfidence（后台高置信度
 *   偏好自动沉淀），与本 skill 写入同走 saveToFile 串行队列，.bak 备份兜底。
 */

const askUser = require('./ask-user')
const { AgentMdParser } = require('../agent/agentMd/AgentMdParser')

const skill = {
  name: 'update_agent_rules',
  description: '把用户口述的新规则写入 agent.md（智能助手规则文件）。当用户说"以后xxx都yyy"/"记住xxx"/"加一条规则xxx"/"删掉xxx规则"时调用。会先弹确认框给用户看要写什么，同意后才落盘。只支持列表项增删，不改段落结构。',
  version: '1.0.0',
  category: 'agent',
  isWrite: true,
  services: [],

  parameters: {
    section: {
      type: 'string',
      description: '一级标题名（agent.md 里的 ## 段落名），如"业务规则"/"回复规范"/"注意事项"',
      required: true
    },
    subSection: {
      type: 'string',
      description: '二级标题名（agent.md 里的 ### 子段落名），如"材料"/"报告"/"工艺"。不存在会自动创建',
      required: true
    },
    action: {
      type: 'string',
      description: '操作类型：addItem=新增一条列表项；removeItem=删除一条已有列表项',
      required: true,
      enum: ['addItem', 'removeItem']
    },
    item: {
      type: 'string',
      description: '列表项文本（不含前导的 "- "），如"C30 混凝土用 P.O 42.5 水泥"',
      required: true
    }
  },

  errors: {
    ITEM_EXISTS: {
      code: 'ITEM_EXISTS',
      message: '该规则项已存在，不重复添加',
      hint: '检查 item 文本是否与已有项重复',
      recovery: 'none'
    },
    SECTION_NOT_FOUND: {
      code: 'SECTION_NOT_FOUND',
      message: '一级段落不存在',
      hint: 'removeItem 操作要求段落已存在；addItem 会自动创建',
      recovery: 'none'
    },
    SUBSECTION_NOT_FOUND: {
      code: 'SUBSECTION_NOT_FOUND',
      message: '二级子段落不存在',
      hint: 'removeItem 操作要求子段落已存在；addItem 会自动创建',
      recovery: 'none'
    },
    ITEM_NOT_FOUND: {
      code: 'ITEM_NOT_FOUND',
      message: '要删除的规则项不存在',
      hint: '检查 item 文本是否与已有项完全一致',
      recovery: 'none'
    },
    INVALID_ACTION: {
      code: 'INVALID_ACTION',
      message: '不支持的操作',
      hint: 'action 只能是 addItem 或 removeItem',
      recovery: 'none'
    },
    USER_REJECTED: {
      code: 'USER_REJECTED',
      message: '用户取消了写入',
      hint: '用户在确认框点了取消，agent.md 未被修改',
      recovery: 'none'
    },
    WRITE_FAILED: {
      code: 'WRITE_FAILED',
      message: '写入 agent.md 失败',
      hint: '可能是文件被占用或磁盘空间不足，.bak 备份已保留',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { section, subSection, action, item } = args
    const { logger } = context

    // 1. 读当前 agent.md（getCached 返回深拷贝，可安全修改）
    const { getInstance: getAgentMdService } = require('../agent/agentMd')
    const agentMdService = getAgentMdService()
    const cached = agentMdService.getCached()
    const parsed = cached.parsed

    // 2. 在 parsed 副本上应用修改，同时构建预览文本
    //    若校验失败（重复添加/删除不存在项）直接返回，不弹确认框
    let preview

    if (action === 'addItem') {
      // section 不存在 → 自动创建
      let sectionObj = parsed.sections.find(s => s.title === section)
      if (!sectionObj) {
        sectionObj = { title: section, subSections: [] }
        parsed.sections.push(sectionObj)
        logger?.info(`[update_agent_rules] 自动创建一级段落: ## ${section}`)
      }
      // subSection 不存在 → 自动创建
      let subObj = sectionObj.subSections.find(s => s.title === subSection)
      if (!subObj) {
        subObj = { title: subSection, items: [], rawText: '' }
        sectionObj.subSections.push(subObj)
        logger?.info(`[update_agent_rules] 自动创建二级段落: ### ${subSection}`)
      }
      // 已存在 → 不重复加
      if (subObj.items.includes(item)) {
        logger?.warn(`[update_agent_rules] 规则项已存在: ${item}`)
        return { success: false, error: this.errors.ITEM_EXISTS, message: `规则已存在：${item}` }
      }
      subObj.items.push(item)
      preview = `段落：## ${section} / ### ${subSection}\n操作：新增列表项\n内容：- ${item}`
    } else if (action === 'removeItem') {
      // removeItem 不自动创建，找不到直接报错
      let sectionObj = parsed.sections.find(s => s.title === section)
      if (!sectionObj) {
        return { success: false, error: this.errors.SECTION_NOT_FOUND, message: `一级段落不存在：${section}` }
      }
      let subObj = sectionObj.subSections.find(s => s.title === subSection)
      if (!subObj) {
        return { success: false, error: this.errors.SUBSECTION_NOT_FOUND, message: `二级子段落不存在：${subSection}` }
      }
      const idx = subObj.items.indexOf(item)
      if (idx === -1) {
        return { success: false, error: this.errors.ITEM_NOT_FOUND, message: `要删除的规则项不存在：${item}` }
      }
      subObj.items.splice(idx, 1)
      preview = `段落：## ${section} / ### ${subSection}\n操作：删除列表项\n内容：- ${item}`
    } else {
      return { success: false, error: this.errors.INVALID_ACTION, message: `不支持的操作：${action}` }
    }

    // 3. 弹确认框给用户看预览
    logger?.info(`[update_agent_rules] 请求确认: ${action} "${item}" → ## ${section} / ### ${subSection}`)
    const confirm = await askUser.execute({
      inputType: 'choice',
      question: `要把这条规则写入 agent.md 吗？\n\n${preview}\n\n同意才会真正写入，取消则不修改。`,
      options: ['同意写入', '取消']
    }, context)

    // 4. 用户取消或超时 → 不写盘（parsed 副本被 GC，主缓存未动）
    if (!confirm.success || confirm.answer !== '同意写入') {
      logger?.info('[update_agent_rules] 用户取消写入，agent.md 未修改')
      return { success: false, error: this.errors.USER_REJECTED, message: '用户取消了写入' }
    }

    // 5. 用户同意 → formatToMarkdown + saveToFile（saveToFile 内部会再 parse 校验 + .bak 备份）
    try {
      const markdown = AgentMdParser.formatToMarkdown(parsed)
      await agentMdService.saveToFile(markdown)
      logger?.info('[update_agent_rules] 写入成功')
      return {
        success: true,
        written: true,
        preview,
        message: `已写入 agent.md：${preview}`
      }
    } catch (err) {
      logger?.error('[update_agent_rules] 写盘失败:', err)
      return { success: false, error: this.errors.WRITE_FAILED, message: `写入失败：${err.message}` }
    }
  }
}

module.exports = skill

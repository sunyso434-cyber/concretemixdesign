/**
 * use_skill 元工具（技能目录式路由 · 方案一）
 *
 * 角色：catalog 路由模式下唯一按需展开技能完整说明的入口。
 * - 常驻工具每轮必带 schema，直接调用即可；
 * - 目录中的其他技能，LLM 必须先调本工具拿到该技能的完整参数定义，
 *   下一轮起该技能 schema 才会进入 tools 集合。
 *
 * 兜底：LLM 跳过本工具直接调用未加载技能时，由 toolExecutor 拦截自动展开
 * （needs_reload=true），不会死锁——两条路都通向「加载 → 正确参数重调」。
 */

module.exports = {
  // ===== 元数据 =====
  name: 'use_skill',
  version: '1.0.0',
  category: 'agent',
  description:
    '按需加载一个技能的完整使用说明（参数定义）。当需要使用的技能不在常驻工具列表中时，' +
    '先调用本工具（name=技能名）获取其完整参数定义，再用正确参数正式调用该技能。' +
    '技能名必须来自系统提示词中的「当前可用技能」目录，禁止编造。',

  // ===== 参数定义 =====
  parameters: {
    name: {
      type: 'string',
      description: '要加载的技能名（必须是技能目录里真实存在的名字）',
      required: true
    }
  },

  // ===== 执行逻辑 =====
  /**
   * @param {object} args - { name }
   * @param {object} context - DynamicContextProvider 注入的上下文
   * @param {{ sessionId?: string }} [runtimeCtx] - 运行时上下文（SkillExecutor 透传）
   */
  async execute(args, context, runtimeCtx = {}) {
    const skillName = args && args.name

    // registry 获取沿用 create-skill.js 的既有模式：execute 内 lazy require，
    // 避免 skills 目录与 agent/ipcHandlers 层在模块加载期形成循环依赖
    const { getSkillRegistry } = require('../ipcHandlers/agentHandler')
    const registry = getSkillRegistry()
    const skill = (registry && typeof registry.getSkill === 'function')
      ? registry.getSkill(skillName)
      : null

    // 1) 技能不存在：引导看目录，不抛异常（toolExecutor 按 success:false 处理）
    if (!skill) {
      return {
        success: false,
        error: `技能 "${skillName}" 不存在`,
        hint: '请核对系统提示词「当前可用技能」目录中的名字后再试，不要编造技能名'
      }
    }

    // 2) soft trigger 方法论技能：由 SoftSkillInjector 根据对话内容自动激活，
    //    不进 tools、不允许手动加载（避免双轨冲突）
    if (skill._isMDSkill && skill._triggerMode === 'soft') {
      return {
        success: false,
        error: `技能 "${skillName}" 是方法论技能，由系统根据对话内容自动激活`,
        hint: '无需也无法手动加载，正常继续对话即可'
      }
    }

    // 3) 正常加载：登记到会话已加载集合（下一轮进入 tools）+ 返回完整说明
    const sessionLoadedSkills = require('../agent/sessionLoadedSkills')
    const sessionId = runtimeCtx.sessionId || context.sessionId || null
    if (sessionId) sessionLoadedSkills.load(sessionId, skillName)

    return {
      success: true,
      data: {
        loaded: skillName,
        description: skill.description,
        parameters: skill.parameters || {},
        schema: typeof registry.getSkillSchema === 'function'
          ? registry.getSkillSchema(skillName)
          : null,
        note: '加载成功。从下一轮起可直接用上方参数定义调用该技能；本次若已想清楚参数也可立即重调。'
      }
    }
  }
}

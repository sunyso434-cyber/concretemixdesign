/**
 * 向用户提问 Skill
 *
 * 让 Agent 在需求模糊时主动向用户提问，前端弹窗收集用户回答后回灌给 LLM 继续推理。
 *
 * 设计要点：
 * - 不替代 requiresConfirmation: true 的"危险操作确认"机制（那是 save_mix_design 等专用）
 * - 本 skill 走 Orchestrator.requestConfirmation 跨进程等待（90s 超时，<会话锁 120s）
 * - 通过 context.orchestrator 调用（由 SkillExecutor.execute 第三参数 runtimeCtx 注入）
 * - 不依赖任何外部服务：services: []
 * - 错误码：E_ASK_USER_REJECTED / E_ASK_USER_TIMEOUT / E_ASK_USER_NO_ORCHESTRATOR / E_ASK_USER_NO_SESSION
 */

const skill = {
  name: 'ask_user',
  description: '向用户提问澄清需求。当用户需求模糊、缺少关键参数（如材料产地、强度等级、外加剂要求）时调用。前端会弹窗收集用户回答，Agent 拿到回答后继续推理。不要每轮都调用——仅在关键信息缺失时调用。',
  version: '1.0.0',
  category: 'agent',
  // 显式空数组：DynamicContextProvider.getServices 要求 services 字段必须声明
  services: [],

  parameters: {
    question: {
      type: 'string',
      description: '要问用户的问题（自然语言，简洁明了，一次只问一个核心问题）',
      required: true
    },
    inputType: {
      type: 'string',
      description: '输入类型：text 自由文本（默认）/ choice 选项选择',
      required: false,
      enum: ['text', 'choice'],
      default: 'text'
    },
    options: {
      type: 'array',
      description: 'inputType=choice 时的选项列表',
      required: false,
      items: { type: 'string' }
    },
    placeholder: {
      type: 'string',
      description: 'inputType=text 时的输入框占位提示',
      required: false
    },
    defaultValue: {
      type: 'string',
      description: '用户跳过时的默认值（可选）',
      required: false
    }
  },

  errors: {
    E_ASK_USER_REJECTED: {
      code: 'E_ASK_USER_REJECTED',
      message: '用户取消了回答',
      hint: '用户主动取消，Agent 应停止当前任务并询问下一步',
      recovery: 'none'
    },
    E_ASK_USER_TIMEOUT: {
      code: 'E_ASK_USER_TIMEOUT',
      message: '用户 90 秒未回答',
      hint: '可提示用户超时，或使用 defaultValue 继续推理',
      recovery: 'retry'
    },
    E_ASK_USER_NO_ORCHESTRATOR: {
      code: 'E_ASK_USER_NO_ORCHESTRATOR',
      message: 'context 未注入 orchestrator',
      hint: '请联系开发者检查 SkillExecutor runtimeCtx 注入',
      recovery: 'none'
    },
    E_ASK_USER_NO_SESSION: {
      code: 'E_ASK_USER_NO_SESSION',
      message: '会话已销毁或窗口已关闭',
      hint: '用户可能关闭了窗口',
      recovery: 'none'
    },
    E_ASK_USER_NO_WEB_CONTENTS: {
      code: 'E_ASK_USER_NO_WEB_CONTENTS',
      message: 'webContents 不可用',
      hint: '窗口可能已关闭',
      recovery: 'none'
    },
    E_ASK_USER_NESTED: {
      code: 'E_ASK_USER_NESTED',
      message: '已有进行中的提问，不支持嵌套',
      hint: '请等待上一次提问完成',
      recovery: 'none'
    }
  },

  async execute(args, context) {
    const { question, inputType = 'text', options = [], placeholder, defaultValue } = args
    const { orchestrator, logger } = context

    if (!orchestrator || typeof orchestrator.requestConfirmation !== 'function') {
      return {
        success: false,
        error: 'context 未注入 orchestrator，无法发起提问。请联系开发者检查 SkillExecutor runtimeCtx 注入。'
      }
    }

    logger?.info(`[ask_user] 提问: "${question.slice(0, 50)}" inputType=${inputType}`)

    try {
      const result = await orchestrator.requestConfirmation({
        toolName: 'ask_user',
        question,
        inputType,
        options,
        placeholder,
        defaultValue
      })
      // result 形如 { answer: '用户输入' }
      // 若用户提交空文本 + 有 defaultValue，返回 defaultValue
      const answer = result?.answer || defaultValue || ''
      return {
        success: true,
        answered: !!result?.answer,
        answer
      }
    } catch (err) {
      const msg = err?.message || String(err)
      logger?.warn(`[ask_user] 失败: ${msg}`)

      if (msg === 'USER_REJECTED') {
        return { success: false, error: '用户取消了回答（主动点取消按钮）' }
      }
      if (msg === 'USER_CONFIRMATION_TIMEOUT') {
        // 超时时若有 defaultValue，降级使用
        if (defaultValue) {
          return {
            success: true,
            answered: false,
            answer: defaultValue,
            note: '用户超时未回答，已使用 defaultValue'
          }
        }
        return { success: false, error: '用户 90 秒未回答，已超时' }
      }
      if (msg === 'NO_WEB_CONTENTS' || msg === 'WEB_CONTENTS_SEND_FAILED') {
        return { success: false, error: '窗口已关闭或不可用，无法弹窗提问' }
      }
      if (msg.includes('已有进行中的确认请求')) {
        return { success: false, error: '已有进行中的提问，不支持嵌套调用' }
      }
      return { success: false, error: `提问失败: ${msg}` }
    }
  }
}

module.exports = skill

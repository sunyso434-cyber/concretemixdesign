/**
 * 向用户提问 Skill（项目唯一的用户确认/澄清机制）
 *
 * 让 Agent 在需求模糊时主动向用户提问，前端弹窗收集用户回答后回灌给 LLM 继续推理。
 * 也是 save/update/delete 等危险操作的前端确认通道。
 *
 * 支持三种 inputType：
 * - text：自由文本回答（澄清需求）
 * - choice：选项选择（删除确认、状态选择、二选一），所有 choice 都带"其他"输入框
 * - form：结构化字段编辑（保存前确认/改字段）
 *
 * 设计要点：
 * - 项目唯一的用户确认机制（v10.x 取代了 requiresConfirmation: true 框架）
 * - 本 skill 走 Orchestrator.requestConfirmation 跨进程等待（90s 超时，<会话锁 120s）
 * - 通过 context.orchestrator 调用（由 SkillExecutor.execute 第三参数 runtimeCtx 注入）
 * - 不依赖任何外部服务：services: []
 * - 错误码：E_ASK_USER_REJECTED / E_ASK_USER_TIMEOUT / E_ASK_USER_NO_ORCHESTRATOR / E_ASK_USER_NO_SESSION / E_ASK_USER_FORM_FIELDS_EMPTY
 */

const skill = {
  name: 'ask_user',
  description: '向用户提问澄清需求或确认操作。inputType=text 自由文本（澄清需求）；inputType=choice 选项选择（删除确认/二选一，所有场景都带"其他"输入框）；inputType=form 结构化表单（保存前确认/改字段）。',
  version: '2.0.0',
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
      description: '输入类型：text 自由文本（默认）/ choice 选项选择 / form 结构化字段编辑',
      required: false,
      enum: ['text', 'choice', 'form'],
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
      description: '用户跳过时的默认值（可选，text/choice 模式用）',
      required: false
    },
    fields: {
      type: 'array',
      description: 'inputType=form 时的表单字段定义，每项 { key, label, type, value }，type 支持 string/number/boolean/enum',
      required: false,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string', enum: ['string', 'number', 'boolean', 'enum'] },
          value: {},
          options: { type: 'array', items: { type: 'string' }, description: 'type=enum 时的选项' }
        }
      }
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
      message: '用户 90 秒未回答，已超时',
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
    },
    E_ASK_USER_FORM_FIELDS_EMPTY: {
      code: 'E_ASK_USER_FORM_FIELDS_EMPTY',
      message: 'form 模式必须传 fields（至少 1 个字段）',
      hint: 'form 模式用于让用户编辑/确认结构化字段，必须有字段定义',
      recovery: 'none'
    }
  },

  async execute(args, context) {
    const { question, inputType = 'text', options = [], placeholder, defaultValue, fields } = args
    const { orchestrator, logger } = context

    if (!orchestrator || typeof orchestrator.requestConfirmation !== 'function') {
      return {
        success: false,
        error: this.errors.E_ASK_USER_NO_ORCHESTRATOR
      }
    }

    // form 模式校验
    if (inputType === 'form') {
      if (!Array.isArray(fields) || fields.length === 0) {
        return {
          success: false,
          error: this.errors.E_ASK_USER_FORM_FIELDS_EMPTY
        }
      }
      // 校验每个 field 都有 key 和 label
      for (const f of fields) {
        if (!f.key || !f.label) {
          return {
            success: false,
            error: { code: 'E_ASK_USER_FORM_FIELD_INVALID', message: `field 缺少 key 或 label: ${JSON.stringify(f)}` }
          }
        }
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
        defaultValue,
        fields: inputType === 'form' ? fields : undefined
      })

      // form 模式：返回 values
      if (inputType === 'form') {
        return {
          success: true,
          values: result?.values || {}
        }
      }
      // text/choice 模式：返回 answer
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
        return { success: false, error: this.errors.E_ASK_USER_REJECTED }
      }
      if (msg === 'USER_CONFIRMATION_TIMEOUT') {
        if (defaultValue) {
          return {
            success: true,
            answered: false,
            answer: defaultValue,
            note: '用户超时未回答，已使用 defaultValue'
          }
        }
        return { success: false, error: this.errors.E_ASK_USER_TIMEOUT }
      }
      if (msg === 'NO_WEB_CONTENTS' || msg === 'WEB_CONTENTS_SEND_FAILED') {
        return { success: false, error: this.errors.E_ASK_USER_NO_WEB_CONTENTS }
      }
      if (msg.includes('已有进行中的确认请求')) {
        return { success: false, error: this.errors.E_ASK_USER_NESTED }
      }
      return { success: false, error: `提问失败: ${msg}` }
    }
  }
}

module.exports = skill

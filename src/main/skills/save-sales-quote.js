/**
 * 保存销售报价 Skill
 * 保存销售报价方案到历史记录（salesQuoteHistories）
 *
 * v10.x 流程（SPEC 3.4）：
 * 1. 调 ask_user form 模式弹窗确认/修改（fields: strengthGrade/concreteType/slump/remarks）
 * 2. 用户确认 → salesQuoteHistory.saveQuote(values) 写入
 * 3. 用户取消 → 不保存
 *
 * 不再用 requiresConfirmation 框架（v10.x 彻底删除），改用 ask_user form 模式。
 *
 * 注意：销售报价历史不在 audit_logs 覆盖范围内（SPEC 4.3 只覆盖方案/基准）。
 */

const askUser = require('./ask-user')

module.exports = {
  name: 'save_sales_quote',
  description: '保存销售报价到历史记录（salesQuoteHistories 表）。**必填 strengthGrade 和 concreteType**（其他可选）。弹窗（form）让用户确认/改强度、类型、坍落度、备注。**注意：销售报价历史不在 audit_logs 覆盖范围内**（SPEC 4.3 只覆盖方案/基准）。',
  version: '2.0.0',
  category: 'save',

  parameters: {
    strengthGrade: {
      type: 'string',
      description: '强度等级，如 C30',
      required: true
    },
    concreteType: {
      type: 'string',
      description: '混凝土类型，如 普通',
      required: true
    },
    slump: {
      type: 'number',
      description: '坍落度(mm)',
      required: false
    },
    basicMixId: {
      type: 'integer',
      description: '基准配合比ID（可选）',
      required: false
    },
    basicMixName: {
      type: 'string',
      description: '基准配合比名称（可选）',
      required: false
    },
    pricingParams: {
      type: 'object',
      description: '定价参数（可选）',
      required: false
    },
    resultSnapshot: {
      type: 'object',
      description: '报价结果快照（可选）',
      required: false
    },
    materialDetails: {
      type: 'object',
      description: '材料详情（可选）',
      required: false
    },
    materialPriceOverrides: {
      type: 'object',
      description: '材料价格覆盖（可选）',
      required: false
    },
    selectedPumpingItems: {
      type: 'object',
      description: '已选泵送费项目（可选）',
      required: false
    },
    remarks: {
      type: 'string',
      description: '备注（可选）',
      required: false
    }
  },

  errors: {
    SAVE_FAILED: {
      code: 'SAVE_FAILED',
      message: '保存报价失败',
      hint: '请检查报价数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { salesQuoteHistory, logger } = context

    try {
      // 1. 弹窗确认（ask_user form 模式）
      const confirm = await askUser.execute({
        inputType: 'form',
        question: '确认保存销售报价吗？可调整强度、类型、坍落度、备注。',
        fields: [
          { key: 'strengthGrade', label: '强度等级', type: 'string', value: args.strengthGrade || '' },
          { key: 'concreteType', label: '混凝土类型', type: 'string', value: args.concreteType || '' },
          { key: 'slump', label: '坍落度(mm)', type: 'number', value: args.slump != null ? args.slump : 180 },
          { key: 'remarks', label: '备注', type: 'string', value: args.remarks || '' }
        ]
      }, context)
      if (!confirm.success) {
        return { success: false, error: '用户未确认保存' }
      }

      // 2. 用 values 写入
      const payload = {
        ...args,
        strengthGrade: confirm.values.strengthGrade,
        concreteType: confirm.values.concreteType,
        slump: Number(confirm.values.slump),
        remarks: confirm.values.remarks || ''
      }

      logger.info(`[save_sales_quote] 保存报价: ${payload.strengthGrade} ${payload.concreteType}`)
      const saved = await salesQuoteHistory.saveQuote(payload)
      return {
        success: true,
        type: 'save_result',
        message: `报价方案已保存，ID: ${saved.id}`,
        data: saved
      }
    } catch (error) {
      logger.error('保存报价失败:', error)
      return { success: false, error: this.errors.SAVE_FAILED, details: { originalError: error.message } }
    }
  },

  services: ['salesQuoteHistory']
}

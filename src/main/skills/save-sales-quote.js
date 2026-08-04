/**
 * 保存销售报价 Skill
 * 保存销售报价方案到历史记录（salesQuoteHistories）
 *
 * v10.10 流程（双模式）：
 * 1. 调 ask_user form 模式弹窗确认/修改（fields: strengthGrade/concreteType/slump/remarks + quoteMode）
 * 2. 用户确认 → salesQuoteHistory.saveQuote(values) 写入
 * 3. 用户取消 → 不保存
 *
 * v10.10 新增字段（与 reverse/forward 双模式配套）：
 * - quoteMode: 'reverse' | 'forward' | null（legacy）
 * - polishStrategy: reverse 模式的包装策略
 * - polishedUnitPrices: reverse 模式包装后的材料单价列表
 * - equipmentPurchaseCost / equipmentAmortizeVolume / equipmentUnitAmortization: forward 模式的设备摊销参数
 *
 * 注意：销售报价历史不在 audit_logs 覆盖范围内（SPEC 4.3 只覆盖方案/基准）。
 */

const askUser = require('./ask-user')

module.exports = {
  name: 'save_sales_quote',
  description: '保存销售报价到历史记录（salesQuoteHistories 表）。**必填 strengthGrade 和 concreteType**（其他可选）。弹窗（form）让用户确认/改强度、类型、坍落度、备注、模式(reverse/forward)。**v10.10 新增**：quoteMode/polishStrategy/polishedUnitPrices/equipment* 字段。**注意：销售报价历史不在 audit_logs 覆盖范围内**（SPEC 4.3 只覆盖方案/基准）。',
  version: '3.0.0',
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
      description: '基准配合比ID（可选，legacy 用）',
      required: false
    },
    basicMixName: {
      type: 'string',
      description: '基准配合比名称（可选，legacy 用）',
      required: false
    },
    mixDesignId: {
      type: 'integer',
      description: '正式方案 ID（v10.10 新增）',
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
    },
    // v10.10 新增
    quoteMode: {
      type: 'string',
      description: '报价模式：reverse (普通混凝土) / forward (特殊混凝土)，缺省 null 视为 legacy',
      required: false
    },
    polishStrategy: {
      type: 'string',
      description: 'reverse 模式的包装策略：none / material_price / manufacturing / labor',
      required: false
    },
    polishedUnitPrices: {
      type: 'array',
      description: 'reverse 模式包装后的材料单价列表 [{materialId, materialName, originalPrice, polishedPrice, clamped}]',
      required: false
    },
    equipmentPurchaseCost: {
      type: 'number',
      description: 'forward 模式设备采购价（元）',
      required: false
    },
    equipmentAmortizeVolume: {
      type: 'number',
      description: 'forward 模式预计总摊销方量（m³）',
      required: false
    },
    equipmentUnitAmortization: {
      type: 'number',
      description: 'forward 模式单方设备摊销费（元/m³）',
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
    const { salesQuoteHistory, logger, toolCallId } = context

    try {
      // 1. 弹窗确认（ask_user form 模式）
      const confirm = await askUser.execute({
        inputType: 'form',
        question: `确认保存销售报价吗？可调整强度、类型、坍落度、备注。当前模式: ${args.quoteMode || 'legacy（兼容旧数据）'}`,
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

      // 2. 用 values 写入（v0.6.0 Task 1.12：传 requestId=toolCallId 幂等，重跑同 tool_call 不重复写）
      const payload = {
        ...args,
        strengthGrade: confirm.values.strengthGrade,
        concreteType: confirm.values.concreteType,
        slump: Number(confirm.values.slump),
        remarks: confirm.values.remarks || '',
        requestId: toolCallId || null
      }

      logger.info(`[save_sales_quote] 保存报价: ${payload.strengthGrade} ${payload.concreteType} mode=${payload.quoteMode || 'legacy'} requestId=${toolCallId || 'none'}`)
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


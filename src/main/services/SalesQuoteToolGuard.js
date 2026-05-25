const SALES_QUOTE_KEYWORDS = [
  '报价',
  '报个价',
  '价格',
  '单方',
  '销售',
  '客户解释',
  '为什么贵',
  '怎么报价',
  '成交价',
  '底线价'
]

const MIX_DESIGN_AUTH_KEYWORDS = [
  '授权生成',
  '同意生成',
  '允许生成',
  '可以生成',
  '生成新配合比',
  '设计新配合比',
  '按新配合比',
  '先设计配合比'
]

const BLOCKED_IN_QUOTE_FLOW = new Set([
  'list_available_materials',
  'calculate_mix_design',
  'optimize_mix_cost',
  'compare_materials',
  'predict_performance'
])

function isSalesQuoteIntent(text) {
  const value = String(text || '')
  return SALES_QUOTE_KEYWORDS.some(keyword => value.includes(keyword))
}

function hasExplicitMixDesignAuthorization(text) {
  const value = String(text || '')
  return MIX_DESIGN_AUTH_KEYWORDS.some(keyword => value.includes(keyword))
}

function shouldBlockTool(toolName, context = {}) {
  if (!BLOCKED_IN_QUOTE_FLOW.has(toolName)) return false
  if (!context.isSalesQuoteIntent) return false
  return !context.userApprovedMixDesignForQuote
}

function buildBlockedToolResult(toolName) {
  return {
    success: false,
    type: 'sales_quote_action_required',
    blocked: true,
    blockedTool: toolName,
    requiresUserConfirmation: true,
    error: '销售报价场景不能未经用户确认自动生成配合比或选择材料。',
    hint: '请先告诉用户：没有可用基础配合比时，需要用户选择已有基础配合比，或明确授权生成新配合比后，才能进入配合比设计流程。'
  }
}

module.exports = {
  isSalesQuoteIntent,
  hasExplicitMixDesignAuthorization,
  shouldBlockTool,
  buildBlockedToolResult
}

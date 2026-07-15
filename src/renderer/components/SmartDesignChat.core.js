import { MATERIAL_TYPE_MAP } from '../utils/mixDesignParser'

export const ANALYSIS_RESULT_KEYS = [
  'materialInfluenceAnalysis',
  'mixDesignInfluenceAnalysis',
  'optimalMixDesignRecommendation',
  'adjustmentSuggestions',
  'furtherTestSuggestions',
  'comprehensiveEvaluation',
]

export const CONTRAST_MATERIAL_LABELS = {
  cement: '水泥',
  flyAsh: '粉煤灰',
  slag: '矿渣粉',
  lithiumSlag: '锂渣',
  compositePowder: '复合粉',
  fineAggregate1: '细骨料1',
  fineAggregate2: '细骨料2',
  coarseAggregate: '粗骨料',
  superplasticizer: '减水剂'
}

/** 主进程 analyze 返回的是 parse 后的报告对象；兼容带 reply 字符串的旧形态 */
export function extractAnalysisPayload(raw) {
  if (!raw || typeof raw !== 'object') return { report: null, textualReply: null }
  if (typeof raw.reply === 'string') {
    const reply = raw.reply.trim()
    try {
      const code = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = code ? code[1].trim() : (reply.match(/\{[\s\S]*\}/)?.[0] || reply)
      const report = JSON.parse(jsonStr)
      return { report, textualReply: reply }
    } catch {
      return { report: null, textualReply: reply }
    }
  }
  if (ANALYSIS_RESULT_KEYS.some(key => raw[key] != null)) {
    return { report: raw, textualReply: null }
  }
  return { report: null, textualReply: null }
}

export function removeContrastData(preprocessedData) {
  if (!preprocessedData) return preprocessedData
  const { contrast, ...rest } = preprocessedData
  return rest
}

export function createToolSummary(toolName, args = {}) {
  if (toolName === 'list_available_materials') {
    return args.type ? `材料类型：${args.type}` : '全部材料'
  }
  if (toolName === 'calculate_mix_design') {
    return [args.strength, args.slump ? `坍落度 ${args.slump}mm` : null].filter(Boolean).join('|')
  }
  if (toolName === 'optimize_mix_cost') {
    return [args.strength, args.slump ? `坍落度 ${args.slump}mm` : null, args.gridStep ? `步长 ${args.gridStep}` : null].filter(Boolean).join('|')
  }
  if (toolName === 'predict_performance') {
    return '预测强度、减水剂掺量和容重'
  }
  return ''
}

export function mergeToolEvent(toolEvents = [], nextEvent) {
  const id = nextEvent.id || `${nextEvent.toolName}-${toolEvents.length}`
  const index = toolEvents.findIndex(item => item.id === id)
  const next = { ...nextEvent, id }
  if (index < 0) {
    return [...toolEvents, next]
  }
  return toolEvents.map((item, i) => i === index ? { ...item, ...next } : item)
}

/** Excel 槽位上的类型与材料库 type 对齐（减水剂在库中常为「减水剂」） */
export function materialMatchesSlotType(mat, slotType) {
  if (!mat?.type || !slotType) return false
  if (slotType === '外加剂') {
    return mat.type === '外加剂' || mat.type === '减水剂'
  }
  return mat.type === slotType
}

/** 某条配合比中仍为空的材料槽（需用户从库中选择） */
export function getUnfilledMaterialSlotsForMix(mix, row) {
  const slots = []
  const mapRow = row || {}
  for (const [key, excelName] of Object.entries(mix.materials || {})) {
    if (!excelName || typeof excelName !== 'string') continue
    const slotType = MATERIAL_TYPE_MAP[key]
    if (!slotType) continue
    const current = mapRow[key]
    if (current != null && typeof current === 'object') continue
    slots.push({ mixId: mix.id, key, type: slotType, token: `${excelName}(${slotType})` })
  }
  return slots
}

/** 按 Excel 行顺序，列出仍缺材料的配合比（用于逐条补充） */
export function buildPerMixMaterialQueue(mixDesigns, materialMapping) {
  if (!mixDesigns?.length) return []
  return mixDesigns
    .map(mix => ({
      mix,
      mixId: mix.id,
      strengthGrade: mix.strengthGrade,
      slots: getUnfilledMaterialSlotsForMix(mix, materialMapping[mix.id])
    }))
    .filter(entry => entry.slots.length > 0)
}

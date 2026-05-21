const StandardClauseNormalizer = require('./StandardClauseNormalizer')
const { ROLE } = StandardClauseNormalizer

const FIELD_LABELS = {
  waterBinderRatio: '水胶比',
  cementContent: '水泥用量',
  binderContent: '胶凝材料总量',
  flyAshRatio: '粉煤灰掺量',
  slagRatio: '矿渣粉掺量',
  lithiumSlagRatio: '锂渣掺量',
  compositePowderRatio: '复合粉掺量',
  sandRatio: '砂率',
  slump: '坍落度',
  airContent: '含气量',
  waterAmount: '单位用水量',
  chlorideContent: '氯离子含量',
  micaContent: '云母含量',
  mudContent: '含泥量'
}

const NON_EVALUATED_ROLES = new Set([
  ROLE.DEFINITION,
  ROLE.TEST_METHOD,
  ROLE.MANAGEMENT_REQUIREMENT,
  ROLE.REFERENCE_REQUIREMENT,
  ROLE.INFORMATIONAL
])

const toNumber = (value) => {
  if (value == null || value === '') return null
  const normalized = String(value).replace('%', '').trim()
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

const readAmount = (value) => {
  if (value == null) return null
  if (typeof value === 'object') {
    return value.amount ?? value.usage ?? value.value ?? value.quantity ?? null
  }
  return value
}

const normalizeMixDesign = (input = {}) => {
  const materials = input.materials || {}
  const cement = input.cementContent ?? input.cement ?? readAmount(materials.cement)
  const flyAshAmount = input.flyAshAmount ?? input.flyAsh ?? readAmount(materials.flyAsh)
  const slagAmount = input.slagAmount ?? input.slag ?? readAmount(materials.slag)
  const lithiumSlagAmount = input.lithiumSlagAmount ?? input.lithiumSlag ?? readAmount(materials.lithiumSlag)
  const compositePowderAmount = input.compositePowderAmount ?? input.compositePowder ?? readAmount(materials.compositePowder)
  const explicitBinderContent = toNumber(input.binderContent)
  const calculatedBinderContent = [cement, flyAshAmount, slagAmount, lithiumSlagAmount, compositePowderAmount]
    .map(v => toNumber(v) || 0)
    .reduce((sum, v) => sum + v, 0)
  const binderContent = explicitBinderContent ?? (calculatedBinderContent > 0 ? calculatedBinderContent : null)
  const waterAmount = toNumber(input.waterAmount ?? input.waterUsage ?? input.water ?? readAmount(materials.water))
  const waterBinderRatio = toNumber(input.waterBinderRatio ?? input.waterRatio)
    ?? (waterAmount != null && binderContent > 0 ? waterAmount / binderContent : null)

  return {
    ...input,
    strength: input.strength ?? input.strengthGrade ?? null,
    waterBinderRatio,
    sandRatio: toNumber(input.sandRatio ?? input.sandRate),
    slump: toNumber(input.slump),
    airContent: toNumber(input.airContent),
    cementContent: toNumber(cement),
    binderContent,
    flyAshRatio: toNumber(input.flyAshRatio ?? input.flyAshDosage),
    slagRatio: toNumber(input.slagRatio ?? input.slagDosage),
    lithiumSlagRatio: toNumber(input.lithiumSlagRatio ?? input.lithiumSlagDosage),
    compositePowderRatio: toNumber(input.compositePowderRatio ?? input.compositePowderDosage),
    waterAmount,
    chlorideContent: toNumber(input.chlorideContent ?? input.chlorideIonContent),
    micaContent: toNumber(input.micaContent),
    mudContent: toNumber(input.mudContent),
    environment: input.environment ?? input.environmentCategory ?? null,
    durabilityRequirements: normalizeStringArray(input.durabilityRequirements)
  }
}

const strengthNumber = (strength) => {
  const match = String(strength || '').match(/[Cc]?\s*(\d+)/)
  return match ? Number(match[1]) : null
}

const evalStrength = (rule, strength) => {
  if (!rule) return true
  const current = strengthNumber(strength)
  if (current == null || rule.value == null) return true
  switch (rule.operator) {
    case '>=': return current >= rule.value
    case '>': return current > rule.value
    case '<=': return current <= rule.value
    case '<': return current < rule.value
    case '==': return current === rule.value
    default: return true
  }
}

const includesAny = (provided, required) => {
  const providedValues = normalizeStringArray(provided).map(v => v.toLowerCase())
  return normalizeStringArray(required).some(item => {
    const requiredValue = item.toLowerCase()
    return providedValues.some(value => value.includes(requiredValue) || requiredValue.includes(value))
  })
}

const matchApplicability = (clause, mixDesign) => {
  const applicability = clause.applicability || {}

  if (!evalStrength(applicability.strength, mixDesign.strength)) {
    return { status: 'not_applicable', reason: '强度等级不适用。' }
  }

  const requiredEnvironments = normalizeStringArray(applicability.environment)
  if (requiredEnvironments.length > 0) {
    if (!mixDesign.environment) {
      return { status: 'manual_review', reason: '缺少环境类别，无法判断该条款是否适用。' }
    }
    if (!includesAny(mixDesign.environment, requiredEnvironments)) {
      return { status: 'not_applicable', reason: '环境类别不匹配。' }
    }
  }

  const requiredDurability = normalizeStringArray(applicability.durabilityRequirements)
  if (requiredDurability.length > 0) {
    const provided = normalizeStringArray(mixDesign.durabilityRequirements)
    if (provided.length === 0) {
      return { status: 'manual_review', reason: '缺少耐久性要求，无法判断该条款是否适用。' }
    }
    if (!includesAny(provided, requiredDurability)) {
      return { status: 'not_applicable', reason: '耐久性要求不匹配。' }
    }
  }

  return { status: 'applicable' }
}

const evaluateLimit = (currentValue, rule) => {
  if (currentValue == null) return { status: 'manual_review', message: '缺少当前值。' }

  if (rule.operator === 'between') {
    const compliant = currentValue >= rule.minValue && currentValue <= rule.maxValue
    return {
      status: compliant ? 'compliant' : (rule.constraintLevel === 'recommended' ? 'marginal' : 'non_compliant'),
      comparison: `between ${rule.minValue} and ${rule.maxValue}`,
      limitValue: `${rule.minValue}~${rule.maxValue}`
    }
  }

  let compliant
  if (rule.operator === '<=') compliant = currentValue <= rule.limitValue
  if (rule.operator === '<') compliant = currentValue < rule.limitValue
  if (rule.operator === '>=') compliant = currentValue >= rule.limitValue
  if (rule.operator === '>') compliant = currentValue > rule.limitValue
  if (rule.operator === '==') compliant = currentValue === rule.limitValue

  if (compliant == null) {
    return { status: 'manual_review', message: '未知限值比较符，无法自动判断。' }
  }

  return {
    status: compliant ? 'compliant' : (rule.constraintLevel === 'recommended' ? 'marginal' : 'non_compliant'),
    comparison: `${rule.operator} ${rule.limitValue}`,
    limitValue: rule.limitValue
  }
}

const buildManualItem = (clause, reason) => ({
  clause: clause.section || '',
  standardName: clause.standardName || '',
  standardVersion: clause.standardVersion || '',
  category: clause.standardCategory || '',
  title: clause.title || '',
  condition: clause.condition || '',
  originalText: clause.originalText || '',
  reason
})

const isReviewableClause = (clause) => (
  clause?.clauseRole === ROLE.REVIEW_RULE ||
  clause?.clauseRole === ROLE.MATERIAL_REQUIREMENT
)

const evaluateClauses = (rawMixDesign, rawClauses) => {
  const mixDesign = normalizeMixDesign(rawMixDesign)
  const clauses = (rawClauses || []).map(clause => StandardClauseNormalizer.normalizeClause(clause))
  const ruleResults = []
  const manualReviewItems = []

  for (const clause of clauses) {
    const role = clause.clauseRole
    if (NON_EVALUATED_ROLES.has(role)) {
      continue
    }

    const applicability = matchApplicability(clause, mixDesign)
    if (applicability.status === 'not_applicable') continue
    if (applicability.status === 'manual_review') {
      manualReviewItems.push(buildManualItem(clause, applicability.reason))
      continue
    }

    const limitRules = clause.limitRules || []
    if (limitRules.length === 0) {
      if (clause.manualReviewReason) manualReviewItems.push(buildManualItem(clause, clause.manualReviewReason))
      continue
    }

    for (const rule of limitRules) {
      const currentValue = mixDesign[rule.targetField]
      const evaluation = evaluateLimit(currentValue, rule)
      if (evaluation.status === 'manual_review') {
        manualReviewItems.push(buildManualItem(
          clause,
          evaluation.message || `缺少${FIELD_LABELS[rule.targetField] || rule.targetField}当前值，无法判断。`
        ))
        continue
      }

      const severity = evaluation.status === 'non_compliant'
        ? 'error'
        : evaluation.status === 'marginal'
          ? 'warning'
          : 'info'

      ruleResults.push({
        standardId: clause.standardId || '',
        clause: clause.section || '',
        standardName: clause.standardName || '',
        standardVersion: clause.standardVersion || '',
        category: clause.standardCategory || '',
        checkType: rule.targetField,
        title: clause.title || '',
        originalText: clause.originalText || '',
        condition: clause.condition || '',
        currentValue,
        limitValue: evaluation.limitValue,
        comparison: evaluation.comparison,
        status: evaluation.status,
        level: severity === 'error' ? '明确不合规' : severity === 'warning' ? '临界风险' : '合规',
        severity,
        message: `${FIELD_LABELS[rule.targetField] || rule.targetField} ${severity === 'error' ? '不满足' : '满足'}规范要求`,
        suggestion: severity === 'error' ? `建议调整${FIELD_LABELS[rule.targetField] || rule.targetField}至规范限值内。` : '',
        source: 'rule'
      })
    }
  }

  return { normalizedMixDesign: mixDesign, ruleResults, manualReviewItems }
}

module.exports = {
  FIELD_LABELS,
  normalizeMixDesign,
  matchApplicability,
  evaluateLimit,
  evaluateClauses,
  isReviewableClause
}

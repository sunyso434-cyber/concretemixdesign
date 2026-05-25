const DEFAULT_ENVIRONMENT = '常规环境'
const DEFAULT_CONCRETE_TYPE = '普通混凝土'
const ASSUMPTION_NOTICE = '由于用户未指定环境类别/混凝土类别，本次审查按常规环境和类别进行审查；如有环境类别或混凝土类别要求，请补充后重新调用审查。'

const ORDINARY_ENVIRONMENT_KEYWORDS = ['常规', '普通', '一般', '干燥', '室内']
const SPECIAL_ENVIRONMENT_KEYWORDS = ['二类', '三类', '严寒', '寒冷', '冻融', '氯盐', '硫酸盐', '腐蚀', '海工', '潮湿', '盐渍土']

const ORDINARY_ENVIRONMENT_EQUIVALENTS = {
  '常规环境': ['一类环境', '一类', '室内干燥', '室内'],
  '普通环境': ['一类环境', '一类', '室内干燥', '室内'],
}

const expandEnvironmentForMatching = (env) => {
  const envStr = String(env || '').trim()
  const equivalents = ORDINARY_ENVIRONMENT_EQUIVALENTS[envStr] || []
  return [envStr, ...equivalents]
}

const ENVIRONMENT_CLASS_REGEX = /[一二三四五六七八九十][a-eA-E]?\s*(?:类)?\s*环境/
const ORDINARY_CONCRETE_TYPE_KEYWORDS = ['普通混凝土']
const SPECIAL_CONCRETE_TYPE_KEYWORDS = ['预应力', '大体积', '抗渗', '抗冻', '喷射', '水下', '自密实', '轻骨料', '重混凝土']

const hasText = (value) => typeof value === 'string' ? value.trim().length > 0 : value != null

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

const includesKeyword = (value, keywords) => {
  const text = String(value || '')
  return keywords.some(keyword => text.includes(keyword))
}

const isSpecialEnvironment = (value) => {
  if (!value) return false
  // 一类环境是常规环境，不是特殊环境
  if (/一类[a-eA-E]?\s*(?:类)?\s*环境/.test(String(value))) return false
  if (ENVIRONMENT_CLASS_REGEX.test(String(value))) return true
  if (includesKeyword(value, ORDINARY_ENVIRONMENT_KEYWORDS) && !includesKeyword(value, SPECIAL_ENVIRONMENT_KEYWORDS)) return false
  return includesKeyword(value, SPECIAL_ENVIRONMENT_KEYWORDS)
}

const isSpecialConcreteType = (value) => {
  if (!value) return false
  if (includesKeyword(value, ORDINARY_CONCRETE_TYPE_KEYWORDS) && !includesKeyword(value, SPECIAL_CONCRETE_TYPE_KEYWORDS)) return false
  return includesKeyword(value, SPECIAL_CONCRETE_TYPE_KEYWORDS)
}

const buildReviewContext = (rawMixDesign = {}) => {
  const mixDesign = { ...rawMixDesign }
  const userProvided = {
    environment: hasText(rawMixDesign.environment ?? rawMixDesign.environmentCategory),
    concreteType: hasText(rawMixDesign.concreteType ?? rawMixDesign.structureType),
    durabilityRequirements: normalizeStringArray(rawMixDesign.durabilityRequirements).length > 0
  }
  const assumptions = []

  if (!userProvided.environment) {
    mixDesign.environment = DEFAULT_ENVIRONMENT
    assumptions.push({
      field: 'environment',
      defaultValue: DEFAULT_ENVIRONMENT,
      reason: '用户未指定环境类别'
    })
  }

  if (!userProvided.concreteType) {
    mixDesign.concreteType = DEFAULT_CONCRETE_TYPE
    assumptions.push({
      field: 'concreteType',
      defaultValue: DEFAULT_CONCRETE_TYPE,
      reason: '用户未指定混凝土类别'
    })
  }

  return {
    mixDesign,
    assumptions,
    assumptionNotice: assumptions.length > 0 ? ASSUMPTION_NOTICE : '',
    userProvided
  }
}

const shouldSkipByDefaultAssumption = (item = {}, reviewContext = {}) => {
  const applicability = item.applicability || {}
  const userProvided = reviewContext.userProvided || {}
  const environments = normalizeStringArray(applicability.environment)
  const concreteTypes = normalizeStringArray(applicability.concreteType)
  const durabilityRequirements = normalizeStringArray(applicability.durabilityRequirements)

  // 环境匹配：默认"常规环境"等同于一类环境
  if (!userProvided.environment && environments.length > 0) {
    const defaultEquivalents = expandEnvironmentForMatching(DEFAULT_ENVIRONMENT)
    const allOrdinary = environments.every(env => {
      const envLower = String(env || '').toLowerCase()
      return defaultEquivalents.some(eq => eq.toLowerCase() === envLower)
    })
    if (!allOrdinary && environments.some(isSpecialEnvironment)) {
      return {
        skip: true,
        reason: '用户未指定环境类别，特殊环境规则未启用',
        field: 'environment'
      }
    }
  }

  if (!userProvided.concreteType && concreteTypes.some(isSpecialConcreteType)) {
    return {
      skip: true,
      reason: '用户未指定混凝土类别，特殊混凝土规则未启用',
      field: 'concreteType'
    }
  }

  if (!userProvided.durabilityRequirements && durabilityRequirements.length > 0) {
    return {
      skip: true,
      reason: '用户未指定特殊耐久性要求，耐久性专项规则未启用',
      field: 'durabilityRequirements'
    }
  }

  return { skip: false }
}

module.exports = {
  DEFAULT_ENVIRONMENT,
  DEFAULT_CONCRETE_TYPE,
  ASSUMPTION_NOTICE,
  buildReviewContext,
  shouldSkipByDefaultAssumption,
  normalizeStringArray,
  expandEnvironmentForMatching,
  ORDINARY_ENVIRONMENT_EQUIVALENTS
}

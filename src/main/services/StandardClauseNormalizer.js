const ROLE = {
  REVIEW_RULE: 'review_rule',
  MATERIAL_REQUIREMENT: 'material_requirement',
  DEFINITION: 'definition',
  TEST_METHOD: 'test_method',
  REFERENCE_REQUIREMENT: 'reference_requirement',
  MANAGEMENT_REQUIREMENT: 'management_requirement',
  INFORMATIONAL: 'informational'
}

const FIELD_KEYWORDS = [
  { field: 'waterBinderRatio', keywords: ['水胶比', '水灰比', '水胶比值'] },
  { field: 'binderContent', keywords: ['胶凝材料用量', '胶凝材料总量', '胶凝材料', '胶材用量'] },
  { field: 'cementContent', keywords: ['水泥用量', '水泥含量'] },
  { field: 'flyAshRatio', keywords: ['粉煤灰掺量', '粉煤灰'] },
  { field: 'slagRatio', keywords: ['矿渣粉掺量', '矿渣掺量', '矿渣粉', '矿渣'] },
  { field: 'lithiumSlagRatio', keywords: ['锂渣粉掺量', '锂渣掺量', '锂渣粉', '锂渣'] },
  { field: 'compositePowderRatio', keywords: ['复合粉掺量', '复合矿物掺合料', '复合粉'] },
  { field: 'sandRatio', keywords: ['砂率'] },
  { field: 'slump', keywords: ['坍落度', '塌落度'] },
  { field: 'airContent', keywords: ['含气量', '引气量'] },
  { field: 'waterAmount', keywords: ['用水量', '单位用水量', '拌合用水量'] },
  { field: 'chlorideContent', keywords: ['氯离子含量', '氯离子', '氯盐'] },
  { field: 'micaContent', keywords: ['云母含量', '云母'] },
  { field: 'mudContent', keywords: ['含泥量', '泥块含量'] }
]

const DURABILITY_KEYWORDS = [
  '抗渗',
  '抗冻',
  '抗氯离子',
  '抗硫酸盐',
  '耐久性',
  '冻融',
  '氯盐',
  '腐蚀',
  '硫酸盐'
]

const toText = (value) => {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' ')
  if (typeof value === 'object') return Object.values(value).map(toText).filter(Boolean).join(' ')
  return String(value)
}

const getClauseText = (clause = {}) => [
  clause.title,
  clause.name,
  clause.parameterName,
  clause.rawName,
  clause.content,
  clause.text,
  clause.rule,
  clause.rawRule,
  clause.parameters,
  clause.condition,
  clause.conditions,
  clause.applicability
].map(toText).filter(Boolean).join(' ')

const normalizeNumber = (value) => {
  if (value == null) return null
  const normalized = String(value).replace(/,/g, '').trim()
  const number = Number.parseFloat(normalized)
  return Number.isFinite(number) ? number : null
}

const detectTargetField = (name) => {
  const text = toText(name)
  if (!text) return null

  const matched = FIELD_KEYWORDS.find(item => item.keywords.some(keyword => text.includes(keyword)))
  return matched ? matched.field : null
}

const isMaterialText = (text) => (
  /(水泥|粉煤灰|矿渣|锂渣|外加剂|骨料|材料|原材料|氯离子|云母|含泥量|泥块含量)/.test(text)
)

const hasFieldKeyword = (text) => (
  FIELD_KEYWORDS.some(item => item.keywords.some(keyword => text.includes(keyword)))
)

const hasLimitSignal = (text) => (
  !/(适用范围|閫傜敤鑼冨洿)/.test(text) &&
  /(不得|不应|不宜|不小于|不大于|不低于|不高于|不超过|不得超过|应控制|控制在|最大|最小|限值|上限|下限|范围|掺量|用量|含量|水胶比|水灰比|砂率|坍落度|含气量|胶凝材料|氯离子|含泥量|云母|涓嶅緱|涓嶅簲|搴旀帶鍒?|鎺у埗|鏈€澶?|鏈€灏?|闄愬€?|涓婇檺|涓嬮檺|鑼冨洿|鎺洪噺|鐢ㄩ噺|鍚噺|姘磋兌姣?|姘寸伆姣?|鐮傜巼|鍧嶈惤搴?|鍚皵閲?|鑳跺嚌鏉愭枡|姘瀛?|鍚偿閲?|浜戞瘝)/.test(text)
)

const hasLimitIntent = (text) => (
  hasLimitSignal(text) || (
    hasFieldKeyword(text) &&
    /(应|宜|符合|满足|要求|控制|采用|确定|搴?|瀹?|绗﹀悎|婊¤冻|瑕佹眰|鎺у埗|閲囩敤|纭畾)/.test(text)
  )
)

const hasExplicitNumericLimit = (text) => {
  const withoutStandardCodes = toText(text).replace(
    /\b(?:GB\/T|GB|JGJ|JTG|JT\/T|TB|SL|DL|CECS|T\/)\s*[\dA-Z/-]+/gi,
    ''
  )

  return (
    /(?:<=|>=|<|>|≤|≥|鈮鈮鈮鈮|不得大于|不应大于|不大于|不超过|不得超过|最大|上限|不得小于|不应小于|不小于|不低于|最小|下限|范围|~|至|到)\s*\d+(?:\.\d+)?\s*%?/.test(withoutStandardCodes) ||
    /\d+(?:\.\d+)?\s*%?\s*(?:~|-|至|到)\s*\d+(?:\.\d+)?\s*%?/.test(withoutStandardCodes)
  )
}

const isInformationalText = (text) => (
  /(适用范围|本规范适用于|本规程适用于|本标准适用于|总则|术语|符号|分类|一般规定|编制目的|为了|说明|可分为|分为|包括|由.*组成|閫傜敤鑼冨洿|鏈鑼冮€傜敤|鏈绋嬮€傜敤|鏈爣鍑嗛€傜敤|鎬诲垯|鏈|绗﹀彿|鍒嗙被|涓€鑸瀹?|缂栧埗鐩殑|涓轰簡|璇存槑|鍙垎涓?|鍒嗕负|鍖呮嫭|鐢?.*缁勬垚)/.test(text) &&
  !hasLimitIntent(text)
)

const normalizeCompleteLimitRule = (rule) => {
  if (!rule || typeof rule !== 'object') return null
  if (!rule.targetField || !rule.operator) return null

  if (rule.operator === 'between') {
    const minValue = normalizeNumber(rule.minValue)
    const maxValue = normalizeNumber(rule.maxValue)
    if (minValue == null || maxValue == null) return null

    return {
      ...rule,
      minValue: Math.min(minValue, maxValue),
      maxValue: Math.max(minValue, maxValue)
    }
  }

  const limitValue = normalizeNumber(rule.limitValue)
  if (limitValue == null) return null

  return {
    ...rule,
    limitValue
  }
}

const detectConstraintLevel = (text) => {
  if (/(宜|建议|推荐|可按)/.test(text)) return 'recommended'
  if (/(必须|严禁|不得|不应|应|不小于|不低于|不大于|不超过)/.test(text)) return 'mandatory'
  return 'mandatory'
}

const escapeRegExp = (value) => (
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
)

const extractParamContext = (ruleText, paramName) => {
  const text = toText(ruleText)
  const name = toText(paramName)
  if (!text || !name) return ''

  const index = text.indexOf(name)
  if (index < 0) return ''

  const leftText = text.slice(0, index)
  const rightText = text.slice(index)
  const leftBoundary = Math.max(
    leftText.lastIndexOf('，'),
    leftText.lastIndexOf('。'),
    leftText.lastIndexOf('；'),
    leftText.lastIndexOf(';'),
    leftText.lastIndexOf(',')
  )
  const rightOffsets = ['，', '。', '；', ';', ',']
    .map(mark => rightText.indexOf(mark))
    .filter(offset => offset >= 0)
  const start = leftBoundary >= 0 ? leftBoundary + 1 : Math.max(0, index - 20)
  const end = rightOffsets.length > 0
    ? index + Math.min(...rightOffsets)
    : Math.min(text.length, index + name.length + 40)
  const nearby = text.slice(start, end)
  const escapedName = escapeRegExp(name)
  const clauseMatch = nearby.match(new RegExp(`[^，。；;,]*${escapedName}[^，。；;,]*`))

  return clauseMatch ? clauseMatch[0] : nearby
}

const parseLimit = (rawValue, rawName, rawRule) => {
  const text = [rawName, rawRule, rawValue].map(toText).filter(Boolean).join(' ')
  const targetField = detectTargetField(rawName) || detectTargetField(text)
  if (!targetField) return null

  const constraintLevel = detectConstraintLevel(text)
  const rangeMatch = text.match(/(-?\d+(?:\.\d+)?)\s*%?\s*(?:~|～|-|至|到)\s*(-?\d+(?:\.\d+)?)\s*%?/)
  if (rangeMatch) {
    const firstValue = normalizeNumber(rangeMatch[1])
    const secondValue = normalizeNumber(rangeMatch[2])
    if (firstValue == null || secondValue == null) return null
    const minValue = Math.min(firstValue, secondValue)
    const maxValue = Math.max(firstValue, secondValue)

    return {
      targetField,
      operator: 'between',
      minValue,
      maxValue,
      constraintLevel,
      rawText: text
    }
  }

  const patterns = [
    { operator: '<=', regex: /(?:<=|≤|≦|不大于|不得大于|不应大于|不超过|不得超过|小于等于|最大(?:值)?(?:为|是)?|上限(?:为|是)?|不高于)\s*(-?\d+(?:\.\d+)?)\s*%?/ },
    { operator: '>=', regex: /(?:>=|≥|≧|不小于|不得小于|不应小于|不低于|不得低于|小于不得|大于等于|最小(?:值)?(?:为|是)?|下限(?:为|是)?)\s*(-?\d+(?:\.\d+)?)\s*%?/ },
    { operator: '<=', regex: /(-?\d+(?:\.\d+)?)\s*%?\s*(?:及以下|以下|以内)/ },
    { operator: '>=', regex: /(-?\d+(?:\.\d+)?)\s*%?\s*(?:及以上|以上)/ }
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern.regex)
    if (!match) continue

    return {
      targetField,
      operator: pattern.operator,
      limitValue: normalizeNumber(match[1]),
      constraintLevel,
      rawText: text
    }
  }

  const equalMatch = text.match(/(?:=|＝|为|宜为|应为|控制为|取)\s*(-?\d+(?:\.\d+)?)\s*%?/)
  if (equalMatch) {
    return {
      targetField,
      operator: '==',
      limitValue: normalizeNumber(equalMatch[1]),
      constraintLevel,
      rawText: text
    }
  }

  const valueNumber = normalizeNumber(rawValue)
  if (valueNumber != null && /最大|上限/.test(text)) {
    return {
      targetField,
      operator: '<=',
      limitValue: valueNumber,
      constraintLevel,
      rawText: text
    }
  }

  if (valueNumber != null && /最小|下限/.test(text)) {
    return {
      targetField,
      operator: '>=',
      limitValue: valueNumber,
      constraintLevel,
      rawText: text
    }
  }

  return null
}

const hasReferenceOnlyRequirement = (text) => (
  !hasExplicitNumericLimit(text) &&
  (
    /(?:应符合|符合|按).*(?:GB\/T|GB|JGJ|JTG|JT\/T|TB|SL|DL|CECS|T\/)\s*[\dA-Z/-]*/i.test(text) ||
    /(?:应符合|符合|按).*(?:现行|有关|相关).*(?:标准|规范|规程)(?:规定|要求|执行)?/.test(text)
  )
)

const detectClauseRole = (clause, text) => {
  const explicitRole = clause.clauseRole || clause.role || clause.type
  if (
    explicitRole &&
    Object.values(ROLE).includes(explicitRole) &&
    explicitRole !== ROLE.REVIEW_RULE &&
    explicitRole !== ROLE.MATERIAL_REQUIREMENT
  ) {
    return explicitRole
  }

  if (/(定义|术语|称为|是指|以下简称|本规范所称|瀹氫箟|鏈|绉颁负|鏄寚|浠ヤ笅绠€绉皘鏈绋嬫墍绉?)/.test(text)) return ROLE.DEFINITION
  if (/(试验方法|检测方法|测定方法|取样|试件|试验应按|按.+试验|成型|养护|检测|璇曢獙鏂规硶|妫€娴嬫柟娉晐娴嬪畾鏂规硶|鍙栨牱|璇曚欢|璇曢獙搴旀寜|鎸.*璇曢獙)/.test(text)) return ROLE.TEST_METHOD
  if (hasReferenceOnlyRequirement(text)) return ROLE.REFERENCE_REQUIREMENT
  if (/(资料|台账|记录|验收|报审|审批|管理|施工组织|质量管理|人员|制度|璧勬枡|鍙拌处|璁板綍|楠屾敹|鎶ュ|瀹℃壒|绠＄悊|鏂藉伐缁勭粐|璐ㄩ噺绠＄悊|浜哄憳|鍒跺害)/.test(text)) return ROLE.MANAGEMENT_REQUIREMENT
  if (isInformationalText(text)) return ROLE.INFORMATIONAL
  if (explicitRole === ROLE.MATERIAL_REQUIREMENT) return hasLimitIntent(text) ? ROLE.MATERIAL_REQUIREMENT : ROLE.INFORMATIONAL
  if (explicitRole === ROLE.REVIEW_RULE) return hasLimitIntent(text) ? ROLE.REVIEW_RULE : ROLE.INFORMATIONAL
  if (isMaterialText(text)) return hasLimitIntent(text) ? ROLE.MATERIAL_REQUIREMENT : ROLE.INFORMATIONAL
  return hasLimitIntent(text) ? ROLE.REVIEW_RULE : ROLE.INFORMATIONAL
}

const detectEnvironment = (text) => {
  const environments = []
  const patterns = [
    /环境等级\s*[:：为是]?\s*([A-Z][0-9A-Z-]*)/gi,
    /([一二三四五六七八九十]+类环境)/g,
    /([A-D][1-3]?)\s*类?环境/gi,
    /(严寒|寒冷|潮湿|干燥|海洋|盐渍土|冻融|腐蚀|氯盐|硫酸盐)(?:环境|地区|条件)?/g
  ]

  for (const pattern of patterns) {
    let match = pattern.exec(text)
    while (match) {
      if (match[1] && !environments.includes(match[1])) environments.push(match[1])
      match = pattern.exec(text)
    }
  }

  return environments
}

const detectDurabilityRequirements = (text) => (
  DURABILITY_KEYWORDS.filter(keyword => text.includes(keyword))
)

const buildApplicability = (text) => {
  const environment = detectEnvironment(text)
  const durabilityRequirements = detectDurabilityRequirements(text)
  const requiresUserInput = []

  if (environment.length > 0) requiresUserInput.push('environment')
  if (durabilityRequirements.length > 0) requiresUserInput.push('durabilityRequirements')

  return {
    environment,
    durabilityRequirements,
    requiresUserInput
  }
}

const getRawLimitValue = (clause = {}) => (
  clause.limitValue ??
  clause.value ??
  clause.rawValue ??
  clause.parameterValue ??
  clause.requirementValue
)

const getRawName = (clause = {}) => (
  clause.parameterName ??
  clause.rawName ??
  clause.name ??
  clause.title
)

const getRawRule = (clause = {}) => (
  clause.rule ??
  clause.rawRule ??
  clause.content ??
  clause.text
)

const getParameterRules = (clause = {}, ruleText = '') => {
  if (!Array.isArray(clause.parameters)) return []

  return clause.parameters
    .map(parameter => {
      const rawName = parameter?.name ?? parameter?.parameterName ?? parameter?.rawName
      const rawValue = parameter?.value ?? parameter?.limitValue ?? parameter?.rawValue
      const rawUnit = parameter?.unit
      const paramContext = extractParamContext(ruleText, rawName)
      const localText = [rawValue, rawUnit, paramContext].map(toText).filter(Boolean).join(' ')
      return parseLimit(rawValue, rawName, localText)
    })
    .filter(Boolean)
}

const normalizeClause = (clause = {}) => {
  const text = getClauseText(clause)
  const clauseRole = detectClauseRole(clause, text)
  const applicability = buildApplicability(text)
  const normalized = {
    ...clause,
    clauseRole,
    applicability,
    limitRules: []
  }

  if (clauseRole === ROLE.REFERENCE_REQUIREMENT) {
    delete normalized.manualReviewReason
    return normalized
  }

  if (
    clauseRole === ROLE.DEFINITION ||
    clauseRole === ROLE.TEST_METHOD ||
    clauseRole === ROLE.MANAGEMENT_REQUIREMENT ||
    clauseRole === ROLE.INFORMATIONAL
  ) {
    return normalized
  }

  const rawRule = getRawRule(clause)
  const parameterRules = getParameterRules(clause, rawRule)
  const limitRule = parseLimit(getRawLimitValue(clause), getRawName(clause), rawRule)
  normalized.limitRules = [...parameterRules]

  if (limitRule && !normalized.limitRules.some(rule => rule.targetField === limitRule.targetField)) {
    normalized.limitRules.push(limitRule)
  }

  if (
    normalized.limitRules.length === 0 &&
    (clauseRole === ROLE.REVIEW_RULE || clauseRole === ROLE.MATERIAL_REQUIREMENT) &&
    Array.isArray(clause.limitRules)
  ) {
    normalized.limitRules = clause.limitRules
      .map(normalizeCompleteLimitRule)
      .filter(Boolean)
  }

  if (clauseRole === ROLE.MATERIAL_REQUIREMENT && normalized.limitRules.length === 0 && hasLimitIntent(text)) {
    normalized.manualReviewReason = '该材料要求未识别到明确数值限值，不能直接自动判定，需要人工核对材料指标要求。'
  }

  if (clauseRole === ROLE.REVIEW_RULE && normalized.limitRules.length === 0 && hasLimitIntent(text)) {
    normalized.manualReviewReason = '该审查规则未识别到可直接计算的明确限值，需要人工复核后再判断。'
  }

  return normalized
}

const normalizeClauses = (clauses) => (
  Array.isArray(clauses) ? clauses.map(normalizeClause) : []
)

const buildQualitySummary = (clauses) => {
  const normalizedClauses = normalizeClauses(clauses)

  return {
    totalClauses: normalizedClauses.length,
    normalizedRuleClauses: normalizedClauses.filter(clause => clause.clauseRole === ROLE.REVIEW_RULE && clause.limitRules.length > 0).length,
    definitionClauses: normalizedClauses.filter(clause => clause.clauseRole === ROLE.DEFINITION).length,
    referenceOnlyClauses: normalizedClauses.filter(clause => clause.clauseRole === ROLE.REFERENCE_REQUIREMENT).length,
    informationalClauses: normalizedClauses.filter(clause => clause.clauseRole === ROLE.INFORMATIONAL).length
  }
}

module.exports = {
  ROLE,
  normalizeClause,
  normalizeClauses,
  buildQualitySummary,
  parseLimit,
  detectTargetField,
  hasLimitIntent
}

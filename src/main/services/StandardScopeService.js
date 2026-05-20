const CATEGORY_ALIASES = {
  公路: ['公路', '公路类', '公路规范', '道路', '道路桥梁', '桥梁', '桥涵', '路面', 'JTG', 'JT/T'],
  铁路: ['铁路', '铁路类', '铁路规范', 'TB'],
  水工: ['水工', '水利', '水利水电', '水工类', 'SL'],
  建筑: ['建筑', '建筑类', '建筑规范', 'JGJ', '房建'],
  通用: ['通用', '国家标准', '国标', 'GB', 'GB/T'],
  其他: ['其他', '未分类']
}

const normalizeText = (value) => {
  if (value == null) return ''

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[（）()［\][\]【】{}]/g, '')
    .replace(/[\s\-_/\\.,，。:：;；]+/g, '')
}

const normalizeStringArray = (value) => {
  if (value == null) return []
  const raw = Array.isArray(value) ? value : [value]
  const seen = new Set()
  const result = []

  for (const item of raw) {
    if (item == null) continue
    const text = String(item).trim()
    if (!text) continue
    const key = normalizeText(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }

  return result
}

const normalizeCategory = (value) => {
  const normalized = normalizeText(value)
  if (!normalized) return ''

  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (normalizeText(category) === normalized) return category
    if (aliases.some(alias => normalizeText(alias) === normalized)) return category
  }

  return String(value).trim().replace(/类$|规范$/g, '') || ''
}

const inferCategory = (name) => {
  const normalized = normalizeText(name)
  if (!normalized) return '其他'

  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (category === '其他') continue
    if (aliases.some(alias => normalized.includes(normalizeText(alias)))) {
      return category
    }
  }

  return '其他'
}

const uniqueById = (standards) => {
  const seen = new Set()
  const result = []

  for (const standard of standards) {
    if (!standard || !standard.id || seen.has(standard.id)) continue
    seen.add(standard.id)
    result.push(standard)
  }

  return result
}

const stripInternalFields = (standard) => Object.fromEntries(
  Object.entries(standard).filter(([key]) => !key.startsWith('_'))
)

const buildCandidate = (standard) => ({
  id: standard.id,
  name: standard.name,
  version: standard.version,
  category: standard.category,
  aliases: standard.aliases
})

const buildTokens = (values) => normalizeStringArray(values).map(normalizeText)

const normalizeStandard = (standard) => {
  const aliases = normalizeStringArray(standard?.aliases)
  const scopeKeywords = normalizeStringArray(standard?.scopeKeywords)
  const name = standard?.name || ''
  const category = normalizeCategory(standard?.category) || inferCategory(name)

  return {
    ...standard,
    id: standard?.id || '',
    name,
    version: standard?.version || '',
    category,
    aliases,
    scopeKeywords,
    _tokens: buildTokens([
      standard?.id,
      name,
      standard?.version,
      category,
      ...aliases,
      ...scopeKeywords
    ]),
    _nameTokens: buildTokens([
      standard?.id,
      name,
      standard?.version,
      ...aliases
    ]),
    _categoryTokens: buildTokens([
      category,
      ...scopeKeywords,
      ...(CATEGORY_ALIASES[category] || [])
    ])
  }
}

const buildSuccess = (mode, standards, extra = {}) => {
  const matchedStandards = standards.map(stripInternalFields)
  return {
    success: true,
    mode,
    standardIds: matchedStandards.map(standard => standard.id),
    standards: matchedStandards,
    ...extra
  }
}

const buildFailure = (errorCode, message, extra = {}) => ({
  success: false,
  errorCode,
  message,
  ...extra
})

const matchStandardByName = (standard, requestedName) => {
  const query = normalizeText(requestedName)
  if (!query) return false

  return standard._nameTokens.some(token => token === query || token.includes(query))
}

const resolveByIds = (standards, requestedIds) => {
  const ids = normalizeStringArray(requestedIds)
  const idSet = new Set(ids)
  const matched = standards.filter(standard => idSet.has(standard.id))

  if (matched.length !== ids.length) {
    const found = new Set(matched.map(standard => standard.id))
    return buildFailure('STANDARD_NOT_FOUND', '未找到指定规范', {
      missing: ids.filter(id => !found.has(id)),
      availableStandards: standards.map(buildCandidate)
    })
  }

  return buildSuccess('ids', matched)
}

const resolveByNames = (standards, requestedNames) => {
  const names = normalizeStringArray(requestedNames)
  const matchesByName = names.map(name => ({
    name,
    matches: standards.filter(standard => matchStandardByName(standard, name))
  }))
  const missingNames = matchesByName
    .filter(item => item.matches.length === 0)
    .map(item => item.name)

  const ambiguousNames = matchesByName
    .filter(item => item.matches.length > 1)
    .map(item => ({
      name: item.name,
      candidates: item.matches.map(buildCandidate)
    }))

  if (ambiguousNames.length > 0) {
    return buildFailure('AMBIGUOUS_STANDARD', '匹配到多本规范，请进一步指定', {
      requestedNames: names,
      ambiguousNames,
      missingNames,
      candidates: uniqueById(ambiguousNames.flatMap(item => item.candidates))
    })
  }

  if (missingNames.length > 0) {
    return buildFailure('STANDARD_NOT_FOUND', '未找到匹配的规范', {
      requestedNames: names,
      missingNames,
      availableStandards: standards.map(buildCandidate)
    })
  }

  const matched = uniqueById(matchesByName.flatMap(item => item.matches))

  return buildSuccess(matched.length === 1 ? 'single' : 'names', matched, {
    requestedNames: names
  })
}

const resolveByCategories = (standards, requestedCategories) => {
  const categories = normalizeStringArray(requestedCategories).map(normalizeCategory).filter(Boolean)
  const matchesByCategory = categories.map(category => ({
    category,
    matches: standards.filter(standard => standard.category === category)
  }))
  const missingCategories = matchesByCategory
    .filter(item => item.matches.length === 0)
    .map(item => item.category)

  if (missingCategories.length > 0) {
    return buildFailure('CATEGORY_NOT_FOUND', '未找到匹配类别的规范', {
      requestedCategories: categories,
      missingCategories,
      availableCategories: [...new Set(standards.map(standard => standard.category).filter(Boolean))]
    })
  }

  const matched = uniqueById(matchesByCategory.flatMap(item => item.matches))

  return buildSuccess('category', matched, {
    requestedCategories: categories
  })
}

const resolveStandardsScope = (rawStandards, options = {}) => {
  const standards = Array.isArray(rawStandards) ? rawStandards.map(normalizeStandard) : []

  if (standards.length === 0) {
    return buildFailure('STANDARD_NOT_FOUND', '当前没有可用规范', {
      availableStandards: []
    })
  }

  if (normalizeStringArray(options.standards).length > 0) {
    return resolveByIds(standards, options.standards)
  }

  if (normalizeStringArray(options.standardNames).length > 0) {
    return resolveByNames(standards, options.standardNames)
  }

  if (normalizeStringArray(options.standardCategories).length > 0) {
    return resolveByCategories(standards, options.standardCategories)
  }

  return buildSuccess('all', standards)
}

module.exports = {
  CATEGORY_ALIASES,
  normalizeText,
  normalizeCategory,
  normalizeStringArray,
  inferCategory,
  normalizeStandard,
  resolveStandardsScope
}

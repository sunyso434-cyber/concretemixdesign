// AI 分析数据校验

// 配合比参数范围
const MIX_RANGES = {
  water: { min: 120, max: 250, label: '用水量', unit: 'kg/m³' },
  cement: { min: 150, max: 600, label: '水泥用量', unit: 'kg/m³' },
  flyAsh: { min: 0, max: 350, label: '粉煤灰用量', unit: 'kg/m³' },
  slag: { min: 0, max: 350, label: '矿渣粉用量', unit: 'kg/m³' },
  compositePowder: { min: 0, max: 350, label: '复合粉用量', unit: 'kg/m³' },
  lithiumSlag: { min: 0, max: 350, label: '锂渣用量', unit: 'kg/m³' },
  fineAggregate1: { min: 300, max: 1200, label: '砂1用量', unit: 'kg/m³' },
  fineAggregate2: { min: 0, max: 1200, label: '砂2用量', unit: 'kg/m³' },
  coarseAggregate: { min: 500, max: 1800, label: '碎石用量', unit: 'kg/m³' },
  waterReducerDosage: { min: 0.5, max: 5, label: '减水剂掺量', unit: '%' },
  waterReducerAmount: { min: 1, max: 25, label: '减水剂用量', unit: 'kg/m³' },
  waterBinderRatio: { min: 0.2, max: 0.7, label: '水胶比', unit: '' },
}

// 试验结果范围
const TEST_RANGES = {
  apparentDensity: { min: 2000, max: 2800, label: '表观密度', unit: 'kg/m³' },
  initialSlump: { min: 100, max: 280, label: '初始坍落度', unit: 'mm' },
  initialSlumpFlow: { min: 200, max: 800, label: '初始扩展度', unit: 'mm' },
  initialT500: { min: 1, max: 30, label: '初始T500', unit: 's' },
  slump1h: { min: 80, max: 280, label: '1h坍落度', unit: 'mm' },
  slumpFlow1h: { min: 180, max: 800, label: '1h扩展度', unit: 'mm' },
  t5001h: { min: 1, max: 40, label: '1hT500', unit: 's' },
  slump2h: { min: 60, max: 280, label: '2h坍落度', unit: 'mm' },
  slumpFlow2h: { min: 150, max: 800, label: '2h扩展度', unit: 'mm' },
  t5002h: { min: 1, max: 50, label: '2hT500', unit: 's' },
  strengthR3: { min: 5, max: 50, label: 'R3强度', unit: 'MPa' },
  strengthR7: { min: 10, max: 70, label: 'R7强度', unit: 'MPa' },
  strengthR28: { min: 15, max: 90, label: 'R28强度', unit: 'MPa' },
  strengthR60: { min: 20, max: 110, label: 'R60强度', unit: 'MPa' },
}

// 材料价格范围（按材料类型）
const MATERIAL_PRICE_RANGES = {
  '水泥': { min: 200, max: 800 },
  '粉煤灰': { min: 50, max: 600 },
  '矿渣粉': { min: 50, max: 600 },
  '锂渣': { min: 50, max: 600 },
  '复合粉': { min: 50, max: 600 },
  '细骨料': { min: 30, max: 300 },
  '粗骨料': { min: 30, max: 200 },
  '外加剂': { min: 1000, max: 20000 },
  '减水剂': { min: 1000, max: 20000 },
}

// 材料性能校验规则（按材料类型）
const MATERIAL_PERF_RULES = {
  '水泥': [
    { field: 'density', min: 2.8, max: 3.3, label: '密度', unit: 'g/cm³' },
    { field: 'compressiveStrength28d', min: 40, max: 70, label: '28d抗压强度', unit: 'MPa' },
    { field: 'compressiveStrength3d', min: 15, max: 45, label: '3d抗压强度', unit: 'MPa' },
    { field: 'specificSurfaceArea', min: 250, max: 500, label: '比表面积', unit: 'm²/kg' },
    { field: 'initialSettingTime', min: 45, max: 300, label: '初凝时间', unit: 'min' },
    { field: 'finalSettingTime', min: 180, max: 600, label: '终凝时间', unit: 'min' },
  ],
  '粉煤灰': [
    { field: 'density', min: 1.8, max: 2.8, label: '密度', unit: 'g/cm³' },
    { field: 'activityIndex28d', min: 55, max: 100, label: '28d活性指数', unit: '%' },
    { field: 'activityIndex7d', min: 40, max: 95, label: '7d活性指数', unit: '%' },
    { field: 'lossOnIgnition', min: 0, max: 8, label: '烧失量', unit: '%' },
    { field: 'waterDemandRatio', min: 85, max: 115, label: '需水量比', unit: '%' },
    { field: 'fineness', min: 5, max: 45, label: '细度', unit: '%' },
  ],
  '矿渣粉': [
    { field: 'density', min: 2.5, max: 3.0, label: '密度', unit: 'g/cm³' },
    { field: 'activityIndex28d', min: 70, max: 120, label: '28d活性指数', unit: '%' },
    { field: 'activityIndex7d', min: 50, max: 110, label: '7d活性指数', unit: '%' },
    { field: 'fluidityRatio', min: 85, max: 120, label: '流动度比', unit: '%' },
    { field: 'specificSurfaceArea', min: 300, max: 600, label: '比表面积', unit: 'm²/kg' },
  ],
  '锂渣': [
    { field: 'density', min: 1.8, max: 2.8, label: '密度', unit: 'g/cm³' },
    { field: 'activityIndex28d', min: 55, max: 105, label: '28d活性指数', unit: '%' },
    { field: 'specificSurfaceArea', min: 300, max: 700, label: '比表面积', unit: 'm²/kg' },
  ],
  '复合粉': [
    { field: 'density', min: 1.8, max: 3.0, label: '密度', unit: 'g/cm³' },
    { field: 'activityIndex28d', min: 55, max: 105, label: '28d活性指数', unit: '%' },
    { field: 'specificSurfaceArea', min: 300, max: 700, label: '比表面积', unit: 'm²/kg' },
  ],
  '细骨料': [
    { field: 'density', min: 2.4, max: 2.8, label: '密度', unit: 'g/cm³' },
    { field: 'finenessModulus', min: 1.0, max: 4.0, label: '细度模数', unit: '' },
    { field: 'mudContent', min: 0, max: 10, label: '含泥量', unit: '%' },
    { field: 'clayLumpContent', min: 0, max: 5, label: '泥块含量', unit: '%' },
    { field: 'mbValue', min: 0, max: 3, label: 'MB值', unit: 'g/kg' },
  ],
  '粗骨料': [
    { field: 'density', min: 2.4, max: 3.0, label: '密度', unit: 'g/cm³' },
    { field: 'crushingValue', min: 3, max: 30, label: '压碎值', unit: '%' },
    { field: 'needleFlakeContent', min: 0, max: 25, label: '针片状含量', unit: '%' },
    { field: 'mudContent', min: 0, max: 5, label: '含泥量', unit: '%' },
  ],
  '外加剂': [
    { field: 'density', min: 0.9, max: 1.3, label: '密度', unit: 'g/cm³' },
    { field: 'solidContent', min: 10, max: 60, label: '固含量', unit: '%' },
    { field: 'waterReducingRate', min: 10, max: 40, label: '减水率', unit: '%' },
    { field: 'airContent', min: 0, max: 8, label: '含气量', unit: '%' },
    { field: 'recommendedDosage', min: 0.5, max: 3.5, label: '推荐掺量', unit: '%' },
  ],
  '减水剂': [
    { field: 'density', min: 0.9, max: 1.3, label: '密度', unit: 'g/cm³' },
    { field: 'solidContent', min: 10, max: 60, label: '固含量', unit: '%' },
    { field: 'waterReducingRate', min: 10, max: 40, label: '减水率', unit: '%' },
    { field: 'airContent', min: 0, max: 8, label: '含气量', unit: '%' },
    { field: 'recommendedDosage', min: 0.5, max: 3.5, label: '推荐掺量', unit: '%' },
  ],
}

const addError = (list, severity, type, message, item) => {
  list.push({ severity, type, message, item })
}

const checkRange = (value, range, itemId) => {
  if (value == null || value === '' || value === 0) return null
  if (value < range.min) {
    return `${range.label} ${value} ${range.unit} 低于合理范围（${range.min}-${range.max} ${range.unit}）`
  }
  if (value > range.max) {
    return `${range.label} ${value} ${range.unit} 高于合理范围（${range.min}-${range.max} ${range.unit}）`
  }
  return null
}

const validateMixDesign = (mix, errors) => {
  const id = mix.id || '未知编号'

  // 必填字段
  if (!mix.id || String(mix.id).trim() === '') {
    addError(errors, 'error', 'required', '编号缺失', id)
  }
  if (!mix.strengthGrade || String(mix.strengthGrade).trim() === '') {
    addError(errors, 'error', 'required', '强度等级缺失', id)
  }
  const strengthGradePattern = /^C\d{2,3}$/
  if (mix.strengthGrade && !strengthGradePattern.test(String(mix.strengthGrade))) {
    addError(errors, 'warning', 'range', `强度等级格式异常 "${mix.strengthGrade}"（应为C20-C100格式）`, id)
  }
  if (!mix.water || mix.water <= 0) {
    addError(errors, 'error', 'required', '用水量缺失或为0', id)
  }
  if (!mix.cement || mix.cement <= 0) {
    addError(errors, 'error', 'required', '水泥用量缺失或为0', id)
  }

  // 配合比数值范围
  for (const [key, range] of Object.entries(MIX_RANGES)) {
    const val = mix[key]
    const msg = checkRange(val, range, id)
    if (msg) addError(errors, 'warning', 'range', msg, id)
  }

  // 试验结果范围
  const tr = mix.testResults || {}
  if (!tr.strengthR28 || tr.strengthR28 <= 0) {
    addError(errors, 'error', 'required', 'R28强度缺失或为0', id)
  }
  for (const [key, range] of Object.entries(TEST_RANGES)) {
    const val = tr[key]
    const msg = checkRange(val, range, id)
    if (msg) addError(errors, 'warning', 'range', msg, id)
  }

  // 水胶比一致性
  const binderTotal = (mix.cement || 0) + (mix.flyAsh || 0) + (mix.slag || 0)
    + (mix.compositePowder || 0) + (mix.lithiumSlag || 0)
  if (binderTotal > 0 && mix.water > 0) {
    const calculatedWbr = mix.water / binderTotal
    const importedWbr = mix.waterBinderRatio
    if (importedWbr && importedWbr > 0 && Math.abs(calculatedWbr - importedWbr) / calculatedWbr > 0.1) {
      addError(errors, 'warning', 'consistency',
        `水胶比不一致：导入值 ${importedWbr.toFixed(3)}，实际计算值 ${calculatedWbr.toFixed(3)}（用水量÷胶材总量）`,
        id)
    }
  }
}

const validateMaterial = (material, type, mixId, errors) => {
  if (!material) return
  const label = `${material.name || '未知材料'}(${type})`

  // 价格校验
  const priceRange = MATERIAL_PRICE_RANGES[type]
  if (priceRange && material.price != null && material.price !== '' && material.price !== 0) {
    const price = Number(material.price)
    if (price < priceRange.min) {
      addError(errors, 'warning', 'material',
        `${label} 价格 ${price} 元/吨 低于合理范围（${priceRange.min}-${priceRange.max} 元/吨）`, mixId)
    } else if (price > priceRange.max) {
      addError(errors, 'warning', 'material',
        `${label} 价格 ${price} 元/吨 高于合理范围（${priceRange.min}-${priceRange.max} 元/吨）`, mixId)
    }
  }

  // 性能参数校验
  const rules = MATERIAL_PERF_RULES[type]
  if (!rules) return
  for (const rule of rules) {
    const val = material[rule.field]
    if (val == null || val === '' || val === 0) continue
    const numVal = Number(val)
    if (numVal < rule.min) {
      addError(errors, 'warning', 'material',
        `${label} ${rule.label} ${numVal} ${rule.unit} 低于合理范围（${rule.min}-${rule.max} ${rule.unit}）`, mixId)
    } else if (numVal > rule.max) {
      addError(errors, 'warning', 'material',
        `${label} ${rule.label} ${numVal} ${rule.unit} 高于合理范围（${rule.min}-${rule.max} ${rule.unit}）`, mixId)
    }
  }
}

const MATERIAL_VALIDATE_KEYS = [
  { key: 'cement', type: '水泥' },
  { key: 'flyAsh', type: '粉煤灰' },
  { key: 'slag', type: '矿渣粉' },
  { key: 'fineAggregate1', type: '细骨料' },
  { key: 'fineAggregate2', type: '细骨料' },
  { key: 'coarseAggregate', type: '粗骨料' },
  { key: 'waterReducer', type: '外加剂' },
]

/**
 * 校验 AI 分析数据
 * @param {Array} mixDesigns - 配合比数据
 * @param {Object} materialMapping - { [mixDesignId]: { cement: materialObj, ... } }
 * @returns {{ valid: boolean, errors: Array, summary: { totalItems: number, errorCount: number, warningCount: number } }}
 */
export const validateAIData = (mixDesigns, materialMapping) => {
  const errors = []

  if (!mixDesigns || mixDesigns.length === 0) {
    addError(errors, 'error', 'required', '没有配合比数据，请先导入数据', '系统')
    return {
      valid: false,
      errors,
      summary: { totalItems: 0, errorCount: errors.filter(e => e.severity === 'error').length, warningCount: errors.filter(e => e.severity === 'warning').length }
    }
  }

  for (const mix of mixDesigns) {
    // 配合比数据校验
    validateMixDesign(mix, errors)

    // 材料数据校验
    const mapping = materialMapping[mix.id] || {}
    for (const { key, type } of MATERIAL_VALIDATE_KEYS) {
      const material = mapping[key]
      if (material) {
        validateMaterial(material, type, mix.id, errors)
      }
    }
  }

  const errorCount = errors.filter(e => e.severity === 'error').length
  const warningCount = errors.filter(e => e.severity === 'warning').length

  return {
    valid: errorCount === 0,
    errors,
    summary: {
      totalItems: mixDesigns.length,
      errorCount,
      warningCount,
    }
  }
}

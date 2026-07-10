// 材料类型及其对应的表单字段配置

export const MATERIAL_TYPES = {
  CEMENT: '水泥',
  FLY_ASH: '粉煤灰',
  SLAG: '矿渣粉',
  FINE_AGGREGATE: '细骨料',
  COARSE_AGGREGATE: '粗骨料',
  ADMIXTURE: '减水剂',
  OTHER: '其他'
}

// 每种材料类型对应的字段配置
export const MATERIAL_FIELDS_CONFIG = {
  '水泥': {
    required: ['name', 'type', 'specification', 'manufacturer'],
    optional: [
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'fineness', label: '细度', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'waterContent', label: '含水量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'specificSurfaceArea', label: '比表面积', unit: 'm²/g', type: 'number', min: 0 },
      { name: 'standardConsistency', label: '标准稠度', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'stability', label: '安定性', type: 'select', options: ['合格', '不合格'] },
      { name: 'initialSettingTime', label: '初凝时间', unit: 'min', type: 'number', min: 0 },
      { name: 'finalSettingTime', label: '终凝时间', unit: 'min', type: 'number', min: 0 },
      { name: 'flexuralStrength3d', label: '3天抗折强度', unit: 'MPa', type: 'number', min: 0 },
      { name: 'flexuralStrength28d', label: '28天抗折强度', unit: 'MPa', type: 'number', min: 0 },
      { name: 'compressiveStrength3d', label: '3天抗压强度', unit: 'MPa', type: 'number', min: 0 },
      { name: 'compressiveStrength28d', label: '28天抗压强度', unit: 'MPa', type: 'number', min: 0 },
      { name: 'cementHeat3d', label: '3天水化热', unit: 'kJ/kg', type: 'number', min: 0 },
      { name: 'cementHeat7d', label: '7天水化热', unit: 'kJ/kg', type: 'number', min: 0 }
    ]
  },

  '粉煤灰': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'fineness', label: '细度', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'lossOnIgnition', label: '烧失量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'waterDemandRatio', label: '需水量比', unit: '%', type: 'number', min: 0 },
      { name: 'activityIndex28d', label: '28天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'influenceFactor_10', label: '10%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_20', label: '20%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_30', label: '30%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_40', label: '40%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_50', label: '50%掺量影响系数', type: 'number', min: 0 },
      { name: 'cementitiousFactor_10', label: '10%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_20', label: '20%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_30', label: '30%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_40', label: '40%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_50', label: '50%掺量胶凝系数', type: 'number', disabled: true }
    ]
  },

  '矿渣粉': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'specificSurfaceArea', label: '比表面积', unit: 'm²/g', type: 'number', min: 0 },
      { name: 'lossOnIgnition', label: '烧失量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'fluidityRatio', label: '流动度比', unit: '%', type: 'number', min: 0 },
      { name: 'activityIndex7d', label: '7天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'activityIndex28d', label: '28天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'influenceFactor_10', label: '10%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_20', label: '20%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_30', label: '30%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_40', label: '40%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_50', label: '50%掺量影响系数', type: 'number', min: 0 },
      { name: 'cementitiousFactor_10', label: '10%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_20', label: '20%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_30', label: '30%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_40', label: '40%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_50', label: '50%掺量胶凝系数', type: 'number', disabled: true }
    ]
  },

  '细骨料': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'mudContent', label: '含泥量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'mbValue', label: 'MB值', type: 'number', min: 0 },
      { name: 'sieve_4_75', label: '4.75mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_2_36', label: '2.36mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_1_18', label: '1.18mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_0_60', label: '0.60mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_0_30', label: '0.30mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_0_15', label: '0.15mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'finenessModulus', label: '细度模数', type: 'number', min: 0, disabled: true }
    ]
  },

  '粗骨料': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'mudContent', label: '含泥量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'crushingValue', label: '压碎值', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'needleFlakeContent', label: '针片状含量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_37_5', label: '37.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_31_5', label: '31.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_26_5', label: '26.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_19_0', label: '19.0mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_16_0', label: '16.0mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_9_50', label: '9.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_4_75', label: '4.75mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_2_36', label: '2.36mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'grading', label: '级配', type: 'text', disabled: true }
    ]
  },

  '锂渣': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'specificSurfaceArea', label: '比表面积', unit: 'm²/g', type: 'number', min: 0 },
      { name: 'lossOnIgnition', label: '烧失量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'waterDemandRatio', label: '需水量比', unit: '%', type: 'number', min: 0 },
      { name: 'activityIndex28d', label: '28天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'influenceFactor_10', label: '10%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_20', label: '20%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_30', label: '30%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_40', label: '40%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_50', label: '50%掺量影响系数', type: 'number', min: 0 },
      { name: 'cementitiousFactor_10', label: '10%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_20', label: '20%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_30', label: '30%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_40', label: '40%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_50', label: '50%掺量胶凝系数', type: 'number', disabled: true }
    ]
  },

  '复合粉': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'specificSurfaceArea', label: '比表面积', unit: 'm²/g', type: 'number', min: 0 },
      { name: 'lossOnIgnition', label: '烧失量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'fluidityRatio', label: '流动度比', unit: '%', type: 'number', min: 0 },
      { name: 'activityIndex7d', label: '7天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'activityIndex28d', label: '28天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'influenceFactor_10', label: '10%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_20', label: '20%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_30', label: '30%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_40', label: '40%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_50', label: '50%掺量影响系数', type: 'number', min: 0 },
      { name: 'cementitiousFactor_10', label: '10%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_20', label: '20%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_30', label: '30%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_40', label: '40%掺量胶凝系数', type: 'number', disabled: true },
      { name: 'cementitiousFactor_50', label: '50%掺量胶凝系数', type: 'number', disabled: true }
    ]
  },

  '减水剂': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'recommendedDosage', label: '推荐掺量', unit: '%', type: 'number', min: 0 },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 },
      { name: 'waterReducingRate', label: '减水率', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'solidContent', label: '固含量', unit: '%', type: 'number', min: 0, max: 100 }
    ]
  },

  '其他': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'g/cm³', type: 'number', min: 0 }
    ]
  }
}

/**
 * 计算细度模数
 * 基于 JGJ 52-2006 标准
 * 公式: Mx = (a2 + a3 + a4 + a5 + a6 - 5×a1) / (100 - a1)
 * a1: 4.75mm筛孔累计筛余百分数
 * a2-a6: 2.36mm, 1.18mm, 0.60mm, 0.30mm, 0.15mm筛孔累计筛余百分数
 */
export const calculateFinenessModulus = (fineAggregate) => {
  const getSieveValue = (key) => parseFloat(fineAggregate[key]) || 0
  const a1 = getSieveValue('sieve_4_75')
  const a2 = getSieveValue('sieve_2_36')
  const a3 = getSieveValue('sieve_1_18')
  const a4 = getSieveValue('sieve_0_60')
  const a5 = getSieveValue('sieve_0_30')
  const a6 = getSieveValue('sieve_0_15')
  const denominator = 100 - a1
  if (denominator === 0) return 0
  const fm = (a2 + a3 + a4 + a5 + a6 - 5 * a1) / denominator
  return Math.round(fm * 100) / 100
}

/**
 * 根据各级累计筛余百分数自动匹配粗骨料连续粒级
 * 依据 JGJ 52-2006 标准筛分范围：
 *   5-16:  16.0筛0-10%,  19.0筛0%
 *   5-20:  19.0筛0-10%,  26.5筛0%
 *   5-25:  26.5筛0-5%,   31.5筛0%
 *   5-31.5: 31.5筛0-5%,  37.5筛0%
 *   5-40:  37.5筛0-5%
 */
export const autoMatchGrading = (coarseAggregate) => {
  const s = (key) => parseFloat(coarseAggregate[key]) || 0
  const inRange = (key, min, max) => { const v = s(key); return v >= min && v <= max }
  const hasVal = (key) => s(key) > 0
  const isZero = (key) => s(key) === 0
  // 4.75/2.36 为可选筛孔，未填(值为0)时跳过校验
  const optRange = (key, min, max) => { const v = s(key); return v === 0 || (v >= min && v <= max) }

  // 5-40: 37.5筛余0-5%，19.0筛30-65%，9.5筛70-90%
  if (inRange('sieve_37_5', 0, 5) && hasVal('sieve_37_5') &&
      inRange('sieve_19_0', 30, 65) &&
      inRange('sieve_9_50', 70, 90) &&
      optRange('sieve_4_75', 95, 100)) {
    return '5-40'
  }

  // 5-31.5: 37.5筛0%，31.5筛余0-5%，19.0筛15-45%，9.5筛70-90%
  if (isZero('sieve_37_5') &&
      inRange('sieve_31_5', 0, 5) && hasVal('sieve_31_5') &&
      inRange('sieve_19_0', 15, 45) &&
      inRange('sieve_9_50', 70, 90) &&
      optRange('sieve_4_75', 90, 100)) {
    return '5-31.5'
  }

  // 5-25: 31.5筛0%，26.5筛余0-5%，16.0筛30-70%
  if (isZero('sieve_31_5') &&
      inRange('sieve_26_5', 0, 5) && hasVal('sieve_26_5') &&
      inRange('sieve_16_0', 30, 70) &&
      optRange('sieve_4_75', 90, 100)) {
    return '5-25'
  }

  // 5-20: 26.5筛0%，19.0筛余0-10%，9.5筛40-80%
  if (isZero('sieve_26_5') &&
      inRange('sieve_19_0', 0, 10) && hasVal('sieve_19_0') &&
      inRange('sieve_9_50', 40, 80) &&
      optRange('sieve_4_75', 90, 100)) {
    return '5-20'
  }

  // 5-16: 19.0筛0%，16.0筛余0-10%，9.5筛30-60%
  if (isZero('sieve_19_0') &&
      inRange('sieve_16_0', 0, 10) && hasVal('sieve_16_0') &&
      inRange('sieve_9_50', 30, 60) &&
      optRange('sieve_4_75', 85, 100)) {
    return '5-16'
  }

  return '自定义'
}

export const getFieldsForType = (type) => {
  return MATERIAL_FIELDS_CONFIG[type] || MATERIAL_FIELDS_CONFIG['其他']
}

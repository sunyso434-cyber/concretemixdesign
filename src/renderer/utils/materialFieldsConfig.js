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
      { name: 'density', label: '密度', unit: 'kg/m³', type: 'number', min: 0 },
      { name: 'fineness', label: '细度', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'waterContent', label: '含水量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'specificSurfaceArea', label: '比表面积', unit: 'm²/g', type: 'number', min: 0 },
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
      { name: 'density', label: '密度', unit: 'kg/m³', type: 'number', min: 0 },
      { name: 'fineness', label: '细度', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'lossOnIgnition', label: '烧失量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'waterDemandRatio', label: '需水量比', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'activityIndex28d', label: '28天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'influenceFactor_10', label: '10%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_20', label: '20%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_30', label: '30%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_40', label: '40%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_50', label: '50%掺量影响系数', type: 'number', min: 0 }
    ]
  },

  '矿渣粉': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'kg/m³', type: 'number', min: 0 },
      { name: 'specificSurfaceArea', label: '比表面积', unit: 'm²/g', type: 'number', min: 0 },
      { name: 'lossOnIgnition', label: '烧失量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'fluidityRatio', label: '流动度比', unit: '%', type: 'number', min: 0 },
      { name: 'activityIndex7d', label: '7天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'activityIndex28d', label: '28天活性指数', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'influenceFactor_10', label: '10%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_20', label: '20%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_30', label: '30%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_40', label: '40%掺量影响系数', type: 'number', min: 0 },
      { name: 'influenceFactor_50', label: '50%掺量影响系数', type: 'number', min: 0 }
    ]
  },

  '细骨料': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'kg/m³', type: 'number', min: 0 },
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
      { name: 'density', label: '密度', unit: 'kg/m³', type: 'number', min: 0 },
      { name: 'mudContent', label: '含泥量', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_37_5', label: '37.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_31_5', label: '31.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_26_5', label: '26.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_19_0', label: '19.0mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_16_0', label: '16.0mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'sieve_9_50', label: '9.5mm筛余', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'grading', label: '级配', type: 'text', disabled: true }
    ]
  },

  '减水剂': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'recommendedDosage', label: '推荐掺量', unit: '%', type: 'number', min: 0 },
      { name: 'density', label: '密度', unit: 'kg/m³', type: 'number', min: 0 },
      { name: 'waterReducingRate', label: '减水率', unit: '%', type: 'number', min: 0, max: 100 },
      { name: 'solidContent', label: '固含量', unit: '%', type: 'number', min: 0, max: 100 }
    ]
  },

  '其他': {
    required: ['name', 'type'],
    optional: [
      { name: 'specification', label: '规格', type: 'text' },
      { name: 'manufacturer', label: '生产厂家', type: 'text' },
      { name: 'density', label: '密度', unit: 'kg/m³', type: 'number', min: 0 }
    ]
  }
}

/**
 * 计算细度模数
 * 基于各级筛余累计百分数
 */
export const calculateFinenessModulus = (fineAggregate) => {
  const sieves = [4.75, 2.36, 1.18, 0.60, 0.30, 0.15]
  const percentages = [
    fineAggregate.sieve_4_75,
    fineAggregate.sieve_2_36,
    fineAggregate.sieve_1_18,
    fineAggregate.sieve_0_60,
    fineAggregate.sieve_0_30,
    fineAggregate.sieve_0_15
  ].map(v => parseFloat(v) || 0)

  // 细度模数 = (筛孔总和的筛余百分数) / 100
  const sum = percentages.reduce((acc, val) => acc + val, 0)
  return Math.round((sum / 100) * 100) / 100 // 保留两位小数
}

/**
 * 根据各级筛余百分数自动匹配粗骨料级配
 * 标准分级：5-20mm、5-25mm、10-20mm、10-40mm等
 */
export const autoMatchGrading = (coarseAggregate) => {
  const sieves = {
    37_5: parseFloat(coarseAggregate.sieve_37_5) || 0,
    31_5: parseFloat(coarseAggregate.sieve_31_5) || 0,
    26_5: parseFloat(coarseAggregate.sieve_26_5) || 0,
    19_0: parseFloat(coarseAggregate.sieve_19_0) || 0,
    16_0: parseFloat(coarseAggregate.sieve_16_0) || 0,
    9_5: parseFloat(coarseAggregate.sieve_9_50) || 0
  }

  // 简单的级配判断逻辑
  if (sieves['37_5'] == 0 && sieves['31_5'] > 50 && sieves['26_5'] < 50) {
    return '31.5-16.0'
  } else if (sieves['26_5'] > 50 && sieves['16_0'] < 50) {
    return '26.5-9.5'
  } else if (sieves['19_0'] > 50 && sieves['9_5'] < 50) {
    return '19.0-9.5'
  } else if (sieves['16_0'] > 50 && sieves['9_5'] < 50) {
    return '16.0-9.5'
  }
  return '自定义'
}

export const getFieldsForType = (type) => {
  return MATERIAL_FIELDS_CONFIG[type] || MATERIAL_FIELDS_CONFIG['其他']
}

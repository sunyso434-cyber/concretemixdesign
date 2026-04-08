// src/renderer/config/paramConfig.js

/**
 * 参数配置映射表
 * key: 对应数据库中 SystemParam.paramName
 * value: { label, unit, min, max, step, type, description }
 *   - label: 用户看到的中文名称
 *   - unit: 单位（无单位则空字符串）
 *   - min/max: 滑动条范围（数值类型参数）
 *   - step: 滑动步进
 *   - type: 'range' | 'select' | 'switch' | 'none'
 *     - range: 滑动条 + 数字输入框
 *     - select: 下拉选择器
 *     - switch: 开关
 *     - none: 只读显示
 *   - options: select 类型时的选项数组 [{value, label}]
 */
export const PARAM_CONFIG = {
  // ===== 配合比参数 (mixdesign) =====
  defaultLanguage: {
    label: '默认语言',
    type: 'select',
    options: [
      { value: 'zh-CN', label: '中文' },
      { value: 'en-US', label: '英文' },
    ],
    description: '系统默认显示语言',
  },
  defaultUnit: {
    label: '默认单位制',
    type: 'select',
    options: [
      { value: 'metric', label: '公制' },
      { value: 'imperial', label: '英制' },
    ],
    description: '系统默认单位制度',
  },
  defaultStrength: {
    label: '默认强度等级',
    type: 'select',
    options: [
      { value: 'C15', label: 'C15' },
      { value: 'C20', label: 'C20' },
      { value: 'C25', label: 'C25' },
      { value: 'C30', label: 'C30' },
      { value: 'C35', label: 'C35' },
      { value: 'C40', label: 'C40' },
      { value: 'C45', label: 'C45' },
      { value: 'C50', label: 'C50' },
      { value: 'C55', label: 'C55' },
      { value: 'C60', label: 'C60' },
    ],
    description: '配合比计算默认强度等级',
  },
  defaultSlump: {
    label: '默认坍落度 (mm)',
    type: 'range',
    min: 30,
    max: 220,
    step: 10,
    description: '混凝土坍落度默认值，单位 mm',
  },
  defaultEnvironment: {
    label: '默认环境类别',
    type: 'select',
    options: [
      { value: '1', label: '室内正常环境' },
      { value: '2', label: '室外环境' },
      { value: '3', label: '潮湿环境' },
      { value: '4', label: '化学侵蚀环境' },
    ],
    description: '环境作用等级',
  },
  defaultDensity: {
    label: '默认容重 (kg/m³)',
    type: 'range',
    min: 2200,
    max: 2600,
    step: 50,
    description: '混凝土容重默认值',
  },

  // ===== JGJ55 标准参数 (jgj55) =====
  regressionAlphaA: {
    label: '回归系数 αₐ（碎石）',
    type: 'range',
    min: 0.46,
    max: 0.58,
    step: 0.01,
    description: 'JGJ 55 碎石回归系数 α_a',
  },
  regressionAlphaB: {
    label: '回归系数 α_b（碎石）',
    type: 'range',
    min: 0.07,
    max: 0.24,
    step: 0.01,
    description: 'JGJ 55 碎石回归系数 α_b',
  },
  strengthStdDev_C20: {
    label: '强度标准差 σ — C20及以下 (MPa)',
    type: 'range',
    min: 3.0,
    max: 5.0,
    step: 0.1,
    description: 'C20及以下强度等级标准差',
  },
  strengthStdDev_C25: {
    label: '强度标准差 σ — C25~C45 (MPa)',
    type: 'range',
    min: 4.0,
    max: 6.0,
    step: 0.1,
    description: 'C25~C45 强度等级标准差',
  },
  strengthStdDev_C50: {
    label: '强度标准差 σ — C50及以上 (MPa)',
    type: 'range',
    min: 5.0,
    max: 7.0,
    step: 0.1,
    description: 'C50及以上强度等级标准差',
  },
  superplasticizerDosage_C20: {
    label: '减水剂掺量 — C20 (%)',
    type: 'range',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    description: 'C20 减水剂推荐掺量百分比',
  },
  superplasticizerDosage_C25: {
    label: '减水剂掺量 — C25 (%)',
    type: 'range',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    description: 'C25 减水剂推荐掺量百分比',
  },
  superplasticizerDosage_C30: {
    label: '减水剂掺量 — C30 (%)',
    type: 'range',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    description: 'C30 减水剂推荐掺量百分比',
  },
  superplasticizerDosage_C35: {
    label: '减水剂掺量 — C35 (%)',
    type: 'range',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    description: 'C35 减水剂推荐掺量百分比',
  },
  superplasticizerDosage_C40: {
    label: '减水剂掺量 — C40 (%)',
    type: 'range',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    description: 'C40 减水剂推荐掺量百分比',
  },
  superplasticizerDosage_C45: {
    label: '减水剂掺量 — C45 (%)',
    type: 'range',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    description: 'C45 减水剂推荐掺量百分比',
  },
  superplasticizerDosage_C50: {
    label: '减水剂掺量 — C50 (%)',
    type: 'range',
    min: 1.0,
    max: 2.5,
    step: 0.1,
    description: 'C50 减水剂推荐掺量百分比',
  },
  waterReducingRatePer01Dosage: {
    label: '每+0.1%减水剂掺量减水率增加 (%)',
    type: 'range',
    min: 0.5,
    max: 2.5,
    step: 0.1,
    description: '每增加 0.1% 减水剂掺量，减水率增加的百分比',
  },

  // ===== 系统参数 (system) =====

  // ===== 备份参数 (backup) =====
  autoBackup: {
    label: '自动备份',
    type: 'switch',
    description: '启用后自动定期备份数据库',
  },
  backupInterval: {
    label: '自动备份间隔 (天)',
    type: 'range',
    min: 1,
    max: 30,
    step: 1,
    description: '自动备份执行间隔（天）',
  },
}

/**
 * 按 tab 类型分组参数
 */
export const PARAM_TABS = {
  '配合比参数': ['defaultLanguage', 'defaultUnit', 'defaultStrength', 'defaultSlump', 'defaultEnvironment', 'defaultDensity'],
  'JGJ55标准': ['regressionAlphaA', 'regressionAlphaB', 'strengthStdDev_C20', 'strengthStdDev_C25', 'strengthStdDev_C50',
    'superplasticizerDosage_C20', 'superplasticizerDosage_C25', 'superplasticizerDosage_C30',
    'superplasticizerDosage_C35', 'superplasticizerDosage_C40', 'superplasticizerDosage_C45',
    'superplasticizerDosage_C50', 'waterReducingRatePer01Dosage'],
  '系统设置': [],
  '备份设置': ['autoBackup', 'backupInterval'],
}
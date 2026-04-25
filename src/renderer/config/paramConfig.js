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
  // ===== AI 设置 =====
  deepseekApiKey: {
    label: 'DeepSeek API 密钥',
    type: 'input',
    description: '用于 AI 配合比分析的 DeepSeek API 密钥',
  },
}

/**
 * 按 tab 类型分组参数
 */
export const PARAM_TABS = {
  'JGJ55标准': ['regressionAlphaA', 'regressionAlphaB', 'strengthStdDev_C20', 'strengthStdDev_C25', 'strengthStdDev_C50',
    'superplasticizerDosage_C20', 'superplasticizerDosage_C25', 'superplasticizerDosage_C30',
    'superplasticizerDosage_C35', 'superplasticizerDosage_C40', 'superplasticizerDosage_C45',
    'superplasticizerDosage_C50', 'waterReducingRatePer01Dosage'],
  '系统设置': [],
  '备份设置': ['autoBackup', 'backupInterval'],
  'AI设置': ['deepseekApiKey'],
}
/**
 * JGJ 55 标准参数管理 Skill（5 件套）
 * 让 agent 可以查看/修改/重置 JGJ 55 标准参数
 *
 * 配置内联说明：13 项 JGJ55 参数的 label/min/max/step/description 原本从
 * `src/renderer/config/paramConfig.js` 读取，但该文件是 ES module
 * (`export const`)，CommonJS require 加载不了。这里内联一份独立副本。
 * ponytail: 数据稳定（JGJ55 国家标准不会变），解耦避免 ESM/CJS 互操作问题。
 */

// JGJ55 参数 schema（label/min/max/step/description/type）— 与 paramConfig.js 保持一致
const JGJ55_SCHEMA = {
  regressionAlphaA: { label: '回归系数 αₐ（碎石）', type: 'range', min: 0.46, max: 0.58, step: 0.01, description: 'JGJ 55 碎石回归系数 α_a' },
  regressionAlphaB: { label: '回归系数 α_b（碎石）', type: 'range', min: 0.07, max: 0.24, step: 0.01, description: 'JGJ 55 碎石回归系数 α_b' },
  strengthStdDev_C20: { label: '强度标准差 σ — C20及以下 (MPa)', type: 'range', min: 3.0, max: 5.0, step: 0.1, description: 'JGJ 55 强度标准差 σ — C20及以下' },
  strengthStdDev_C45: { label: '强度标准差 σ — C25~C45 (MPa)', type: 'range', min: 4.0, max: 6.0, step: 0.1, description: 'JGJ 55 强度标准差 σ — C25~C45' },
  strengthStdDev_C50: { label: '强度标准差 σ — C50及以上 (MPa)', type: 'range', min: 5.0, max: 7.0, step: 0.1, description: 'JGJ 55 强度标准差 σ — C50及以上' },
  superplasticizerDosage_C20: { label: '减水剂掺量 — C20 (%)', type: 'range', min: 1.0, max: 5.0, step: 0.1, description: 'JGJ 55 C20 减水剂掺量' },
  superplasticizerDosage_C25: { label: '减水剂掺量 — C25 (%)', type: 'range', min: 1.0, max: 5.0, step: 0.1, description: 'JGJ 55 C25 减水剂掺量' },
  superplasticizerDosage_C30: { label: '减水剂掺量 — C30 (%)', type: 'range', min: 1.0, max: 5.0, step: 0.1, description: 'JGJ 55 C30 减水剂掺量' },
  superplasticizerDosage_C35: { label: '减水剂掺量 — C35 (%)', type: 'range', min: 1.0, max: 5.0, step: 0.1, description: 'JGJ 55 C35 减水剂掺量' },
  superplasticizerDosage_C40: { label: '减水剂掺量 — C40 (%)', type: 'range', min: 1.0, max: 5.0, step: 0.1, description: 'JGJ 55 C40 减水剂掺量' },
  superplasticizerDosage_C45: { label: '减水剂掺量 — C45 (%)', type: 'range', min: 1.0, max: 5.0, step: 0.1, description: 'JGJ 55 C45 减水剂掺量' },
  superplasticizerDosage_C50: { label: '减水剂掺量 — C50 (%)', type: 'range', min: 1.0, max: 5.0, step: 0.1, description: 'JGJ 55 C50 减水剂掺量' },
  waterReducingRatePer01Dosage: { label: '每+0.1%减水剂掺量减水率增加 (%)', type: 'range', min: 0.5, max: 2.5, step: 0.1, description: '每 +0.1% 减水剂掺量对应减水率提升百分比' }
}

// JGJ55 默认值常量（与 SystemService.initDefaultParams 保持一致）
const JGJ55_DEFAULTS = {
  regressionAlphaA: '0.53',
  regressionAlphaB: '0.20',
  strengthStdDev_C20: '4.0',
  strengthStdDev_C45: '5.0',
  strengthStdDev_C50: '6.0',
  superplasticizerDosage_C20: '1.6',
  superplasticizerDosage_C25: '1.7',
  superplasticizerDosage_C30: '1.8',
  superplasticizerDosage_C35: '1.9',
  superplasticizerDosage_C40: '2.0',
  superplasticizerDosage_C45: '2.1',
  superplasticizerDosage_C50: '2.2',
  waterReducingRatePer01Dosage: '2.0'
}

// 结构化错误工厂
function createError(code, message, hint) {
  const errorMap = {
    NOT_FOUND: { code, message: message || '参数不存在', hint: hint || '检查参数名拼写', recovery: 'none' },
    INVALID_NAME: { code, message: message || '参数名不在 JGJ55 列表内', hint: hint || '查看 list_jgj55_params 返回的合法参数名', recovery: 'none' },
    INVALID_TYPE: { code, message: message || 'value 不是合法数字', hint: hint || 'value 必须是数字或数字字符串', recovery: 'none' },
    OUT_OF_RANGE: { code, message: message || 'value 超出 [min, max] 范围', hint: hint || '查看参数 config 的 min/max', recovery: 'none' },
    BATCH_EMPTY: { code, message: message || 'updates 数组为空', hint: hint || '至少传一项 {name, value}', recovery: 'none' },
    SYSTEM_ERROR: { code, message: message || '数据库读写异常', hint: hint || '检查数据库连接', recovery: 'retry' }
  }
  return errorMap[code] || errorMap.SYSTEM_ERROR
}

// 校验 value 是否合法（name 是否在 JGJ55 列表内、value 是否数字、是否在范围内）
function validateValue(name, value) {
  const config = JGJ55_SCHEMA[name]
  if (!config) return { ok: false, error: createError('INVALID_NAME', `参数 ${name} 不在 JGJ55 列表内`) }
  if (config.type !== 'range') return { ok: false, error: createError('INVALID_NAME', `参数 ${name} 不是 range 类型`) }
  const num = Number(value)
  if (Number.isNaN(num)) return { ok: false, error: createError('INVALID_TYPE', `value "${value}" 不是合法数字`) }
  if (num < config.min || num > config.max) {
    return { ok: false, error: createError('OUT_OF_RANGE', `value ${num} 超出 [${config.min}, ${config.max}]`) }
  }
  return { ok: true, value: num }
}

// ===== Tool 1: list_jgj55_params =====
const listJgj55ParamsSkill = {
  name: 'list_jgj55_params',
  description: '列出 JGJ 55 标准的全部参数（含名称、当前值、范围、说明）。用户想查看/核对/调整 JGJ55 标准参数时调用。',
  version: '1.0.0',
  category: 'settings',
  parameters: { type: 'object', properties: {} },
  errors: { SYSTEM_ERROR: { code: 'SYSTEM_ERROR', message: '查询参数失败', recovery: 'retry' } },
  async execute(args, context) {
    const { systemService, logger } = context
    logger.info('list_jgj55_params: 列出全部 13 项 JGJ55 参数')
    try {
      const params = []
      for (const [name, config] of Object.entries(JGJ55_SCHEMA)) {
        if (config.type !== 'range') continue
        // 只列 JGJ55 类：默认值的 key 才算
        if (!(name in JGJ55_DEFAULTS)) continue
        const record = await systemService.getParamByName(name)
        params.push({
          name,
          label: config.label,
          value: record ? record.value : JGJ55_DEFAULTS[name],
          type: 'range',
          min: config.min,
          max: config.max,
          step: config.step,
          description: config.description
        })
      }
      return { success: true, count: params.length, params }
    } catch (err) {
      logger.error('list_jgj55_params 失败:', err)
      return { success: false, error: createError('SYSTEM_ERROR', err.message) }
    }
  },
  services: ['systemService']
}

// ===== Tool 2: get_jgj55_param =====
const getJgj55ParamSkill = {
  name: 'get_jgj55_param',
  description: '按参数名查询单个 JGJ55 参数详情。用户指定参数名时调用。',
  version: '1.0.0',
  category: 'settings',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'JGJ55 参数名（如 regressionAlphaA）', required: true }
    },
    required: ['name']
  },
  errors: {
    INVALID_NAME: { code: 'INVALID_NAME', message: '参数名不在 JGJ55 列表内', recovery: 'none' },
    NOT_FOUND: { code: 'NOT_FOUND', message: '参数不存在', recovery: 'none' }
  },
  async execute(args, context) {
    const { systemService, logger } = context
    const { name } = args
    logger.info(`get_jgj55_param: name=${name}`)
    const config = JGJ55_SCHEMA[name]
    if (!config || !(name in JGJ55_DEFAULTS)) {
      return { success: false, error: createError('INVALID_NAME', `参数 ${name} 不在 JGJ55 列表内`) }
    }
    const record = await systemService.getParamByName(name)
    if (!record) {
      return { success: false, error: createError('NOT_FOUND', `DB 里没有 ${name}`) }
    }
    return {
      success: true,
      param: {
        name,
        label: config.label,
        value: record.value,
        type: 'range',
        min: config.min,
        max: config.max,
        step: config.step,
        description: config.description
      }
    }
  },
  services: ['systemService']
}

// ===== Tool 3: update_jgj55_param =====
const updateJgj55ParamSkill = {
  name: 'update_jgj55_param',
  description: '修改单个 JGJ55 参数。value 必须是 min/max 范围内的数字（字符串或数字都接受）。',
  version: '1.0.0',
  category: 'settings',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'JGJ55 参数名', required: true },
      value: { type: ['string', 'number'], description: '新值，必须在 [min, max] 范围内', required: true }
    },
    required: ['name', 'value']
  },
  errors: {
    INVALID_NAME: { code: 'INVALID_NAME', message: '参数名不在 JGJ55 列表内', recovery: 'none' },
    INVALID_TYPE: { code: 'INVALID_TYPE', message: 'value 不是合法数字', recovery: 'none' },
    OUT_OF_RANGE: { code: 'OUT_OF_RANGE', message: 'value 超出 [min, max]', recovery: 'none' }
  },
  async execute(args, context) {
    const { systemService, logger } = context
    const { name, value } = args
    logger.info(`update_jgj55_param: name=${name}, value=${value}`)
    const validation = validateValue(name, value)
    if (!validation.ok) return { success: false, error: validation.error }
    await systemService.setParam(name, validation.value, 'jgj55')
    return { success: true, param: { name, value: String(validation.value) } }
  },
  services: ['systemService']
}

// ===== Tool 4: batch_update_jgj55_params =====
const batchUpdateJgj55ParamsSkill = {
  name: 'batch_update_jgj55_params',
  description: '批量修改多个 JGJ55 参数。适用于「一次性调整一组参数」的场景。非事务：每条独立校验/写库，任一失败不影响其他参数（失败的收集到 failed 数组）。',
  version: '1.0.0',
  category: 'settings',
  parameters: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: '要更新的参数列表，每项 {name, value}',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            value: { type: ['string', 'number'] }
          }
        },
        required: true
      }
    },
    required: ['updates']
  },
  errors: { BATCH_EMPTY: { code: 'BATCH_EMPTY', message: 'updates 数组为空', recovery: 'none' } },
  async execute(args, context) {
    const { systemService, logger } = context
    const { updates } = args
    logger.info(`batch_update_jgj55_params: count=${updates ? updates.length : 0}`)
    if (!Array.isArray(updates) || updates.length === 0) {
      return { success: false, error: createError('BATCH_EMPTY', 'updates 数组为空') }
    }
    const succeeded = []
    const failed = []
    for (const { name, value } of updates) {
      const validation = validateValue(name, value)
      if (!validation.ok) {
        failed.push({ name, code: validation.error.code, message: validation.error.message })
        continue
      }
      try {
        await systemService.setParam(name, validation.value, 'jgj55')
        succeeded.push({ name, value: String(validation.value) })
      } catch (err) {
        failed.push({ name, code: 'SYSTEM_ERROR', message: err.message })
      }
    }
    return {
      success: failed.length === 0,
      updated: succeeded,
      failed
    }
  },
  services: ['systemService']
}

// ===== Tool 5: reset_jgj55_params =====
const resetJgj55ParamsSkill = {
  name: 'reset_jgj55_params',
  description: '把所有 13 个 JGJ55 参数恢复为出厂默认值。**不可逆**操作，会覆盖用户当前所有自定义值。',
  version: '1.0.0',
  category: 'settings',
  parameters: { type: 'object', properties: {} },
  errors: { SYSTEM_ERROR: { code: 'SYSTEM_ERROR', message: '重置失败', recovery: 'retry' } },
  async execute(args, context) {
    const { systemService, logger } = context
    logger.warn('reset_jgj55_params: 重置全部 JGJ55 参数为默认值（不可逆）')
    try {
      const reset = []
      for (const [name, defaultValue] of Object.entries(JGJ55_DEFAULTS)) {
        await systemService.setParam(name, defaultValue, 'jgj55')
        reset.push({ name, value: defaultValue })
      }
      return { success: true, resetCount: reset.length, params: reset }
    } catch (err) {
      logger.error('reset_jgj55_params 失败:', err)
      return { success: false, error: createError('SYSTEM_ERROR', err.message) }
    }
  },
  services: ['systemService']
}

// ===== 数组导出 =====
module.exports = [
  listJgj55ParamsSkill,
  getJgj55ParamSkill,
  updateJgj55ParamSkill,
  batchUpdateJgj55ParamsSkill,
  resetJgj55ParamsSkill
]
// src/main/services/BlueprintEngine/BlueprintValidator.js
const fs = require('fs')
const yaml = require('js-yaml')
const { extractVariables } = require('./FormulaParser')

// materialFieldsConfig.js 中各材料类别的允许字段
const ALLOWED_FIELDS = {
  '水泥': ['density', 'fineness', 'waterContent', 'specificSurfaceArea', 'stability',
    'initialSettingTime', 'finalSettingTime', 'flexuralStrength3d', 'flexuralStrength28d',
    'compressiveStrength3d', 'compressiveStrength28d', 'cementHeat3d', 'cementHeat7d',
    'specification', 'manufacturer'],
  '细骨料': ['specification', 'manufacturer', 'density', 'mudContent', 'mbValue',
    'sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15',
    'finenessModulus'],
  '粗骨料': ['specification', 'manufacturer', 'density', 'mudContent', 'crushingValue',
    'needleFlakeContent', 'sieve_37_5', 'sieve_31_5', 'sieve_26_5', 'sieve_19_0',
    'sieve_16_0', 'sieve_9_50', 'sieve_4_75', 'sieve_2_36', 'grading'],
  '粉煤灰': ['specification', 'manufacturer', 'density', 'fineness', 'lossOnIgnition',
    'waterDemandRatio', 'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50',
    'cementitiousFactor_10', 'cementitiousFactor_20', 'cementitiousFactor_30',
    'cementitiousFactor_40', 'cementitiousFactor_50'],
  '矿渣粉': ['specification', 'manufacturer', 'density', 'specificSurfaceArea',
    'lossOnIgnition', 'fluidityRatio', 'activityIndex7d', 'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50',
    'cementitiousFactor_10', 'cementitiousFactor_20', 'cementitiousFactor_30',
    'cementitiousFactor_40', 'cementitiousFactor_50'],
  '锂渣': ['specification', 'manufacturer', 'density', 'specificSurfaceArea',
    'lossOnIgnition', 'waterDemandRatio', 'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50',
    'cementitiousFactor_10', 'cementitiousFactor_20', 'cementitiousFactor_30',
    'cementitiousFactor_40', 'cementitiousFactor_50'],
  '复合粉': ['specification', 'manufacturer', 'density', 'specificSurfaceArea',
    'lossOnIgnition', 'fluidityRatio', 'activityIndex7d', 'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50',
    'cementitiousFactor_10', 'cementitiousFactor_20', 'cementitiousFactor_30',
    'cementitiousFactor_40', 'cementitiousFactor_50'],
  '减水剂': ['specification', 'manufacturer', 'recommendedDosage', 'density',
    'waterReducingRate', 'solidContent']
}

const VALID_TYPES = ['input', 'const', 'material', 'formula', 'table_lookup', 'if_else', 'output']

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

function validate(blueprint) {
  // 1. YAML 格式（调用方已保证）
  if (!blueprint.steps || !Array.isArray(blueprint.steps)) {
    throw new ValidationError('blueprint.steps 必须存在且为数组')
  }

  const definedVars = new Set()

  for (let i = 0; i < blueprint.steps.length; i++) {
    const step = blueprint.steps[i]
    const stepDesc = `第 ${i + 1} 步 (type=${step.type || 'undefined'})`

    // 2. 操作类型合法
    if (!VALID_TYPES.includes(step.type)) {
      throw new ValidationError(`${stepDesc}: 操作类型 "${step.type}" 不合法，仅支持 ${VALID_TYPES.join(', ')}`)
    }

    // 3. var 必填且合法
    if (!step.var) throw new ValidationError(`${stepDesc}: 缺少 var 字段`)
    if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(step.var)) {
      throw new ValidationError(`${stepDesc}: 变量名 "${step.var}" 不合法`)
    }

    // 4. material 操作特殊校验
    if (step.type === 'material') {
      const mq = step.material_query || {}
      if (!mq.category) throw new ValidationError(`${stepDesc}: material_query.category 必填`)
      if (!ALLOWED_FIELDS[mq.category]) {
        throw new ValidationError(`${stepDesc}: category "${mq.category}" 不支持，必须是 ${Object.keys(ALLOWED_FIELDS).join(' / ')} 之一`)
      }
      if (mq.name) {
        throw new ValidationError(`${stepDesc}: 蓝图模板禁止写 material_query.name（仅运行时填入）`)
      }
      if (!mq.property) throw new ValidationError(`${stepDesc}: material_query.property 必填`)
      if (!ALLOWED_FIELDS[mq.category].includes(mq.property)) {
        throw new ValidationError(`${stepDesc}: property "${mq.property}" 不允许（不在 ${mq.category} 的允许字段中）`)
      }
      if (mq.requirements) {
        for (const r of mq.requirements) {
          if (!ALLOWED_FIELDS[mq.category].includes(r.property)) {
            throw new ValidationError(`${stepDesc}: requirements 中的 property "${r.property}" 不在 ${mq.category} 的允许字段中`)
          }
        }
      }
    }

    // 5. 自引用检测（必须先于"使用前未定义"检查，否则自引用会被误判）
    if (step.type === 'formula' && step.expr && step.expr.match(new RegExp(`\\b${step.var}\\b`))) {
      throw new ValidationError(`${stepDesc}: 公式自引用 "${step.var}"`)
    }

    // 6. 公式/查表/输出中 引用的变量 必须之前定义过
    if (step.type === 'formula' && step.expr) {
      const usedVars = extractVariables(step.expr)
      for (const v of usedVars) {
        if (!definedVars.has(v)) {
          throw new ValidationError(`${stepDesc}: 变量 "${v}" 在使用前未定义`)
        }
      }
    }
    if ((step.type === 'table_lookup' || step.type === 'output') && i > 0) {
      if (!definedVars.has(step.var)) {
        throw new ValidationError(`${stepDesc}: 变量 "${step.var}" 在使用前未定义`)
      }
    }

    definedVars.add(step.var)
  }

  return true
}

function validateFile(blueprintPath) {
  const blueprint = yaml.load(fs.readFileSync(blueprintPath, 'utf8'))
  return validate(blueprint)
}

module.exports = { validate, validateFile, ValidationError }

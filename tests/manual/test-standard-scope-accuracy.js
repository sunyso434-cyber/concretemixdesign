const assert = require('assert')
const {
  inferCategory,
  normalizeStandard,
  resolveStandardsScope
} = require('../../src/main/services/StandardScopeService')
const {
  normalizeClause,
  buildQualitySummary
} = require('../../src/main/services/StandardClauseNormalizer')
const ComplianceRuleEngine = require('../../src/main/services/ComplianceRuleEngine')
const Module = require('module')
const originalRequire = Module.prototype.require
Module.prototype.require = function (p) {
  if (p === 'electron') {
    return { app: { getPath: () => process.cwd() } }
  }
  return originalRequire.apply(this, arguments)
}
let StandardComplianceService
try {
  StandardComplianceService = require('../../src/main/services/StandardComplianceService')
} finally {
  Module.prototype.require = originalRequire
}
Module.prototype.require = originalRequire

const standards = [
  {
    id: 'std_jgj55',
    name: 'JGJ 55-2011 普通混凝土配合比设计规程',
    version: '2011',
    category: '建筑',
    aliases: ['JGJ55', '普通混凝土配合比规程'],
    scopeKeywords: ['建筑', '普通混凝土']
  },
  {
    id: 'std_jtg_3650',
    name: 'JTG/T 3650-2020 公路桥涵施工技术规范',
    version: '2020',
    category: '公路',
    aliases: ['JTGT3650', '公路桥涵'],
    scopeKeywords: ['公路', '桥涵', '道路桥梁']
  },
  {
    id: 'std_jtg_f30',
    name: 'JTG F30-2015 公路水泥混凝土路面施工技术细则',
    version: '2015',
    category: '公路',
    aliases: ['JTGF30', '公路路面'],
    scopeKeywords: ['公路', '路面', '道路桥梁']
  },
  {
    id: 'std_gb50010',
    name: 'GB 50010-2010 混凝土结构设计规范',
    version: '2010',
    category: '通用',
    aliases: ['GB50010', '混凝土结构'],
    scopeKeywords: ['混凝土', '结构']
  },
  {
    id: 'std_gbt50080',
    name: 'GB/T 50080-2016 普通混凝土拌合物性能试验方法标准',
    version: '2016',
    category: '通用',
    aliases: ['GBT50080', '拌合物试验'],
    scopeKeywords: ['混凝土', '试验']
  }
]

const assertNoInternalTokens = (value) => {
  if (Array.isArray(value)) {
    value.forEach(assertNoInternalTokens)
    return
  }

  if (!value || typeof value !== 'object') return

  assert.strictEqual(Object.prototype.hasOwnProperty.call(value, '_tokens'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(value, '_nameTokens'), false)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(value, '_categoryTokens'), false)
  Object.values(value).forEach(assertNoInternalTokens)
}

const tests = [
  {
    name: 'standardNames 通过别名命中单本规范',
    run() {
      const result = resolveStandardsScope(standards, {
        standardNames: ['JGJ55']
      })

      assert.strictEqual(result.success, true)
      assert.strictEqual(result.mode, 'single')
      assert.deepStrictEqual(result.standardIds, ['std_jgj55'])
    }
  },
  {
    name: 'standardCategories 命中所有公路类规范',
    run() {
      const result = resolveStandardsScope(standards, {
        standardCategories: ['公路类']
      })

      assert.strictEqual(result.success, true)
      assert.strictEqual(result.mode, 'category')
      assert.deepStrictEqual([...result.standardIds].sort(), ['std_jtg_3650', 'std_jtg_f30'])
    }
  },
  {
    name: '过短或过泛名称命中多本时返回歧义',
    run() {
      const result = resolveStandardsScope(standards, {
        standardNames: ['GB']
      })

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.errorCode, 'AMBIGUOUS_STANDARD')
      assert.ok(Array.isArray(result.candidates))
      assert.ok(result.candidates.length >= 2)
    }
  },
  {
    name: 'inferCategory 能识别公路规范',
    run() {
      assert.strictEqual(inferCategory('JTG/T 3650-2020 公路桥涵施工技术规范'), '公路')
    }
  },
  {
    name: '多个名称中某个名称单独命中多本时必须失败',
    run() {
      const result = resolveStandardsScope(standards, {
        standardNames: ['GB', 'GB50010']
      })

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.errorCode, 'AMBIGUOUS_STANDARD')
      assert.ok(Array.isArray(result.ambiguousNames))
      assert.strictEqual(result.ambiguousNames[0].name, 'GB')
      assert.ok(result.ambiguousNames[0].candidates.length >= 2)
    }
  },
  {
    name: '名称同时存在歧义和缺失时优先返回歧义',
    run() {
      const result = resolveStandardsScope(standards, {
        standardNames: ['GB', '不存在的规范']
      })

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.errorCode, 'AMBIGUOUS_STANDARD')
      assert.ok(Array.isArray(result.ambiguousNames))
      assert.strictEqual(result.ambiguousNames[0].name, 'GB')
      assert.ok(result.missingNames.includes('不存在的规范'))
    }
  },
  {
    name: '多个 standardNames 中一个不存在必须失败',
    run() {
      const result = resolveStandardsScope(standards, {
        standardNames: ['JGJ55', '不存在的规范']
      })

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.errorCode, 'STANDARD_NOT_FOUND')
      assert.deepStrictEqual(result.missingNames, ['不存在的规范'])
    }
  },
  {
    name: '完整规范名不应因为通用关键词误命中其它规范',
    run() {
      const result = resolveStandardsScope(standards, {
        standardNames: ['GB 50010-2010 混凝土结构设计规范']
      })

      assert.strictEqual(result.success, true)
      assert.deepStrictEqual(result.standardIds, ['std_gb50010'])
    }
  },
  {
    name: '多个 standardCategories 中一个不存在必须失败',
    run() {
      const result = resolveStandardsScope(standards, {
        standardCategories: ['公路类', '水工类']
      })

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.errorCode, 'CATEGORY_NOT_FOUND')
      assert.deepStrictEqual(result.missingCategories, ['水工'])
    }
  },
  {
    name: '成功结果和 candidates 不暴露内部 tokens',
    run() {
      const success = resolveStandardsScope(standards, {
        standardNames: ['JGJ55']
      })
      const ambiguous = resolveStandardsScope(standards, {
        standardNames: ['GB']
      })

      assertNoInternalTokens(success)
      assertNoInternalTokens(ambiguous.candidates)
    }
  },
  {
    name: 'ID 匹配必须精确，不能模糊',
    run() {
      const result = resolveStandardsScope(standards, {
        standards: ['std_jgj']
      })

      assert.strictEqual(result.success, false)
      assert.strictEqual(result.errorCode, 'STANDARD_NOT_FOUND')
      assert.deepStrictEqual(result.missing, ['std_jgj'])
    }
  },
  {
    name: 'StandardClauseNormalizer 识别定义条款且不生成限值规则',
    run() {
      const result = normalizeClause({
        title: '抗渗混凝土定义',
        content: '抗渗混凝土是指具有规定抗渗等级的混凝土，称为抗渗混凝土。'
      })

      assert.strictEqual(result.clauseRole, 'definition')
      assert.strictEqual(result.limitRules.length, 0)
    }
  },
  {
    name: 'StandardClauseNormalizer 将适用范围说明识别为 informational',
    run() {
      const result = normalizeClause({
        title: '适用范围',
        rule: '本规范适用于公路桥涵混凝土施工。'
      })

      assert.strictEqual(result.clauseRole, 'informational')
      assert.strictEqual(result.limitRules.length, 0)
      assert.strictEqual(result.manualReviewReason, undefined)
    }
  },
  {
    name: 'StandardClauseNormalizer 将普通概念分类说明识别为 informational',
    run() {
      const result = normalizeClause({
        title: '混凝土分类说明',
        content: '混凝土按表观密度可分为普通混凝土、轻骨料混凝土和重混凝土。'
      })

      assert.strictEqual(result.clauseRole, 'informational')
      assert.strictEqual(result.limitRules.length, 0)
      assert.strictEqual(result.manualReviewReason, undefined)
    }
  },
  {
    name: 'StandardClauseNormalizer 解析最大水胶比并要求环境输入',
    run() {
      const result = normalizeClause({
        title: '严寒环境最大水胶比',
        parameters: [{ name: '最大水胶比', value: '≤0.50', unit: '' }],
        rule: '二类环境中最大水胶比应符合耐久性要求。'
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.ok(result.applicability.environment.includes('二类环境'))
      assert.ok(result.applicability.requiresUserInput.includes('environment'))
      assert.strictEqual(result.limitRules.length, 1)
      assert.strictEqual(result.limitRules[0].targetField, 'waterBinderRatio')
      assert.strictEqual(result.limitRules[0].operator, '<=')
      assert.strictEqual(result.limitRules[0].limitValue, 0.5)
    }
  },
  {
    name: 'StandardClauseNormalizer 解析推荐砂率范围',
    run() {
      const result = normalizeClause({
        parameters: [{ name: '砂率', value: '30%~40%', unit: '%' }],
        rule: '泵送混凝土砂率宜按参数范围控制。'
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.strictEqual(result.limitRules.length, 1)
      assert.strictEqual(result.limitRules[0].targetField, 'sandRatio')
      assert.strictEqual(result.limitRules[0].operator, 'between')
      assert.strictEqual(result.limitRules[0].minValue, 30)
      assert.strictEqual(result.limitRules[0].maxValue, 40)
      assert.strictEqual(result.limitRules[0].constraintLevel, 'recommended')
    }
  },
  {
    name: 'StandardClauseNormalizer 反向范围值会自动纠正顺序',
    run() {
      const result = normalizeClause({
        parameters: [{ name: '砂率', value: '40%~30%', unit: '%' }],
        rule: '砂率宜按参数范围控制。'
      })

      assert.strictEqual(result.limitRules.length, 1)
      assert.strictEqual(result.limitRules[0].targetField, 'sandRatio')
      assert.strictEqual(result.limitRules[0].operator, 'between')
      assert.strictEqual(result.limitRules[0].minValue, 30)
      assert.strictEqual(result.limitRules[0].maxValue, 40)
    }
  },
  {
    name: 'StandardClauseNormalizer 材料要求带明确参数时生成限值规则',
    run() {
      const result = normalizeClause({
        parameters: [{ name: '氯离子含量', value: '≤0.06%', unit: '%' }],
        rule: '原材料中氯离子含量应符合限值要求。'
      })

      assert.strictEqual(result.clauseRole, 'material_requirement')
      assert.strictEqual(result.limitRules.length, 1)
      assert.strictEqual(result.limitRules[0].targetField, 'chlorideContent')
      assert.strictEqual(result.limitRules[0].operator, '<=')
      assert.strictEqual(result.limitRules[0].limitValue, 0.06)
    }
  },
  {
    name: 'StandardClauseNormalizer 材料要求不保留不完整上游规则',
    run() {
      const result = normalizeClause({
        rule: '原材料中氯离子含量应符合材料要求。',
        limitRules: [{ targetField: 'chlorideContent' }]
      })

      assert.strictEqual(result.clauseRole, 'material_requirement')
      assert.strictEqual(result.limitRules.length, 0)
      assert.ok(result.manualReviewReason)
    }
  },
  {
    name: 'StandardClauseNormalizer 支持多个 parameters 生成多条规则',
    run() {
      const result = normalizeClause({
        parameters: [
          { name: '最大水胶比', value: '≤0.50', unit: '' },
          { name: '砂率', value: '30%~40%', unit: '%' }
        ],
        rule: '二类环境中最大水胶比应控制，砂率宜按范围控制。'
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.strictEqual(result.limitRules.length, 2)
      assert.strictEqual(result.limitRules[0].targetField, 'waterBinderRatio')
      assert.strictEqual(result.limitRules[0].operator, '<=')
      assert.strictEqual(result.limitRules[0].limitValue, 0.5)
      assert.strictEqual(result.limitRules[1].targetField, 'sandRatio')
      assert.strictEqual(result.limitRules[1].operator, 'between')
      assert.strictEqual(result.limitRules[1].minValue, 30)
      assert.strictEqual(result.limitRules[1].maxValue, 40)
    }
  },
  {
    name: 'StandardClauseNormalizer 多参数纯数值只使用参数附近文本',
    run() {
      const result = normalizeClause({
        parameters: [
          { name: '最大水胶比', value: '0.50' },
          { name: '砂率', value: '35%' }
        ],
        rule: '最大水胶比不得大于0.50，砂率宜为35%。'
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.strictEqual(result.limitRules.length, 2)
      assert.strictEqual(result.limitRules[0].targetField, 'waterBinderRatio')
      assert.strictEqual(result.limitRules[0].operator, '<=')
      assert.strictEqual(result.limitRules[0].limitValue, 0.5)
      assert.strictEqual(result.limitRules[1].targetField, 'sandRatio')
      assert.strictEqual(result.limitRules[1].operator, '==')
      assert.strictEqual(result.limitRules[1].limitValue, 35)
      assert.strictEqual(result.limitRules[1].constraintLevel, 'recommended')
    }
  },
  {
    name: 'StandardClauseNormalizer 审查规则无明确限值时进入人工复核',
    run() {
      const result = normalizeClause({
        parameters: [{ name: '水胶比', value: '按设计要求' }],
        rule: '水胶比应符合设计要求。'
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.strictEqual(result.limitRules.length, 0)
      assert.ok(result.manualReviewReason)
    }
  },
  {
    name: 'StandardClauseNormalizer 保留并归一化字符串数值的完整上游规则',
    run() {
      const result = normalizeClause({
        rule: '水胶比控制要求。',
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: '0.50' }]
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.strictEqual(result.limitRules.length, 1)
      assert.strictEqual(result.limitRules[0].targetField, 'waterBinderRatio')
      assert.strictEqual(result.limitRules[0].operator, '<=')
      assert.strictEqual(result.limitRules[0].limitValue, 0.5)
    }
  },
  {
    name: 'StandardClauseNormalizer 试验方法即使带参数也不生成限值规则',
    run() {
      const result = normalizeClause({
        title: '坍落度试验方法',
        parameters: [{ name: '坍落度', value: '180mm', unit: 'mm' }],
        limitRules: [{ targetField: 'slump', operator: '==', limitValue: 180 }],
        rule: '坍落度试验方法应按现行试验标准取样测定。'
      })

      assert.strictEqual(result.clauseRole, 'test_method')
      assert.strictEqual(result.limitRules.length, 0)
    }
  },
  {
    name: 'StandardClauseNormalizer 管理要求即使带参数也不生成限值规则',
    run() {
      const result = normalizeClause({
        title: '质量管理记录',
        parameters: [{ name: '水胶比', value: '0.50' }],
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.5 }],
        rule: '施工单位应建立配合比管理台账和质量记录。'
      })

      assert.strictEqual(result.clauseRole, 'management_requirement')
      assert.strictEqual(result.limitRules.length, 0)
    }
  },
  {
    name: 'StandardClauseNormalizer 上游误标 review_rule 的定义条款仍按定义处理',
    run() {
      const result = normalizeClause({
        clauseRole: 'review_rule',
        title: '抗渗混凝土定义',
        parameters: [{ name: '水胶比', value: '0.50' }],
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.5 }],
        content: '抗渗混凝土是指具有规定抗渗等级的混凝土，称为抗渗混凝土。'
      })

      assert.strictEqual(result.clauseRole, 'definition')
      assert.strictEqual(result.limitRules.length, 0)
    }
  },
  {
    name: 'StandardClauseNormalizer 识别纯引用型要求但不生成人工复核原因',
    run() {
      const result = normalizeClause({
        title: '结构设计要求',
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.5 }],
        rule: '混凝土结构设计应符合 GB 50010 规定。'
      })

      assert.strictEqual(result.clauseRole, 'reference_requirement')
      assert.strictEqual(result.limitRules.length, 0)
      assert.strictEqual(result.manualReviewReason, undefined)
    }
  },
  {
    name: 'StandardClauseNormalizer 引用标准但带明确限值时仍生成审查规则',
    run() {
      const result = normalizeClause({
        title: '引用标准和明确限值',
        parameters: [{ name: '水胶比', value: '0.45' }],
        rule: '水胶比应符合 GB 50010 规定，且不得大于0.45。'
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.strictEqual(result.limitRules.length, 1)
      assert.strictEqual(result.limitRules[0].targetField, 'waterBinderRatio')
      assert.strictEqual(result.limitRules[0].operator, '<=')
      assert.strictEqual(result.limitRules[0].limitValue, 0.45)
    }
  },
  {
    name: 'StandardClauseNormalizer 标准编号短横线不应被当作明确限值',
    run() {
      const result = normalizeClause({
        title: '试验标准引用',
        rule: '混凝土拌合物性能试验应符合 GB/T 50080-2016 规定。'
      })

      assert.strictEqual(result.clauseRole, 'reference_requirement')
      assert.strictEqual(result.limitRules.length, 0)
      assert.strictEqual(result.manualReviewReason, undefined)
    }
  },
  {
    name: 'StandardClauseNormalizer buildQualitySummary 统计质量摘要',
    run() {
      const summary = buildQualitySummary([
        {
          title: '抗渗混凝土定义',
          content: '抗渗混凝土是指具有规定抗渗等级的混凝土，称为抗渗混凝土。'
        },
        {
          parameters: [{ name: '最大水胶比', value: '≤0.50', unit: '' }],
          rule: '二类环境中最大水胶比应符合耐久性要求。'
        },
        {
          rule: '混凝土结构设计应符合 GB 50010 规定。'
        }
      ])

      assert.strictEqual(summary.totalClauses, 3)
      assert.strictEqual(summary.normalizedRuleClauses, 1)
      assert.strictEqual(summary.definitionClauses, 1)
      assert.strictEqual(summary.referenceOnlyClauses, 1)
    }
  },
  {
    name: 'StandardClauseNormalizer preserves explicit applicability and marks default condition rule',
    run() {
      const result = normalizeClause({
        section: '5.2.1',
        clauseRole: 'review_rule',
        applicability: {
          environment: ['二类环境'],
          concreteType: ['预应力混凝土'],
          durabilityRequirements: ['抗冻']
        },
        limitRules: [
          {
            targetField: 'waterBinderRatio',
            operator: '<=',
            limitValue: 0.5,
            constraintLevel: 'mandatory'
          }
        ],
        originalText: '二类环境预应力混凝土最大水胶比不应大于0.50。'
      })

      assert.strictEqual(result.clauseRole, 'review_rule')
      assert.strictEqual(result.ruleLayer, 'default_condition_rule')
      assert.deepStrictEqual(result.applicability.environment, ['二类环境'])
      assert.deepStrictEqual(result.applicability.concreteType, ['预应力混凝土'])
      assert.deepStrictEqual(result.applicability.durabilityRequirements, ['抗冻'])
      assert.strictEqual(result.defaultPolicy.defaultEnvironment, '常规环境')
      assert.strictEqual(result.defaultPolicy.defaultConcreteType, '普通混凝土')
      assert.strictEqual(result.limitRules.length, 1)
    }
  },
  {
    name: 'StandardClauseNormalizer quality summary counts rule layers',
    run() {
      const quality = buildQualitySummary([
        {
          clauseRole: 'review_rule',
          rule: '最大水胶比不应大于0.50。',
          parameters: [{ name: '最大水胶比', value: '不应大于0.50' }]
        },
        {
          clauseRole: 'review_rule',
          applicability: { environment: ['二类环境'] },
          limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.5 }]
        },
        {
          title: '术语',
          content: '抗渗混凝土是指具有规定抗渗等级的混凝土。'
        }
      ])

      assert.strictEqual(quality.autoRuleClauses, 1)
      assert.strictEqual(quality.defaultConditionRuleClauses, 1)
      assert.strictEqual(quality.informationalClauses + quality.definitionClauses >= 1, true)
    }
  },
  {
    name: 'normalizeStandard infers category for missing category',
    run() {
      const normalized = normalizeStandard({
        id: 'std_auto',
        name: 'SL 677-2014'
      })

      assert.strictEqual(normalized.category, '水工')
    }
  },
  {
    name: 'ComplianceRuleEngine normalizes mix design aliases',
    run() {
      const normalized = ComplianceRuleEngine.normalizeMixDesign({
        strengthGrade: 'C30',
        waterRatio: 0.56,
        sandRate: 35
      })

      assert.strictEqual(normalized.strength, 'C30')
      assert.strictEqual(normalized.waterBinderRatio, 0.56)
      assert.strictEqual(normalized.sandRatio, 35)
    }
  },
  {
    name: 'ComplianceRuleEngine computes water binder ratio from materials object',
    run() {
      const normalized = ComplianceRuleEngine.normalizeMixDesign({
        materials: {
          cement: 300,
          flyAsh: 50,
          water: 160
        }
      })

      assert.strictEqual(normalized.cementContent, 300)
      assert.strictEqual(normalized.binderContent, 350)
      assert.strictEqual(Number(normalized.waterBinderRatio.toFixed(3)), 0.457)
      assert.strictEqual(normalized.waterAmount, 160)
    }
  },
  {
    name: 'ComplianceRuleEngine skips special environment clauses when environment missing',
    run() {
      const clause = {
        section: '5.2.1',
        title: '二a环境最大水胶比',
        condition: '适用于二a环境类别的混凝土',
        originalText: '二a环境最大水胶比不得大于0.50。',
        clauseRole: 'review_rule',
        applicability: {
          environment: ['二a环境'],
          durabilityRequirements: [],
          requiresUserInput: ['environment']
        },
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.5, constraintLevel: 'mandatory' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', waterBinderRatio: 0.56 }, [clause])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.skippedSpecialRules.length >= 1, true)
    }
  },
  {
    name: 'ComplianceRuleEngine evaluates matched environment violations',
    run() {
      const clause = {
        section: '5.2.1',
        title: '二a环境最大水胶比',
        condition: '适用于二a环境类别的混凝土',
        originalText: '二a环境最大水胶比不得大于0.50。',
        clauseRole: 'review_rule',
        applicability: {
          environment: ['二a环境'],
          durabilityRequirements: [],
          requiresUserInput: ['environment']
        },
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.5, constraintLevel: 'mandatory' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({
        strength: 'C30',
        waterBinderRatio: 0.56,
        environment: '二a环境'
      }, [clause])

      assert.strictEqual(result.ruleResults.length, 1)
      assert.strictEqual(result.ruleResults[0].severity, 'error')
      assert.strictEqual(result.ruleResults[0].comparison, '<= 0.5')
    }
  },
  {
    name: 'ComplianceRuleEngine matches longer environment and durability descriptions',
    run() {
      const clause = {
        section: '5.2.3',
        title: '严寒抗渗最大水胶比',
        clauseRole: 'review_rule',
        applicability: {
          environment: ['严寒'],
          durabilityRequirements: ['抗渗'],
          requiresUserInput: ['environment', 'durabilityRequirements']
        },
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.45, constraintLevel: 'mandatory' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({
        strength: 'C30',
        waterBinderRatio: 0.5,
        environment: '严寒地区',
        durabilityRequirements: ['抗渗、抗冻']
      }, [clause])

      assert.strictEqual(result.ruleResults.length, 1)
      assert.strictEqual(result.ruleResults[0].severity, 'error')
    }
  },
  {
    name: 'ComplianceRuleEngine evaluates recommended ranges as warnings',
    run() {
      const clause = {
        section: '5.4',
        title: '砂率范围',
        condition: '普通混凝土',
        originalText: '砂率宜为30%~40%。',
        clauseRole: 'review_rule',
        applicability: { environment: [], durabilityRequirements: [], requiresUserInput: [] },
        limitRules: [{ targetField: 'sandRatio', operator: 'between', minValue: 30, maxValue: 40, constraintLevel: 'recommended' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', sandRatio: 45 }, [clause])

      assert.strictEqual(result.ruleResults.length, 1)
      assert.strictEqual(result.ruleResults[0].severity, 'warning')
      assert.strictEqual(result.ruleResults[0].comparison, 'between 30 and 40')
    }
  },
  {
    name: 'ComplianceRuleEngine skips durability clauses when durability requirements missing',
    run() {
      const clause = {
        section: '5.2.2',
        title: '抗渗混凝土最大水胶比',
        condition: '适用于有抗渗耐久性要求的混凝土',
        clauseRole: 'review_rule',
        applicability: {
          environment: [],
          durabilityRequirements: ['抗渗'],
          requiresUserInput: ['durabilityRequirements']
        },
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.45, constraintLevel: 'mandatory' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', waterBinderRatio: 0.4 }, [clause])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.skippedSpecialRules.length >= 1, true)
    }
  },
  {
    name: 'ComplianceRuleEngine keeps reference requirements out of explicit violations',
    run() {
      const clause = normalizeClause({
        section: '3.0.3',
        title: '引用要求',
        condition: '普通混凝土',
        rule: '最大水胶比应符合 GB 50010 规定',
        parameters: [{ name: '水胶比', value: '按 GB 50010 规定' }],
        originalText: '最大水胶比应符合 GB 50010 规定。'
      })
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', waterBinderRatio: 0.7 }, [clause])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.filteredClauseCounts.reference_requirement, 1)
    }
  },
  {
    name: 'ComplianceRuleEngine filters informational clauses out of manual review',
    run() {
      const clause = {
        section: '1.0.1',
        title: '适用范围',
        clauseRole: 'review_rule',
        manualReviewReason: '旧知识包误把适用范围当成人工确认。',
        originalText: '本规范适用于公路桥涵混凝土施工。'
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', waterBinderRatio: 0.45 }, [clause])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.filteredClauseCounts.informational, 1)
    }
  },
  {
    name: 'ComplianceRuleEngine skips special environment limit clause when environment missing',
    run() {
      const clause = {
        section: '5.2.1',
        title: '二类环境最大水胶比',
        clauseRole: 'review_rule',
        applicability: {
          environment: ['二类环境'],
          durabilityRequirements: [],
          requiresUserInput: ['environment']
        },
        limitRules: [{ targetField: 'waterBinderRatio', operator: '<=', limitValue: 0.5, constraintLevel: 'mandatory' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', waterBinderRatio: 0.45 }, [clause])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.skippedSpecialRules.length >= 1, true)
    }
  },
  {
    name: 'ComplianceRuleEngine sends unknown operators to manual review',
    run() {
      const clause = {
        section: '5.5',
        title: '未知比较符',
        clauseRole: 'review_rule',
        applicability: { environment: [], durabilityRequirements: [], requiresUserInput: [] },
        limitRules: [{ targetField: 'waterBinderRatio', operator: 'around', limitValue: 0.5, constraintLevel: 'mandatory' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', waterBinderRatio: 0.52 }, [clause])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 1)
      assert.strictEqual(result.manualReviewItems[0].reason.includes('未知限值比较符'), true)
    }
  },
  {
    name: 'ComplianceRuleEngine filters newly imported lookup grade tables out of manual review',
    run() {
      const clause = {
        section: '2.1.2',
        title: '维勃稠度等级划分',
        checkType: 'lookup',
        condition: '当需通过维勃稠度衡量混凝土拌合物工作性并确定配合比时，应参照等级划分',
        rule: '维勃稠度按表1划分为V0至V4共5个等级，每个等级对应规定的维勃时间范围',
        parameters: [
          { name: '维勃稠度等级', value: 'V0, V1, V2, V3, V4', unit: '无' },
          { name: '维勃时间', value: 'V0:≥31, V1:30~21, V2:20~11, V3:10~6, V4:5~3', unit: 's' }
        ],
        originalText: '用维勃稠度（s）可以合理表示坍落度很小甚至为零的混凝土拌合物稠度，维勃稠度等级划分应符合表1的规定。'
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', slump: 120 }, [clause])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.filteredClauseCounts.informational, 1)
    }
  },
  {
    name: 'ComplianceRuleEngine does not turn lookup table conditions into impossible numeric limits',
    run() {
      const clause = {
        section: '3.0.4',
        title: '最小胶凝材料用量限值',
        checkType: 'lookup',
        condition: '除配制C15及其以下强度等级的混凝土外，所有混凝土配合比设计时需考虑最小胶凝材料用量。',
        rule: '混凝土的最小胶凝材料用量应根据最大水胶比和混凝土类型按表3.0.4查表取值。',
        parameters: [
          { name: '最大水胶比', value: '0.60, 0.55, 0.50, ≤0.45', unit: '无量纲' },
          { name: '最小胶凝材料用量', value: '查表：当W/B=0.60时，素250，钢筋280，预应力300；当W/B≤0.45时，均为330', unit: 'kg/m³' }
        ],
        originalText: '混凝土的最小胶凝材料用量应符合表 3.0.4 的规定。'
      }
      const result = ComplianceRuleEngine.evaluateClauses({
        strength: 'C30',
        waterBinderRatio: 0.45,
        binderContent: 360,
        concreteType: '钢筋混凝土'
      }, [clause])

      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.ruleResults.some(rule => rule.checkType === 'waterBinderRatio'), false)
      assert.strictEqual(result.ruleResults.some(rule => rule.checkType === 'binderContent' && rule.limitValue === 330), true)
      assert.strictEqual(result.ruleResults.some(rule => rule.checkType === 'binderContent' && rule.limitValue < 100), false)
    }
  },
  {
    name: 'ComplianceRuleEngine ignores unparsed formula and trial adjustment clauses instead of manual flooding',
    run() {
      const clauses = [
        {
          section: '5.1.1',
          title: '混凝土水胶比计算公式（强度等级小于C60）',
          checkType: 'formula',
          condition: '强度等级小于C60时',
          rule: '水胶比应按公式计算，并应经试配调整确定。',
          parameters: []
        },
        {
          section: '5.3.2-5.3.3',
          title: '矿物掺合料掺量确定及试配调整说明',
          checkType: 'constraint',
          condition: '掺加矿物掺合料时',
          rule: '矿物掺合料掺量应通过试验确定，并在试配过程中调整。',
          parameters: []
        }
      ]
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', waterBinderRatio: 0.45 }, clauses)

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
    }
  },
  {
    name: 'ComplianceRuleEngine does not parse coarse aggregate sizes as air content limits',
    run() {
      const clause = {
        section: '3.0.7',
        title: '引气剂掺量及混凝土含气量要求',
        checkType: 'lookup',
        condition: '混凝土长期处于潮湿或水位变动的寒冷和严寒环境，以及盐冻环境',
        rule: '混凝土最小含气量应符合表3.0.7的规定（根据粗骨料最大公称粒径和环境类型查表），最大含气量不宜超过7.0%',
        parameters: [
          { name: '粗骨料最大公称粒径', value: '40.0, 25.0, 20.0', unit: 'mm' },
          { name: '潮湿或水位变动的寒冷和严寒环境最小含气量', value: '4.5, 5.0, 5.5', unit: '%' },
          { name: '最大含气量', value: '7.0', unit: '%' }
        ]
      }
      const result = ComplianceRuleEngine.evaluateClauses({ strength: 'C30', environment: '寒冷环境', airContent: 4.8 }, [clause])

      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.ruleResults.some(rule => rule.checkType === 'airContent' && rule.limitValue === 40), false)
    }
  },
  {
    name: 'ComplianceRuleEngine evaluates chloride content table by environment and concrete type',
    run() {
      const clause = {
        section: '3.0.6',
        title: '混凝土拌合物中水溶性氯离子最大含量限值',
        checkType: 'constraint',
        condition: '根据环境条件（干燥环境、潮湿但不含氯离子的环境、潮湿且含有氯离子的环境/盐渍土环境、除冰盐等侵蚀性物质的腐蚀环境）和混凝土类型（钢筋混凝土、预应力混凝土、素混凝土）',
        rule: '混凝土拌合物中水溶性氯离子最大含量（以水泥用量的质量百分比计）不得超过表3.0.6规定的限值：干燥环境：钢筋混凝土0.30%，预应力混凝土0.06%，素混凝土1.00%；潮湿但不含氯离子的环境：钢筋混凝土0.20%，预应力混凝土0.06%，素混凝土1.00%；潮湿且含有氯离子的环境、盐渍土环境：钢筋混凝土0.10%，预应力混凝土0.06%，素混凝土1.00%；除冰盐等侵蚀性物质的腐蚀环境：钢筋混凝土0.06%，预应力混凝土0.06%，素混凝土1.00%。',
        parameters: [{ name: '水溶性氯离子最大含量', value: '见表3.0.6', unit: '%' }]
      }
      const result = ComplianceRuleEngine.evaluateClauses({
        environment: '干燥环境',
        concreteType: '钢筋混凝土',
        chlorideContent: 0.20
      }, [clause])

      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.ruleResults.length, 1)
      assert.strictEqual(result.ruleResults[0].checkType, 'chlorideContent')
      assert.strictEqual(result.ruleResults[0].limitValue, 0.30)
    }
  },
  {
    name: 'ComplianceRuleEngine avoids JGJ55 false positives from directory formulas and table conditions',
    run() {
      const mixDesign = {
        strength: 'C30',
        waterBinderRatio: 0.473,
        cementContent: 259.1,
        waterAmount: 163.4,
        sandRatio: 42,
        flyAshRatio: 15,
        slump: 180
      }
      const clauses = [
        {
          section: '5.4',
          title: '砂率',
          parameters: [{ name: '砂率', value: '14%~40%', unit: '%' }],
          rule: '5.4 砂率 14\n5.4 Ratio of Sand to Aggregate 14\n5.4 砂率 40',
          originalText: '目录页：5.4 砂率 14；5.4 Ratio of Sand to Aggregate 14；5.4 砂率 40。'
        },
        {
          section: '3.0.4',
          title: '混凝土最小胶凝材料用量',
          checkType: 'lookup',
          rule: '混凝土的最小胶凝材料用量应符合表3.0.4的规定。表中含素混凝土、钢筋混凝土、预应力混凝土；最大水胶比为0.50时，最小胶凝材料用量为320kg/m3。',
          originalText: '混凝土的最小胶凝材料用量应符合表3.0.4的规定：素混凝土、钢筋混凝土、预应力混凝土；最大水胶比0.50，最小胶凝材料用量320kg/m3。'
        },
        {
          section: '3.0.5',
          title: '矿物掺合料最大掺量',
          checkType: 'lookup',
          rule: '采用普通硅酸盐水泥时，粉煤灰最大掺量应符合表3.0.5-1的规定。水胶比条件≤0.40或>0.40，>0.40时粉煤灰掺量不宜大于30%。',
          parameters: [
            { name: '水胶比条件', value: '≤0.40 或 >0.40' },
            { name: '粉煤灰掺量', value: '≤30%', unit: '%' }
          ],
          originalText: '表3.0.5-1规定普通硅酸盐水泥中粉煤灰最大掺量，水胶比>0.40时不宜大于30%。'
        },
        {
          section: '3.0.5',
          title: 'C类粉煤灰安定性检验',
          rule: '采用掺量30%以上的C类粉煤灰应进行安定性检验。',
          originalText: '采用掺量大于30%的C类粉煤灰应进行安定性检验。'
        },
        {
          section: '3.0.8',
          title: '粉煤灰碱含量',
          rule: '粉煤灰碱含量应按实测值的1/6计，碱含量不应大于3%。',
          originalText: '粉煤灰碱含量取实测值的1/6计入混凝土碱含量。'
        },
        {
          section: '5.5.2',
          title: '砂率计算公式',
          checkType: 'formula',
          parameters: [{ name: '砂率', value: '公式（5.5.1-2）' }],
          rule: '砂率应按公式（5.5.1-2）计算，并经试配调整确定。',
          originalText: '砂率应按公式（5.5.1-2）计算。'
        },
        {
          section: '5.2.1',
          title: '未掺加外加剂混凝土的用水量查表',
          rule: '表5.2.1-1和表5.2.1-2是未掺加外加剂的干硬性和塑性混凝土的用水量，经多年应用，证明基本符合实际。',
          originalText: '表 5.2.1-1 和表 5.2.1-2 是未掺加外加剂的干硬性和塑性混凝土的用水量，经多年应用，证明基本符合实际。'
        },
        {
          section: '7.3.3',
          title: '试配水胶比间距',
          rule: '试配时水胶比间距宜为0.02。',
          originalText: '三个水胶比的间距宜为0.02。'
        },
        {
          section: '7.4.3',
          title: '坍落度经时损失',
          rule: '坍落度经时损失不宜大于30mm/h。',
          originalText: '坍落度经时损失不宜大于30mm/h。'
        },
        {
          section: '2.1.15',
          title: '掺量与用量的含义说明',
          rule: '本规程中，掺量含义是相对质量百分比，用量含义是绝对质量。',
          originalText: '2.1.14、2.1.15 本规程中，掺量含义是相对质量百分比，用量含义是绝对质量。'
        },
        {
          section: '6.2.1',
          title: '配合比调整步骤',
          rule: '配合比调整时，用水量和外加剂用量应根据确定的水胶比作调整，胶凝材料用量应以用水量乘以确定的胶水比计算得出。',
          originalText: '6.2.1 配合比调整应符合规定，用水量和外加剂用量应根据确定的水胶比作调整。'
        },
        {
          section: '6.2.4',
          title: '配合比验证说明',
          rule: '配合比调整后，应测定拌合物水溶性氯离子含量，试验结果应符合本规程表3.0.6的规定。',
          originalText: '在确定设计配合比前，对混凝土氯离子含量进行试验验证是非常必要的。'
        },
        {
          section: '3.0.5',
          title: '复合掺合料组分掺量限制（注2）',
          rule: '复合掺合料各组分的掺量不宜超过单掺时的最大掺量。',
          originalText: '复合掺合料各组分的掺量不宜超过单掺时的最大掺量。'
        }
      ]

      const result = ComplianceRuleEngine.evaluateClauses(mixDesign, clauses)

      assert.strictEqual(result.normalizedMixDesign.binderContent > 345, true)
      assert.deepStrictEqual(result.ruleResults.filter(rule => rule.severity === 'error'), [])
      assert.strictEqual(result.ruleResults.some(rule => rule.clause === '5.4' && rule.checkType === 'sandRatio'), false)
      assert.strictEqual(result.ruleResults.some(rule => rule.clause === '3.0.5' && rule.checkType === 'waterBinderRatio'), false)
      assert.strictEqual(result.ruleResults.some(rule => rule.clause === '5.2.1' && rule.checkType === 'waterAmount'), false)
      assert.strictEqual(result.ruleResults.some(rule => rule.clause === '7.4.3' && rule.checkType === 'slump'), false)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.ruleResults.some(rule => (
        rule.clause === '3.0.4' &&
        rule.checkType === 'binderContent' &&
        rule.status === 'compliant' &&
        rule.limitValue === 320
      )), true)
      assert.strictEqual(result.ruleResults.some(rule => (
        rule.clause === '3.0.5' &&
        rule.checkType === 'flyAshRatio' &&
        rule.status === 'compliant' &&
        rule.limitValue === 30
      )), true)
    }
  },
  {
    name: 'ComplianceRuleEngine uses ordinary defaults when environment and concrete type are missing',
    run() {
      const result = ComplianceRuleEngine.evaluateClauses({
        strength: 'C30',
        waterBinderRatio: 0.46
      }, [
        {
          section: '5.1.1',
          standardName: '测试规范',
          clauseRole: 'review_rule',
          limitRules: [
            {
              targetField: 'waterBinderRatio',
              operator: '<=',
              limitValue: 0.5,
              constraintLevel: 'mandatory'
            }
          ],
          originalText: '普通混凝土最大水胶比不应大于0.50。'
        },
        {
          section: '5.1.2',
          standardName: '测试规范',
          clauseRole: 'review_rule',
          applicability: { environment: ['二类环境'] },
          limitRules: [
            {
              targetField: 'waterBinderRatio',
              operator: '<=',
              limitValue: 0.45,
              constraintLevel: 'mandatory'
            }
          ],
          originalText: '二类环境最大水胶比不应大于0.45。'
        },
        {
          section: '5.1.3',
          standardName: '测试规范',
          clauseRole: 'review_rule',
          applicability: { concreteType: ['预应力混凝土'] },
          limitRules: [
            {
              targetField: 'waterBinderRatio',
              operator: '<=',
              limitValue: 0.4,
              constraintLevel: 'mandatory'
            }
          ],
          originalText: '预应力混凝土最大水胶比不应大于0.40。'
        }
      ])

      assert.strictEqual(result.assumptions.length, 2)
      assert.strictEqual(result.assumptionNotice.includes('由于用户未指定环境类别/混凝土类别'), true)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.ruleResults.length, 1)
      assert.strictEqual(result.ruleResults[0].clause, '5.1.1')
      assert.strictEqual(result.skippedSpecialRules.length, 2)
    }
  },
  {
    name: 'ComplianceRuleEngine skips special concrete type clauses when concrete type is missing',
    run() {
      const result = ComplianceRuleEngine.evaluateClauses({
        strength: 'C30',
        waterBinderRatio: 0.473,
        flyAshRatio: 15
      }, [
        {
          section: '3.0.5',
          title: '预应力混凝土中矿物掺合料最大掺量',
          rule: '预应力混凝土中粉煤灰掺量不宜大于30%。',
          parameters: [{ name: '粉煤灰掺量', value: '≤30%', unit: '%' }]
        },
        {
          section: '7.3.1',
          title: '高强混凝土粗骨料技术要求',
          rule: '配制高强混凝土时，粗骨料含泥量不应大于0.5%。'
        }
      ])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 0)
      assert.strictEqual(result.skippedSpecialRules.length, 2)
    }
  },
  {
    name: 'ComplianceRuleEngine enables special environment when user provides environment',
    run() {
      const result = ComplianceRuleEngine.evaluateClauses({
        strength: 'C30',
        environment: '二类环境',
        concreteType: '普通混凝土',
        waterBinderRatio: 0.46
      }, [
        {
          section: '5.1.2',
          standardName: '测试规范',
          clauseRole: 'review_rule',
          applicability: { environment: ['二类环境'] },
          limitRules: [
            {
              targetField: 'waterBinderRatio',
              operator: '<=',
              limitValue: 0.45,
              constraintLevel: 'mandatory'
            }
          ],
          originalText: '二类环境最大水胶比不应大于0.45。'
        }
      ])

      assert.strictEqual(result.assumptions.length, 0)
      assert.strictEqual(result.skippedSpecialRules.length, 0)
      assert.strictEqual(result.ruleResults.length, 1)
      assert.strictEqual(result.ruleResults[0].severity, 'error')
    }
  },
  {
    name: 'ComplianceRuleEngine compresses repeated missing material value reviews',
    run() {
      const result = ComplianceRuleEngine.evaluateClauses({
        strength: 'C30'
      }, [
        {
          section: '6.1.1',
          standardName: '测试规范',
          clauseRole: 'material_requirement',
          limitRules: [
            {
              targetField: 'chlorideContent',
              operator: '<=',
              limitValue: 0.06,
              constraintLevel: 'mandatory'
            }
          ],
          originalText: '氯离子含量不应大于0.06%。'
        },
        {
          section: '6.1.2',
          standardName: '测试规范',
          clauseRole: 'material_requirement',
          limitRules: [
            {
              targetField: 'chlorideContent',
              operator: '<=',
              limitValue: 0.1,
              constraintLevel: 'mandatory'
            }
          ],
          originalText: '氯离子含量不应大于0.10%。'
        }
      ])

      assert.strictEqual(result.ruleResults.length, 0)
      assert.strictEqual(result.manualReviewItems.length, 1)
      assert.strictEqual(result.manualReviewItems[0].count, 2)
      assert.strictEqual(result.manualReviewItems[0].field, 'chlorideContent')
      assert.strictEqual(result.manualReviewItems[0].reason.includes('缺少氯离子含量'), true)
    }
  },
  {
    name: 'StandardComplianceService audit prompt includes assumptions and excludes vector only clauses',
    run() {
      const service = new StandardComplianceService({ apiKey: 'test' })
      const prompt = service._buildAuditPrompt(
        { strength: 'C30', waterBinderRatio: 0.46 },
        [
          {
            clause: '5.1.1',
            standardName: '测试规范',
            checkType: 'waterBinderRatio',
            status: 'compliant',
            severity: 'info',
            message: '水胶比满足规范要求',
            currentValue: 0.46,
            limitValue: 0.5,
            comparison: '<= 0.5',
            originalText: '普通混凝土最大水胶比不应大于0.50。'
          }
        ],
        [
          {
            section: '1.0.1',
            source: 'vector',
            originalText: '这是一段不应进入AI提示词的向量候选说明条文。'
          }
        ],
        [],
        null,
        {
          assumptions: [
            { field: 'environment', defaultValue: '常规环境', reason: '用户未指定环境类别' }
          ],
          assumptionNotice: '由于用户未指定环境类别/混凝土类别，本次审查按常规环境和类别进行审查；如有环境类别或混凝土类别要求，请补充后重新调用审查。',
          skippedSpecialRules: []
        }
      )

      assert.strictEqual(prompt.includes('默认假设'), true)
      assert.strictEqual(prompt.includes('用户未指定环境类别'), true)
      assert.strictEqual(prompt.includes('普通混凝土最大水胶比不应大于0.50'), true)
      assert.strictEqual(prompt.includes('不应进入AI提示词'), false)
    }
  },
  {
    name: 'StandardComplianceService fallback report carries assumptions',
    run() {
      const service = new StandardComplianceService({ apiKey: 'test' })
      const report = service._buildFallbackReport([], { strength: 'C30' }, [], null, {}, {
        assumptions: [{ field: 'concreteType', defaultValue: '普通混凝土', reason: '用户未指定混凝土类别' }],
        assumptionNotice: '由于用户未指定环境类别/混凝土类别，本次审查按常规环境和类别进行审查；如有环境类别或混凝土类别要求，请补充后重新调用审查。',
        skippedSpecialRules: []
      })

      assert.strictEqual(report.assumptions.length, 1)
      assert.strictEqual(report.assumptionNotice.includes('按常规环境和类别进行审查'), true)
    }
  },
  {
    name: 'StandardComplianceService filters informational vector clauses before prompt merge',
    run() {
      const service = new StandardComplianceService({ apiKey: 'test' })
      const merged = service._mergeResults([
        {
          section: '1.0.1',
          title: '适用范围',
          clauseRole: 'review_rule',
          originalText: '本规范适用于公路桥涵混凝土施工。',
          similarity: 0.98
        },
        {
          section: '5.2.1',
          title: '最大水胶比',
          clauseRole: 'review_rule',
          originalText: '水胶比不应大于0.50。',
          parameters: [{ name: '水胶比', value: '不应大于0.50' }],
          similarity: 0.95
        }
      ], [])

      assert.strictEqual(merged.length, 1)
      assert.strictEqual(merged[0].section, '5.2.1')
    }
  },
  {
    name: 'StandardComplianceService fallback report keeps filtered clause counts',
    run() {
      const service = new StandardComplianceService({ apiKey: 'test' })
      const report = service._buildFallbackReport([], { strength: 'C30' }, [], null, {
        informational: 3,
        reference_requirement: 2
      })

      assert.strictEqual(report.filteredClauseCounts.informational, 3)
      assert.strictEqual(report.filteredClauseCounts.reference_requirement, 2)
    }
  }
]

let passed = 0
for (const test of tests) {
  try {
    test.run()
    passed++
    console.log(`✓ ${test.name}`)
  } catch (error) {
    console.error(`✗ ${test.name}`)
    throw error
  }
}

console.log(`\nStandardScopeService tests passed: ${passed}/${tests.length}`)

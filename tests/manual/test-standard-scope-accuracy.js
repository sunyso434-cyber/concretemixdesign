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
    name: 'ComplianceRuleEngine sends missing environment clauses to manual review',
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
      assert.strictEqual(result.manualReviewItems.length, 1)
      assert.strictEqual(result.manualReviewItems[0].reason, '缺少环境类别，无法判断该条款是否适用。')
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
    name: 'ComplianceRuleEngine sends missing durability clauses to manual review',
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
      assert.strictEqual(result.manualReviewItems.length, 1)
      assert.strictEqual(result.manualReviewItems[0].reason, '缺少耐久性要求，无法判断该条款是否适用。')
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
    }
  },
  {
    name: 'ComplianceRuleEngine keeps missing environment limit clause in manual review',
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
      assert.strictEqual(result.manualReviewItems.length, 1)
      assert.strictEqual(result.manualReviewItems[0].reason, '缺少环境类别，无法判断该条款是否适用。')
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
      assert.strictEqual(result.manualReviewItems[0].reason, '未知限值比较符，无法自动判断。')
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

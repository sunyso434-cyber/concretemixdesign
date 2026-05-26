/**
 * 规范审查核心服务
 * 负责：加载知识包 → 向量检索 + 规则匹配 → 合并去重 → DeepSeek生成审查报告
 */

const axios = require('axios')
const EmbeddingService = require('./EmbeddingService')
// StandardKnowledgeService 是单例导出，直接 require 即可使用
const knowledgeService = require('./StandardKnowledgeService')
const StandardScopeService = require('./StandardScopeService')
const StandardClauseNormalizer = require('./StandardClauseNormalizer')
const ComplianceRuleEngine = require('./ComplianceRuleEngine')

// DeepSeek API 地址
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/**
 * 条款参数限值名称 → 对比函数映射
 * 每个参数名对应一条规则：从配合比参数取当前值，与条款限值做数值比对
 */
const PARAM_RULES = {
  maxWaterBinderRatio: {
    field: 'waterBinderRatio',
    keywords: ['水胶比', '水灰比', 'w/b', 'w/c', 'water', '水胶'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `水胶比 ${current} 超过规范限值 ${limit}`
  },
  minWaterBinderRatio: {
    field: 'waterBinderRatio',
    keywords: ['水胶比', '水灰比', 'w/b', 'w/c'],
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `水胶比 ${current} 低于规范最小值 ${limit}`
  },
  minCementContent: {
    field: 'cementContent',
    keywords: ['水泥用量', '水泥', '胶凝材料', '胶材', 'cement', '最小水泥'],
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `水泥用量 ${current} kg/m³ 低于规范最小值 ${limit} kg/m³`
  },
  maxCementContent: {
    field: 'cementContent',
    keywords: ['水泥用量', '水泥', '最大水泥'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `水泥用量 ${current} kg/m³ 超过规范最大值 ${limit} kg/m³`
  },
  minTotalBinder: {
    field: 'binderContent',
    keywords: ['胶凝材料总量', '胶材总量', '总胶材', '最小胶凝'],
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `胶凝材料总量 ${current} kg/m³ 低于规范最小值 ${limit} kg/m³`
  },
  maxFlyAshRatio: {
    field: 'flyAshRatio',
    keywords: ['粉煤灰', '粉煤灰掺量', 'flyash', 'fly ash', '粉煤灰比例'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `粉煤灰掺量 ${current}% 超过规范限值 ${limit}%`
  },
  maxSlagRatio: {
    field: 'slagRatio',
    keywords: ['矿渣粉', '矿渣', '矿粉', 'slag', '矿渣掺量', '矿渣粉掺量'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `矿渣粉掺量 ${current}% 超过规范限值 ${limit}%`
  },
  maxLithiumSlagRatio: {
    field: 'lithiumSlagRatio',
    keywords: ['锂渣', '锂渣粉', '锂渣掺量'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `锂渣掺量 ${current}% 超过规范限值 ${limit}%`
  },
  maxCompositePowderRatio: {
    field: 'compositePowderRatio',
    keywords: ['复合粉', '复合掺合料', '复合粉掺量'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `复合粉掺量 ${current}% 超过规范限值 ${limit}%`
  },
  minSandRatio: {
    field: 'sandRatio',
    keywords: ['砂率', '含砂率', '砂的比例', 'sand'],
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `砂率 ${current}% 低于规范最小值 ${limit}%`
  },
  maxSandRatio: {
    field: 'sandRatio',
    keywords: ['砂率', '含砂率', '砂的比例', 'sand', '最大砂率'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `砂率 ${current}% 超过规范最大值 ${limit}%`
  },
  maxSlump: {
    field: 'slump',
    keywords: ['坍落度', '塌落度', 'slump', '最大坍落度'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `坍落度 ${current} mm 超过规范最大值 ${limit} mm`
  },
  minSlump: {
    field: 'slump',
    keywords: ['坍落度', '塌落度', 'slump', '最小坍落度'],
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `坍落度 ${current} mm 低于规范最小值 ${limit} mm`
  },
  maxAirContent: {
    field: 'airContent',
    keywords: ['含气量', 'air', '引气', '最大含气量'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `含气量 ${current}% 超过规范最大值 ${limit}%`
  },
  minAirContent: {
    field: 'airContent',
    keywords: ['含气量', 'air', '引气', '最小含气量'],
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `含气量 ${current}% 低于规范最小值 ${limit}%`
  },
  maxWaterAmount: {
    field: 'waterAmount',
    keywords: ['用水量', '单位用水量', 'water amount', '最大用水量'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `单位用水量 ${current} kg/m³ 超过规范最大值 ${limit} kg/m³`
  },
  maxChlorideContent: {
    field: 'chlorideContent',
    keywords: ['氯离子含量', '氯含量', '氯离子', 'chloride', 'cl-', '最大氯离子'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `氯离子含量 ${current}% 超过规范限值 ${limit}%`
  },
  maxMudContent: {
    field: 'mudContent',
    keywords: ['含泥量', '泥含量', 'mud', '最大含泥量'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `含泥量 ${current}% 超过规范限值 ${limit}%`
  },
  maxMicaContent: {
    field: 'micaContent',
    keywords: ['云母含量', 'mica', '最大云母含量'],
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `云母含量 ${current}% 超过规范限值 ${limit}%`
  },
  strengthRequirement: {
    field: 'strength',
    keywords: ['强度等级', '强度', '配置强度', 'strength', '强度要求'],
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `配置强度 ${current} MPa 低于规范要求 ${limit} MPa`
  }
}

class StandardComplianceService {
  /**
   * @param {object} deepSeekService - DeepSeekService 实例
   */
  constructor(deepSeekService) {
    this._deepSeekService = deepSeekService
    // StandardKnowledgeService 是单例导出，无需手动实例化
    this._knowledgeService = knowledgeService
  }

  // ========== 公开方法 ==========

  /**
   * 规范审查主入口
   * 流程：加载知识包 → 查询向量化 → 向量检索 → 规则匹配 → 合并去重 → DeepSeek生成报告
   * @param {object} mixDesign - 配合比参数对象
   * @param {object|string[]|null} scopeOptions - 审查范围，数组表示规范ID列表
   * @returns {Promise<object>} 审查报告
   */
  async check(mixDesign, scopeOptions = null) {
    try {
      // 第一步：加载知识包
      console.log('[StandardCompliance] 正在加载知识包...')
      const allClauses = await this._knowledgeService.loadAllStandards()

      if (!allClauses || allClauses.length === 0) {
        return this._buildEmptyReport('未找到任何规范知识包，请先导入规范 Markdown 文件')
      }

      const standards = await this._knowledgeService.listStandards()
      const scopeResult = StandardScopeService.resolveStandardsScope(
        standards,
        Array.isArray(scopeOptions) ? { standards: scopeOptions } : (scopeOptions || {})
      )

      if (!scopeResult.success) {
        return {
          complianceStatus: 'conditional',
          issues: [],
          compliantItems: [],
          manualReviewItems: [],
          scope: null,
          summary: scopeResult.message,
          errorCode: scopeResult.errorCode,
          candidates: scopeResult.candidates || [],
          availableStandards: scopeResult.availableStandards || [],
          availableCategories: scopeResult.availableCategories || []
        }
      }

      const allowedStandardIds = new Set(scopeResult.standardIds)
      const clauses = allClauses.filter(c => allowedStandardIds.has(c.standardId))
      if (clauses.length === 0) {
        return this._buildEmptyReport('未找到指定审查范围内的规范条款', scopeResult)
      }

      // 过滤掉没有 embedding 的条款
      const normalizedClauses = this._normalizeClausesForReview(clauses)
      const reviewableClauses = normalizedClauses.filter(clause => ComplianceRuleEngine.isReviewableClause(clause))
      const clausesWithEmbedding = reviewableClauses.filter(c => c.embedding && c.embedding.length > 0)
      const clausesWithoutEmbedding = reviewableClauses.filter(c => !c.embedding || c.embedding.length === 0)

      // 第二步：构建查询文本
      console.log('[StandardCompliance] 正在构建查询文本...')
      const queryText = this._buildQueryText(mixDesign)

      // 第三步：查询向量化
      let vectorResults = []
      if (clausesWithEmbedding.length > 0) {
        try {
          console.log('[StandardCompliance] 正在计算查询向量...')
          const queryEmbedding = await EmbeddingService.embed(queryText)

          // 第四步：向量检索 Top-10
          console.log('[StandardCompliance] 正在执行向量检索...')
          vectorResults = this._vectorSearch(queryEmbedding, clausesWithEmbedding, 10)
        } catch (embedError) {
          console.error('[StandardCompliance] 向量化失败，跳过向量检索:', embedError.message)
        }
      }

      // 第五步：结构化规则匹配
      console.log('[StandardCompliance] 正在执行规则匹配...')
      const deterministic = ComplianceRuleEngine.evaluateClauses(mixDesign, normalizedClauses)
      const ruleResults = deterministic.ruleResults
      const manualReviewItems = deterministic.manualReviewItems
      const filteredClauseCounts = deterministic.filteredClauseCounts || {}
      const reviewContext = {
        assumptions: deterministic.assumptions || [],
        assumptionNotice: deterministic.assumptionNotice || '',
        skippedSpecialRules: deterministic.skippedSpecialRules || []
      }

      // 第六步：合并去重（规则匹配优先）
      const mergedResults = this._mergeResults(vectorResults, ruleResults)

      if (mergedResults.length === 0 && manualReviewItems.length === 0) {
        return this._buildEmptyReport('未找到与当前配合比相关的规范条款', scopeResult)
      }

      // 第七步：调用 DeepSeek 生成审查报告
      try {
        console.log('[StandardCompliance] 正在调用DeepSeek生成审查报告...')
        const report = await this._generateReport(mixDesign, ruleResults, mergedResults, manualReviewItems, scopeResult, reviewContext)
        return this._attachDeterministicReportGuards(report, ruleResults, manualReviewItems, scopeResult, filteredClauseCounts, reviewContext)
      } catch (aiError) {
        console.error('[StandardCompliance] DeepSeek生成报告失败，降级返回规则匹配结果:', aiError.message)
        // 降级：返回结构化规则匹配结果
        return this._buildFallbackReport(ruleResults, mixDesign, manualReviewItems, scopeResult, filteredClauseCounts, reviewContext)
      }
    } catch (error) {
      console.error('[StandardCompliance] 规范审查失败:', error)
      throw new Error(`规范审查失败: ${error.message}`)
    }
  }

  // ========== 私有方法 ==========

  _normalizeClausesForReview(clauses = []) {
    return (clauses || []).map(clause => StandardClauseNormalizer.normalizeClause(clause))
  }

  _buildScopeSummary(scopeResult) {
    const requested = scopeResult?.requested
      ?? scopeResult?.requestedNames
      ?? scopeResult?.requestedCategories
      ?? scopeResult?.standardIds
      ?? null
    return scopeResult ? {
      mode: scopeResult.mode,
      requested,
      matchedStandards: scopeResult.matchedStandards || scopeResult.standards || []
    } : null
  }

  _attachDeterministicReportGuards(report, ruleResults, manualReviewItems, scopeResult, filteredClauseCounts = {}, reviewContext = {}) {
    const deterministicErrorKeys = new Set(
      ruleResults
        .filter(r => r.severity === 'error' || r.level === '明确不合规')
        .map(r => `${r.standardName}__${r.clause}__${r.checkType}`)
    )
    const deterministicErrorClauseKeys = new Set(
      ruleResults
        .filter(r => r.severity === 'error' || r.level === '明确不合规')
        .map(r => `${r.standardName}__${r.clause}`)
    )

    const guardedIssues = (report.issues || []).map(issue => {
      const key = `${issue.standardName}__${issue.clause}__${issue.checkType}`
      const clauseKey = `${issue.standardName}__${issue.clause}`
      if (issue.severity === 'error' && !deterministicErrorKeys.has(key) && !deterministicErrorClauseKeys.has(clauseKey)) {
        return {
          ...issue,
          severity: 'warning',
          level: '需人工确认',
          suggestion: issue.suggestion || '该问题未被程序规则确认为明确违规，建议人工复核。'
        }
      }
      return issue
    })

    const existingIssueKeys = new Set(guardedIssues.map(issue => `${issue.standardName}__${issue.clause}__${issue.checkType}`))
    for (const result of ruleResults.filter(r => r.severity === 'error' || r.level === '明确不合规')) {
      const key = `${result.standardName}__${result.clause}__${result.checkType}`
      if (existingIssueKeys.has(key)) continue
      guardedIssues.push({
        clause: result.clause,
        standardName: result.standardName,
        checkType: result.checkType,
        severity: 'error',
        level: result.level || '明确不合规',
        message: result.message,
        currentValue: result.currentValue,
        limitValue: result.limitValue,
        suggestion: result.suggestion || ''
      })
      existingIssueKeys.add(key)
    }

    const hasError = guardedIssues.some(issue => issue.severity === 'error')
    const hasWarning = guardedIssues.some(issue => issue.severity === 'warning') || manualReviewItems.length > 0

    return {
      ...report,
      scope: this._buildScopeSummary(scopeResult),
      issues: guardedIssues,
      manualReviewItems,
      filteredClauseCounts,
      assumptions: reviewContext.assumptions || report.assumptions || [],
      assumptionNotice: reviewContext.assumptionNotice || report.assumptionNotice || '',
      skippedSpecialRules: reviewContext.skippedSpecialRules || report.skippedSpecialRules || [],
      complianceStatus: hasError ? 'non_compliant' : (hasWarning ? 'conditional' : 'compliant')
    }
  }

  /**
   * 将配合比参数拼成自然语言查询文本
   * 用于向量语义检索，让相关条款能被匹配到
   * @param {object} mixDesign - 配合比参数对象
   * @returns {string} 自然语言查询文本
   */
  _buildQueryText(mixDesign) {
    const parts = []

    // 强度等级
    if (mixDesign.strength) {
      parts.push(`强度等级${mixDesign.strength}`)
    }

    // 坍落度
    if (mixDesign.slump != null) {
      parts.push(`坍落度${mixDesign.slump}mm`)
    }

    // 水胶比
    if (mixDesign.waterBinderRatio != null) {
      parts.push(`水胶比${mixDesign.waterBinderRatio}`)
    }

    // 水胶比（兼容字段名）
    if (mixDesign.waterRatio != null && mixDesign.waterBinderRatio == null) {
      parts.push(`水胶比${mixDesign.waterRatio}`)
    }

    // 砂率
    if (mixDesign.sandRatio != null) {
      parts.push(`砂率${mixDesign.sandRatio}%`)
    }

    // 水泥用量
    if (mixDesign.cementContent != null) {
      parts.push(`水泥用量${mixDesign.cementContent}kg/m³`)
    }

    // 从 materials 对象中提取水泥用量
    if (mixDesign.materials?.cement != null && mixDesign.cementContent == null) {
      const cementAmount = typeof mixDesign.materials.cement === 'object'
        ? mixDesign.materials.cement.amount || mixDesign.materials.cement.usage
        : mixDesign.materials.cement
      if (cementAmount != null) {
        parts.push(`水泥用量${cementAmount}kg/m³`)
      }
    }

    // 胶凝材料总量
    if (mixDesign.binderContent != null) {
      parts.push(`胶凝材料总量${mixDesign.binderContent}kg/m³`)
    }

    // 用水量
    if (mixDesign.waterAmount != null && !parts.some(p => p.includes('用水量'))) {
      parts.push(`用水量${mixDesign.waterAmount}kg/m³`)
    }

    // 粉煤灰掺量
    if (mixDesign.flyAshRatio != null) {
      parts.push(`粉煤灰掺量${mixDesign.flyAshRatio}%`)
    }
    if (mixDesign.flyAshDosage != null && mixDesign.flyAshRatio == null) {
      parts.push(`粉煤灰掺量${mixDesign.flyAshDosage}%`)
    }

    // 矿渣粉掺量
    if (mixDesign.slagRatio != null) {
      parts.push(`矿渣粉掺量${mixDesign.slagRatio}%`)
    }
    if (mixDesign.slagDosage != null && mixDesign.slagRatio == null) {
      parts.push(`矿渣粉掺量${mixDesign.slagDosage}%`)
    }

    // 含气量
    if (mixDesign.airContent != null) {
      parts.push(`含气量${mixDesign.airContent}%`)
    }

    // 氯离子含量
    if (mixDesign.chlorideContent != null) {
      parts.push(`氯离子含量${mixDesign.chlorideContent}%`)
    }

    // 含泥量
    if (mixDesign.mudContent != null) {
      parts.push(`含泥量${mixDesign.mudContent}%`)
    }

    // 云母含量
    if (mixDesign.micaContent != null) {
      parts.push(`云母含量${mixDesign.micaContent}%`)
    }

    // 环境条件
    if (mixDesign.environment) {
      parts.push(`环境条件${mixDesign.environment}`)
    }

    // 原材料性能参数（根据材料ID查询到的实际参数）
    const mp = mixDesign.materialProperties
    if (mp) {
      if (mp.cement) {
        const c = mp.cement
        const cParts = []
        if (c.name) cParts.push(c.name)
        if (c.compressiveStrength28d != null) cParts.push(`28d抗压强度${c.compressiveStrength28d}MPa`)
        if (c.flexuralStrength28d != null) cParts.push(`28d抗折强度${c.flexuralStrength28d}MPa`)
        if (c.specificSurfaceArea != null) cParts.push(`比表面积${c.specificSurfaceArea}m²/kg`)
        if (c.stability) cParts.push(`安定性${c.stability}`)
        if (c.initialSettingTime != null) cParts.push(`初凝${c.initialSettingTime}min`)
        if (cParts.length > 0) parts.push(`水泥${cParts.join('、')}`)
      }
      if (mp.sands?.length) {
        for (const sand of mp.sands) {
          const sParts = []
          if (sand.name) sParts.push(sand.name)
          if (sand.mudContent != null) sParts.push(`含泥量${sand.mudContent}%`)
          if (sand.clayLumpContent != null) sParts.push(`泥块含量${sand.clayLumpContent}%`)
          if (sand.mbValue != null) sParts.push(`MB值${sand.mbValue}`)
          if (sand.finenessModulus != null) sParts.push(`细度模数${sand.finenessModulus}`)
          if (sParts.length > 0) parts.push(`细骨料${sParts.join('、')}`)
        }
      }
      if (mp.stones?.length) {
        for (const stone of mp.stones) {
          const stParts = []
          if (stone.name) stParts.push(stone.name)
          if (stone.mudContent != null) stParts.push(`含泥量${stone.mudContent}%`)
          if (stone.crushingValue != null) stParts.push(`压碎值${stone.crushingValue}%`)
          if (stone.needleFlakeContent != null) stParts.push(`针片状含量${stone.needleFlakeContent}%`)
          if (stone.grading) stParts.push(`级配${stone.grading}`)
          if (stParts.length > 0) parts.push(`粗骨料${stParts.join('、')}`)
        }
      }
      if (mp.flyAsh) {
        const f = mp.flyAsh
        const fParts = []
        if (f.name) fParts.push(f.name)
        if (f.waterDemandRatio != null) fParts.push(`需水量比${f.waterDemandRatio}%`)
        if (f.lossOnIgnition != null) fParts.push(`烧失量${f.lossOnIgnition}%`)
        if (f.activityIndex28d != null) fParts.push(`28d活性指数${f.activityIndex28d}%`)
        if (f.fineness != null) fParts.push(`细度${f.fineness}`)
        if (fParts.length > 0) parts.push(`粉煤灰${fParts.join('、')}`)
      }
      if (mp.slag) {
        const s = mp.slag
        const sParts = []
        if (s.name) sParts.push(s.name)
        if (s.specificSurfaceArea != null) sParts.push(`比表面积${s.specificSurfaceArea}m²/kg`)
        if (s.activityIndex28d != null) sParts.push(`28d活性指数${s.activityIndex28d}%`)
        if (s.lossOnIgnition != null) sParts.push(`烧失量${s.lossOnIgnition}%`)
        if (sParts.length > 0) parts.push(`矿渣粉${sParts.join('、')}`)
      }
      if (mp.lithiumSlag) {
        const l = mp.lithiumSlag
        const lParts = []
        if (l.name) lParts.push(l.name)
        if (l.activityIndex28d != null) lParts.push(`28d活性指数${l.activityIndex28d}%`)
        if (l.lossOnIgnition != null) lParts.push(`烧失量${l.lossOnIgnition}%`)
        if (lParts.length > 0) parts.push(`锂渣${lParts.join('、')}`)
      }
      if (mp.compositePowder) {
        const cp = mp.compositePowder
        const cpParts = []
        if (cp.name) cpParts.push(cp.name)
        if (cp.activityIndex28d != null) cpParts.push(`28d活性指数${cp.activityIndex28d}%`)
        if (cp.lossOnIgnition != null) cpParts.push(`烧失量${cp.lossOnIgnition}%`)
        if (cpParts.length > 0) parts.push(`复合粉${cpParts.join('、')}`)
      }
      if (mp.superplasticizer) {
        const sp = mp.superplasticizer
        const spParts = []
        if (sp.name) spParts.push(sp.name)
        if (sp.waterReducingRate != null) spParts.push(`减水率${sp.waterReducingRate}%`)
        if (sp.solidContent != null) spParts.push(`固含量${sp.solidContent}%`)
        if (spParts.length > 0) parts.push(`减水剂${spParts.join('、')}`)
      }
    }

    return parts.join('，') || '混凝土配合比设计'
  }

  /**
   * 计算两个向量的余弦相似度
   * @param {number[]} vecA - 向量A
   * @param {number[]} vecB - 向量B
   * @returns {number} 余弦相似度 [-1, 1]
   */
  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i]
      normA += vecA[i] * vecA[i]
      normB += vecB[i] * vecB[i]
    }

    normA = Math.sqrt(normA)
    normB = Math.sqrt(normB)

    if (normA < 1e-12 || normB < 1e-12) return 0
    return dotProduct / (normA * normB)
  }

  /**
   * 向量检索：遍历条款计算相似度，取 Top-K
   * @param {number[]} queryEmbedding - 查询向量
   * @param {Array} clauses - 条款列表（含 embedding）
   * @param {number} topK - 返回最相似的 topK 条条款
   * @returns {Array} 匹配结果列表，每条包含 similarity 字段
   */
  _vectorSearch(queryEmbedding, clauses, topK = 10) {
    // 计算每条条款与查询的相似度
    const scored = clauses.map(clause => {
      const similarity = this._cosineSimilarity(queryEmbedding, clause.embedding)
      return { ...clause, similarity }
    })

    // 按相似度降序排序
    scored.sort((a, b) => b.similarity - a.similarity)

    // 取 Top-K
    return scored.slice(0, topK).map(({ embedding, ...rest }) => rest)
  }

  /**
   * 结构化规则匹配
   * 通过关键词匹配条款参数名与配合比字段，做数值比对
   * @param {object} mixDesign - 配合比参数对象
   * @param {Array} clauses - 条款列表
   * @returns {Array} 规则匹配结果列表
   */
  _matchStructuralRules(mixDesign, clauses) {
    const paramValues = this._extractParamValues(mixDesign)
    const strength = mixDesign.strength || null
    const results = []

    for (const clause of clauses) {
      if (!clause.parameters || !Array.isArray(clause.parameters)) continue

      // 条件过滤：检查条款的适用条件是否匹配当前强度等级
      if (clause.condition && !this._matchStrengthCondition(clause.condition, strength)) {
        continue
      }

      for (const param of clause.parameters) {
        // 用关键词匹配找到对应的规则
        const ruleKey = this._findMatchingRule(param)
        if (!ruleKey) continue

        const rule = PARAM_RULES[ruleKey]

        // 从配合比中取当前值
        const currentValue = paramValues[rule.field]
        if (currentValue == null) continue

        // 限值可能是字符串，需要转数值
        const limitValue = this._parseNumericValue(param.value)
        if (limitValue == null || isNaN(limitValue)) continue

        // 比对
        const isCompliant = rule.compare(currentValue, limitValue)

        // 判断是否临界（±5% 范围内）
        let status = isCompliant ? 'compliant' : 'non_compliant'
        if (isCompliant) {
          const margin = Math.abs(currentValue - limitValue) / limitValue
          if (margin <= 0.05) {
            status = 'marginal'
          }
        }

        results.push({
          clause: clause.section || '',
          standardName: clause.standardName || '',
          standardVersion: clause.standardVersion || '',
          checkType: clause.checkType,
          title: clause.title || '',
          originalText: clause.originalText || '',
          condition: clause.condition || '',
          rule: clause.rule || '',
          paramName: param.name,
          paramSymbol: param.symbol || '',
          currentValue,
          limitValue,
          status,
          message: isCompliant
            ? (status === 'marginal'
              ? `${this._getFieldLabel(rule.field)} ${currentValue} 接近规范限值 ${limitValue}（偏差在5%以内）`
              : `满足规范要求`)
            : rule.message(currentValue, limitValue),
          severity: isCompliant ? (status === 'marginal' ? 'warning' : 'info') : 'error',
          source: 'rule'
        })
      }
    }

    return results
  }

  /**
   * 根据参数名/符号通过关键词匹配找到对应的规则键
   * @param {object} param - 条款参数 { name, symbol }
   * @returns {string|null} 匹配到的规则键，未匹配返回 null
   */
  _findMatchingRule(param) {
    if (!param || !param.name) return null

    const name = (param.name || '').toLowerCase()
    const symbol = (param.symbol || '').toLowerCase()

    for (const [ruleKey, ruleDef] of Object.entries(PARAM_RULES)) {
      for (const keyword of ruleDef.keywords) {
        if (name.includes(keyword.toLowerCase()) || (symbol && symbol.includes(keyword.toLowerCase()))) {
          return ruleKey
        }
      }
    }
    return null
  }

  /**
   * 获取字段的中文标签
   * @param {string} field - 字段名
   * @returns {string} 中文标签
   */
  _getFieldLabel(field) {
    const labels = {
      waterBinderRatio: '水胶比',
      cementContent: '水泥用量',
      binderContent: '胶凝材料总量',
      sandRatio: '砂率',
      flyAshRatio: '粉煤灰掺量',
      slagRatio: '矿渣粉掺量',
      lithiumSlagRatio: '锂渣掺量',
      compositePowderRatio: '复合粉掺量',
      slump: '坍落度',
      airContent: '含气量',
      waterAmount: '用水量',
      strength: '配置强度',
      chlorideContent: '氯离子含量',
      mudContent: '含泥量',
      micaContent: '云母含量'
    }
    return labels[field] || field
  }

  /**
   * 从配合比参数对象中提取标准化比较值
   * 适配不同的数据结构（materials 对象、扁平字段等）
   * @param {object} mixDesign - 配合比参数对象
   * @returns {object} 标准化后的参数值映射
   */
  _extractParamValues(mixDesign) {
    const values = {}

    // 水胶比 - 优先取 waterBinderRatio，兼容 waterRatio
    values.waterBinderRatio = mixDesign.waterBinderRatio ?? mixDesign.waterRatio ?? null

    // 砂率
    values.sandRatio = mixDesign.sandRatio ?? null

    // 坍落度
    values.slump = mixDesign.slump ?? null

    // 含气量
    values.airContent = mixDesign.airContent ?? null

    // 水泥用量 - 可能来自 cementContent 或 materials.cement
    if (mixDesign.cementContent != null) {
      values.cementContent = mixDesign.cementContent
    } else if (mixDesign.materials?.cement != null) {
      const cement = mixDesign.materials.cement
      values.cementContent = typeof cement === 'object' ? (cement.amount || cement.usage || null) : cement
    }

    // 粉煤灰掺量比 - 可能是百分比也可能是比例
    values.flyAshRatio = mixDesign.flyAshRatio ?? mixDesign.flyAshDosage ?? null

    // 矿渣粉掺量比
    values.slagRatio = mixDesign.slagRatio ?? mixDesign.slagDosage ?? null

    // 锂渣掺量比
    values.lithiumSlagRatio = mixDesign.lithiumSlagRatio ?? mixDesign.lithiumSlagDosage ?? null

    // 复合粉掺量比
    values.compositePowderRatio = mixDesign.compositePowderRatio ?? mixDesign.compositePowderDosage ?? null

    // 用水量
    values.waterAmount = mixDesign.waterAmount ?? mixDesign.waterUsage ?? mixDesign.water ?? null

    // 配置强度
    values.strength = mixDesign.strength ?? mixDesign.targetStrength ?? mixDesign.configStrength ?? null

    // 从 materialDetails 中尝试提取更多信息
    if (mixDesign.materialDetails && typeof mixDesign.materialDetails === 'object') {
      // materialDetails 通常包含更详细的材料用量信息
      const details = mixDesign.materialDetails

      // 如果还没取到水泥用量，从 details 中提取
      if (values.cementContent == null) {
        values.cementContent = details.cementAmount ?? details.cement ?? null
      }

      // 用水量
      if (values.waterAmount == null) {
        values.waterAmount = details.waterAmount ?? details.water ?? null
      }
    }

    // 计算水胶比（如果缺失但有用水量和胶材总量）
    if (values.waterBinderRatio == null && values.waterAmount != null && values.cementContent != null) {
      const binderTotal = (values.cementContent || 0)
        + (mixDesign.flyAshAmount || 0)
        + (mixDesign.slagAmount || 0)
        + (mixDesign.lithiumSlagAmount || 0)
        + (mixDesign.compositePowderAmount || 0)
      if (binderTotal > 0) {
        values.waterBinderRatio = values.waterAmount / binderTotal
      }
    }

    return values
  }

  /**
   * 解析数值：条款参数中的值可能是字符串（如 "≤0.50"、"30-40"、"25%"）
   * 提取其中的数值部分
   * @param {string|number} value - 原始参数值
   * @returns {number|null} 解析出的数值，解析失败返回 null
   */
  _parseNumericValue(value) {
    if (value == null) return null
    if (typeof value === 'number') return value

    // 字符串处理
    const str = String(value).trim()

    // 百分比格式："25%"
    const percentMatch = str.match(/^([\d.]+)\s*%$/)
    if (percentMatch) {
      return parseFloat(percentMatch[1])
    }

    // 范围格式："30-40"，取第一个数值
    const rangeMatch = str.match(/^([\d.]+)\s*[-~到至]\s*([\d.]+)$/)
    if (rangeMatch) {
      return parseFloat(rangeMatch[1]) // 返回范围下限
    }

    // 带比较符号的格式："≤0.50"、">=200"、"<0.60"
    const compMatch = str.match(/^[<≥>≤=]+\s*([\d.]+)/)
    if (compMatch) {
      return parseFloat(compMatch[1])
    }

    // 纯数字
    const numMatch = str.match(/^([\d.]+)/)
    if (numMatch) {
      return parseFloat(numMatch[1])
    }

    return null
  }

  /**
   * 检查条款的适用条件是否匹配当前强度等级
   * @param {string} condition - 条款的适用条件文本
   * @param {string} strength - 当前配合比的强度等级，如 "C30"
   * @returns {boolean} 是否适用于当前强度等级
   */
  _matchStrengthCondition(condition, strength) {
    if (!strength) return true
    if (!condition || typeof condition !== 'string') return true

    const cond = condition.trim()
    if (!cond) return true

    // 条件中不涉及强度等级，默认适用
    if (!/[Cc]\d+/.test(cond) && !/强度等级/.test(cond)) {
      return true
    }

    // "适用于不同强度等级" → 枚举而非约束，适用于所有等级
    if (/不同强度等级|各种强度等级|各强度等级/.test(cond)) {
      return true
    }

    // 提取当前强度等级的数字（如 C30 → 30）
    const strengthNum = this._parseStrengthNumber(strength)
    if (strengthNum == null) return true

    // 提取条件中所有的强度等级约束
    const constraints = this._parseStrengthConstraints(cond)
    if (constraints.length === 0) return true

    // 排除型条件："除C15及其以下" → 在排除范围内的不适用
    const hasExclusion = /除|除外/.test(cond)
    if (hasExclusion) {
      const inExclusion = constraints.some(c => this._evalConstraint(c, strengthNum))
      return !inExclusion
    }

    // 正常型：所有约束都必须满足（"且"逻辑）
    return constraints.every(c => this._evalConstraint(c, strengthNum))
  }

  /**
   * 从强度等级字符串中提取数字
   * @param {string} strength - 如 "C30" / "30" / "c30"
   * @returns {number|null}
   */
  _parseStrengthNumber(strength) {
    if (strength == null) return null
    const match = String(strength).match(/[Cc]?\s*(\d+)/)
    return match ? parseInt(match[1]) : null
  }

  /**
   * 解析条件文本中的所有强度等级约束
   * @param {string} cond - 条件文本
   * @returns {Array<{operator: string, value: number}>}
   */
  _parseStrengthConstraints(cond) {
    const constraints = []

    // 模式1: (不大于|不小于|不低于|不高于|大于|小于|等于|≥|≤|>|<|=)\s*C数字
    const pattern1 = /(不大于|不小于|不低于|不高于|大于|小于|等于|[≥≤><=])\s*C(\d+)/g
    let match
    while ((match = pattern1.exec(cond)) !== null) {
      constraints.push({
        operator: this._normalizeOp(match[1]),
        value: parseInt(match[2])
      })
    }

    // 模式2: C数字 + (及其)? + (及以上|以上|及以下|以下)
    const pattern2 = /C(\d+)\s*(及其)?\s*(及以上|以上|及以下|以下)/g
    while ((match = pattern2.exec(cond)) !== null) {
      const val = parseInt(match[1])
      const hasJiQi = !!match[2]  // "及其" 存在表示包含边界值
      const suffix = match[3]
      let operator
      if (suffix === '及以上') operator = '>='
      else if (suffix === '以上') operator = hasJiQi ? '>=' : '>'
      else if (suffix === '及以下') operator = '<='
      else if (suffix === '以下') operator = hasJiQi ? '<=' : '<'
      constraints.push({ operator, value: val })
    }

    // 模式3: C数字~C数字 范围
    const pattern3 = /C(\d+)\s*[~～]\s*C(\d+)/g
    while ((match = pattern3.exec(cond)) !== null) {
      const v1 = parseInt(match[1])
      const v2 = parseInt(match[2])
      constraints.push({ operator: '>=', value: Math.min(v1, v2) })
      constraints.push({ operator: '<=', value: Math.max(v1, v2) })
    }

    return constraints
  }

  /**
   * 将中文比较词转换为标准运算符
   */
  _normalizeOp(operator) {
    const map = {
      '不大于': '<=', '不小于': '>=', '不低于': '>=', '不高于': '<=',
      '大于': '>', '小于': '<', '等于': '==',
      '≥': '>=', '≤': '<=', '>': '>', '<': '<', '=': '=='
    }
    return map[operator] || operator
  }

  /**
   * 评估单个约束：当前强度等级数值是否满足约束
   */
  _evalConstraint(constraint, strengthNum) {
    const { operator, value } = constraint
    switch (operator) {
      case '>=': return strengthNum >= value
      case '>':  return strengthNum > value
      case '<=': return strengthNum <= value
      case '<':  return strengthNum < value
      case '==': return strengthNum === value
      default:   return true
    }
  }

  /**
   * 合并向量检索结果和规则匹配结果，去重
   * 规则匹配优先：同一条款如果规则匹配和向量检索都命中，保留规则匹配结果
   * @param {Array} vectorResults - 向量检索结果
   * @param {Array} ruleResults - 规则匹配结果
   * @returns {Array} 合并去重后的结果列表
   */
  _mergeResults(vectorResults, ruleResults) {
    const merged = []
    const reviewableVectorResults = this._filterReviewableClauses(vectorResults)

    // 先加入规则匹配结果
    const ruleClauseKeys = new Set()
    for (const rule of ruleResults) {
      const key = `${rule.standardId || rule.standardName}__${rule.clause}__${rule.checkType}`
      ruleClauseKeys.add(key)
      merged.push({ ...rule, source: 'rule' })
    }

    // 再加入向量检索结果（去重）
    for (const vr of reviewableVectorResults) {
      const key = `${vr.standardId || vr.standardName}__${vr.section || ''}__${vr.checkType || ''}`
      if (!ruleClauseKeys.has(key)) {
        merged.push({ ...vr, source: 'vector' })
      }
    }

    return merged
  }

  _filterReviewableClauses(clauses = []) {
    return (clauses || [])
      .map(clause => StandardClauseNormalizer.normalizeClause(clause))
      .filter(clause => ComplianceRuleEngine.isReviewableClause(clause))
  }

  /**
   * 调用 DeepSeek 生成审查报告
   * 直接调用 DeepSeek API，不经过 chat() 方法，避免注入不需要的 system prompt
   * @param {object} mixDesign - 配合比参数
   * @param {Array} ruleResults - 规则匹配结果
   * @param {Array} relevantClauses - 相关条款（合并去重后）
   * @returns {Promise<object>} 审查报告
   */
  async _generateReport(mixDesign, ruleResults, relevantClauses, manualReviewItems = [], scopeResult = null, reviewContext = {}) {
    const systemPrompt = `你是一个混凝土规范审查专家。请根据提供的规范条款和配合比数据，生成详细的合规审查报告。

要求：
1. 严格按照JSON格式输出，不要输出任何其他内容
2. issues中的每条问题必须包含所有字段
3. compliantItems中列出满足要求的条款
4. summary用一段话概括审查结论
5. severity级别：error(不合规)、warning(临界)、info(合规)
6. suggestion给出具体的调整建议

**关键原则**：
- 规范条款通常对不同强度等级有不同限值要求。审查时，只使用适用于当前配合比强度等级的条款限值
- 如果某条款的条件明确限定了强度等级范围（如"适用于C30以下"），而当前配合比不在该范围内，则不应使用该条款进行评判
- 不要将一个强度等级的限值套用到另一个强度等级上
- 明确不合规项必须来自结构化规则匹配结果中 severity=error 或 level=明确不合规 的项目
- 如果语义相关条款看起来有风险，但程序没有给出明确违规结论，只能写入 warning 或需人工确认
- 不允许新增没有 originalText、standardName、clause 支撑的明确违规项
	- "语义相关条款"区块中的内容没有经过结构化规则验证，只能用于warning/info级别发现，严禁将其升级为error级别`

    const userMessage = this._buildAuditPrompt(mixDesign, ruleResults, relevantClauses, manualReviewItems, scopeResult, reviewContext)

    // 直接调用 DeepSeek API
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 4096,
        extra_body: {
          thinking: { type: 'enabled' }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._deepSeekService.apiKey}`
        },
        timeout: 120000
      }
    )

    const content = response.data.choices[0].message.content

    // 解析 DeepSeek 返回的 JSON
    let responseText = content

    if (typeof responseText === 'string') {
      // 尝试提取 markdown 代码块中的 JSON
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) {
        responseText = codeBlockMatch[1].trim()
      } else {
        // 提取最外层 {...}
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          responseText = jsonMatch[0]
        }
      }

      try {
        responseText = JSON.parse(responseText)
      } catch (parseError) {
        console.error('[StandardCompliance] DeepSeek响应JSON解析失败:', parseError.message)
        console.error('[StandardCompliance] 原始响应:', content.substring(0, 200))
        // 降级返回
        return this._buildFallbackReport(ruleResults, mixDesign, manualReviewItems, scopeResult, {}, reviewContext)
      }
    }

    // 标准化报告格式
    return this._normalizeReport(responseText, ruleResults, mixDesign)
  }

  /**
   * 将原材料性能参数格式化为审查Prompt中的文本
   * @param {object} materialProperties - 材料性能参数对象
   * @returns {string} 格式化后的材料性能文本
   */
  _buildMaterialPropertiesText(materialProperties) {
    if (!materialProperties) return ''
    const lines = []
    const mp = materialProperties

    if (mp.cement) {
      const c = mp.cement
      const parts = [`- 水泥: ${c.name || '未命名'}`]
      if (c.compressiveStrength28d != null) parts.push(`28d抗压强度${c.compressiveStrength28d}MPa`)
      if (c.flexuralStrength28d != null) parts.push(`28d抗折强度${c.flexuralStrength28d}MPa`)
      if (c.compressiveStrength3d != null) parts.push(`3d抗压强度${c.compressiveStrength3d}MPa`)
      if (c.specificSurfaceArea != null) parts.push(`比表面积${c.specificSurfaceArea}m²/kg`)
      if (c.stability) parts.push(`安定性${c.stability}`)
      if (c.initialSettingTime != null) parts.push(`初凝时间${c.initialSettingTime}min`)
      if (c.finalSettingTime != null) parts.push(`终凝时间${c.finalSettingTime}min`)
      if (c.fineness != null) parts.push(`细度${c.fineness}`)
      if (c.density != null) parts.push(`密度${c.density}g/cm³`)
      lines.push(parts.join('，'))
    }

    if (mp.sands?.length) {
      for (const sand of mp.sands) {
        const parts = [`- 细骨料: ${sand.name || '未命名'}`]
        if (sand.mudContent != null) parts.push(`含泥量${sand.mudContent}%`)
        if (sand.clayLumpContent != null) parts.push(`泥块含量${sand.clayLumpContent}%`)
        if (sand.mbValue != null) parts.push(`MB值${sand.mbValue}`)
        if (sand.finenessModulus != null) parts.push(`细度模数${sand.finenessModulus}`)
        if (sand.density != null) parts.push(`密度${sand.density}g/cm³`)
        if (sand.waterContent != null) parts.push(`含水率${sand.waterContent}%`)
        lines.push(parts.join('，'))
      }
    }

    if (mp.stones?.length) {
      for (const stone of mp.stones) {
        const parts = [`- 粗骨料: ${stone.name || '未命名'}`]
        if (stone.mudContent != null) parts.push(`含泥量${stone.mudContent}%`)
        if (stone.crushingValue != null) parts.push(`压碎值${stone.crushingValue}%`)
        if (stone.needleFlakeContent != null) parts.push(`针片状含量${stone.needleFlakeContent}%`)
        if (stone.grading) parts.push(`级配${stone.grading}`)
        if (stone.density != null) parts.push(`密度${stone.density}g/cm³`)
        if (stone.waterContent != null) parts.push(`含水率${stone.waterContent}%`)
        lines.push(parts.join('，'))
      }
    }

    if (mp.flyAsh) {
      const f = mp.flyAsh
      const parts = [`- 粉煤灰: ${f.name || '未命名'}`]
      if (f.waterDemandRatio != null) parts.push(`需水量比${f.waterDemandRatio}%`)
      if (f.lossOnIgnition != null) parts.push(`烧失量${f.lossOnIgnition}%`)
      if (f.activityIndex28d != null) parts.push(`28d活性指数${f.activityIndex28d}%`)
      if (f.fineness != null) parts.push(`细度${f.fineness}`)
      if (f.density != null) parts.push(`密度${f.density}g/cm³`)
      lines.push(parts.join('，'))
    }

    if (mp.slag) {
      const s = mp.slag
      const parts = [`- 矿渣粉: ${s.name || '未命名'}`]
      if (s.specificSurfaceArea != null) parts.push(`比表面积${s.specificSurfaceArea}m²/kg`)
      if (s.activityIndex28d != null) parts.push(`28d活性指数${s.activityIndex28d}%`)
      if (s.activityIndex7d != null) parts.push(`7d活性指数${s.activityIndex7d}%`)
      if (s.lossOnIgnition != null) parts.push(`烧失量${s.lossOnIgnition}%`)
      if (s.fluidityRatio != null) parts.push(`流动度比${s.fluidityRatio}%`)
      if (s.density != null) parts.push(`密度${s.density}g/cm³`)
      lines.push(parts.join('，'))
    }

    if (mp.lithiumSlag) {
      const l = mp.lithiumSlag
      const parts = [`- 锂渣: ${l.name || '未命名'}`]
      if (l.activityIndex28d != null) parts.push(`28d活性指数${l.activityIndex28d}%`)
      if (l.lossOnIgnition != null) parts.push(`烧失量${l.lossOnIgnition}%`)
      if (l.waterDemandRatio != null) parts.push(`需水量比${l.waterDemandRatio}%`)
      if (l.density != null) parts.push(`密度${l.density}g/cm³`)
      lines.push(parts.join('，'))
    }

    if (mp.compositePowder) {
      const cp = mp.compositePowder
      const parts = [`- 复合粉: ${cp.name || '未命名'}`]
      if (cp.activityIndex28d != null) parts.push(`28d活性指数${cp.activityIndex28d}%`)
      if (cp.lossOnIgnition != null) parts.push(`烧失量${cp.lossOnIgnition}%`)
      if (cp.density != null) parts.push(`密度${cp.density}g/cm³`)
      lines.push(parts.join('，'))
    }

    if (mp.superplasticizer) {
      const sp = mp.superplasticizer
      const parts = [`- 减水剂: ${sp.name || '未命名'}`]
      if (sp.waterReducingRate != null) parts.push(`减水率${sp.waterReducingRate}%`)
      if (sp.solidContent != null) parts.push(`固含量${sp.solidContent}%`)
      if (sp.airContent != null) parts.push(`含气量${sp.airContent}%`)
      if (sp.recommendedDosage != null) parts.push(`推荐掺量${sp.recommendedDosage}%`)
      if (sp.density != null) parts.push(`密度${sp.density}g/cm³`)
      lines.push(parts.join('，'))
    }

    return lines.join('\n')
  }

  /**
   * 构建审查 Prompt 给 DeepSeek
   * @param {object} mixDesign - 配合比参数
   * @param {Array} ruleResults - 规则匹配结果
   * @param {Array} relevantClauses - 相关条款
   * @returns {string} 审查 Prompt
   */
  _buildAuditPrompt(mixDesign, ruleResults, relevantClauses, manualReviewItems = [], scopeResult = null, reviewContext = {}) {
    // 配合比参数摘要
    const paramSummary = this._buildQueryText(mixDesign)

    // 规则匹配结果摘要
    const ruleSummary = ruleResults.map(r =>
      `[${r.status.toUpperCase()}|${r.severity || 'info'}] ${r.standardName} ${r.clause} ${r.checkType} - ${r.message} (current=${r.currentValue}, limit=${r.limitValue}, comparison=${r.comparison || ''}) originalText=${r.originalText || ''}`
    ).join('\n')

    // 程序确认的证据（只用规则匹配结果，不用向量候选条文）
    const evidenceSummary = ruleResults.map(r => ({
      clause: r.clause,
      standardName: r.standardName,
      checkType: r.checkType,
      currentValue: r.currentValue,
      limitValue: r.limitValue,
      comparison: r.comparison,
      severity: r.severity,
      originalText: r.originalText
    }))
    // 筛选向量检索独有的条款（排除已被规则引擎覆盖的）
    const ruleResultKeys = new Set(
      ruleResults.map(r => `${r.standardName || ''}__${r.section || r.clause || ''}`)
    )
    const NON_REVIEWABLE_ROLES = ['INFORMATIONAL', 'DEFINITION', 'TEST_METHOD']
    const vectorOnlyClauses = (relevantClauses || [])
      .filter(c => {
        const key = `${c.standardName || ''}__${c.section || c.clause || ''}`
        return !ruleResultKeys.has(key)
      })
      .filter(c => {
        const role = c.role || c.normalizedRole || ''
        return !NON_REVIEWABLE_ROLES.includes(role)
      })
      .slice(0, 15)

    const vectorOnlySummary = vectorOnlyClauses.map(c =>
      `[语义相关] ${c.standardName || ''} ${c.section || c.clause || ''} - ${(c.originalText || c.text || '').substring(0, 120)}`
    ).join('\n')

    const manualReviewSummary = manualReviewItems.map(item =>
      `[需人工确认] ${item.standardName} ${item.clause} - ${item.reason}`
    ).join('\n')

    const assumptionSummary = (reviewContext.assumptions || []).map(item =>
      `[默认假设] ${item.field}=${item.defaultValue} - ${item.reason}`
    ).join('\n')

    // 原材料性能参数摘要
    const materialPropsText = this._buildMaterialPropertiesText(mixDesign.materialProperties)

    return `请对以下混凝土配合比进行规范合规审查：

**重要约束**：本次审查的对象是强度等级为 ${mixDesign.strength || '（未指定）'} 的混凝土配合比。请只使用适用于该强度等级的规范条款进行审查，不要将其他强度等级（如C25、C35等）的限值用于本配合比的评判。

不要根据向量候选条文新增明确不合规项；明确不合规只能来自"结构化规则匹配结果"。

## 配合比参数
${paramSummary}
${mixDesign.strength ? `强度等级: ${mixDesign.strength}` : ''}
${mixDesign.environment ? `环境条件: ${mixDesign.environment}` : ''}

${materialPropsText ? `## 原材料性能参数\n${materialPropsText}\n` : ''}

## 本次审查范围
${scopeResult ? JSON.stringify(scopeResult.matchedStandards || scopeResult.standards || [], null, 2) : '全部规范'}

## 默认假设
${reviewContext.assumptionNotice || '无'}
${assumptionSummary || ''}

## 程序确认的证据
${JSON.stringify(evidenceSummary, null, 2)}

## 结构化规则匹配结果
${ruleSummary || '（无直接规则匹配结果）'}

## 语义相关条款（仅供参考，不可升级为明确违规）
以下条款由向量语义检索匹配但未经结构化规则验证，只能用于生成warning/info级别发现，严禁将其升级为error级别。
${vectorOnlySummary || '无'}

## 需人工确认项
${manualReviewSummary || '无'}

请输出以下JSON格式的审查报告：
{
  "complianceStatus": "compliant|non_compliant|conditional",
  "issues": [
    {
      "clause": "条款编号",
      "standardName": "规范名称",
      "checkType": "校验类型",
      "severity": "error|warning|info",
      "message": "问题描述",
      "currentValue": "当前值",
      "limitValue": "限值",
      "originalText": "规范原文",
      "suggestion": "调整建议"
    }
  ],
  "compliantItems": [
    {
      "clause": "条款编号",
      "message": "合规说明"
    }
  ],
  "summary": "审查结论摘要"
}`
  }

  /**
   * 标准化报告格式，确保输出结构一致
   * @param {object} rawReport - DeepSeek返回的原始报告
   * @param {Array} ruleResults - 规则匹配结果
   * @param {object} mixDesign - 配合比参数
   * @returns {object} 标准化审查报告
   */
  _normalizeReport(rawReport, ruleResults, mixDesign) {
    // 确保 complianceStatus 在合法范围内
    const validStatuses = ['compliant', 'non_compliant', 'conditional']
    let status = rawReport.complianceStatus || 'conditional'
    if (!validStatuses.includes(status)) {
      status = 'conditional'
    }

    // 如果有 error 级别的 issue，状态应为 non_compliant
    const issues = Array.isArray(rawReport.issues) ? rawReport.issues : []
    const hasError = issues.some(i => i.severity === 'error')
    if (hasError && status === 'compliant') {
      status = 'non_compliant'
    }

    return {
      complianceStatus: status,
      issues: issues.map(issue => ({
        clause: issue.clause || '',
        standardName: issue.standardName || '',
        checkType: issue.checkType || '',
        severity: issue.severity || 'warning',
        message: issue.message || '',
        currentValue: issue.currentValue ?? null,
        limitValue: issue.limitValue ?? null,
        suggestion: issue.suggestion || ''
      })),
      compliantItems: Array.isArray(rawReport.compliantItems)
        ? rawReport.compliantItems.map(item => ({
            clause: item.clause || '',
            message: item.message || ''
          }))
        : [],
      summary: rawReport.summary || ''
    }
  }

  /**
   * 降级报告生成：DeepSeek 调用失败时，基于规则匹配结果构建报告
   * @param {Array} ruleResults - 规则匹配结果
   * @param {object} mixDesign - 配合比参数
   * @returns {object} 降级审查报告
   */
  _buildFallbackReport(ruleResults, mixDesign, manualReviewItems = [], scopeResult = null, filteredClauseCounts = {}, reviewContext = {}) {
    // 分类规则匹配结果
    const nonCompliant = ruleResults.filter(r => r.status === 'non_compliant')
    const marginal = ruleResults.filter(r => r.status === 'marginal')
    const compliant = ruleResults.filter(r => r.status === 'compliant')

    // 判定整体合规状态
    let complianceStatus = 'compliant'
    if (nonCompliant.length > 0) {
      complianceStatus = 'non_compliant'
    } else if (marginal.length > 0 || manualReviewItems.length > 0) {
      complianceStatus = 'conditional'
    }

    // 构建 issues
    const issues = [
      ...nonCompliant.map(r => ({
        clause: r.clause,
        standardName: r.standardName,
        checkType: r.checkType,
        severity: 'error',
        message: r.message,
        currentValue: r.currentValue,
        limitValue: r.limitValue,
        suggestion: `建议将当前值调整至规范限值 ${r.limitValue} 以内`
      })),
      ...marginal.map(r => ({
        clause: r.clause,
        standardName: r.standardName,
        checkType: r.checkType,
        severity: 'warning',
        message: r.message,
        currentValue: r.currentValue,
        limitValue: r.limitValue,
        suggestion: `当前值接近规范限值 ${r.limitValue}，建议适当调整以留出安全余量`
      }))
    ]

    // 构建 compliantItems
    const compliantItems = compliant.map(r => ({
      clause: r.clause,
      message: r.status === 'compliant'
        ? `${r.standardName} ${r.clause}: 满足规范要求`
        : ''
    })).filter(item => item.message)

    // 生成摘要
    const summaryParts = []
    summaryParts.push(`共检查 ${ruleResults.length} 项规范条款。`)
    if (nonCompliant.length > 0) {
      summaryParts.push(`其中 ${nonCompliant.length} 项不合规（水胶比、掺量等关键指标超出限值）。`)
    }
    if (marginal.length > 0) {
      summaryParts.push(`${marginal.length} 项处于临界状态（偏差在5%以内）。`)
    }
    if (compliant.length > 0) {
      summaryParts.push(`${compliant.length} 项满足规范要求。`)
    }

    return {
      complianceStatus,
      scope: this._buildScopeSummary(scopeResult),
      issues,
      compliantItems,
      manualReviewItems,
      filteredClauseCounts,
      assumptions: reviewContext.assumptions || [],
      assumptionNotice: reviewContext.assumptionNotice || '',
      skippedSpecialRules: reviewContext.skippedSpecialRules || [],
      summary: summaryParts.join(''),
      _fallback: true // 标记为降级报告
    }
  }

  /**
   * 构建空报告（没有知识包或没有相关条款时）
   * @param {string} message - 提示信息
   * @returns {object} 空审查报告
   */
  _buildEmptyReport(message, scopeResult = null) {
    return {
      complianceStatus: 'conditional',
      issues: [],
      compliantItems: [],
      manualReviewItems: [],
      scope: this._buildScopeSummary(scopeResult),
      summary: message || '未找到相关规范条款，无法完成审查',
      _empty: true
    }
  }
}

module.exports = StandardComplianceService

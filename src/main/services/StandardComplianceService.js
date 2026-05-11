/**
 * 规范审查核心服务
 * 负责：加载知识包 → 向量检索 + 规则匹配 → 合并去重 → DeepSeek生成审查报告
 */

const axios = require('axios')
const EmbeddingService = require('./EmbeddingService')
// StandardKnowledgeService 是单例导出，直接 require 即可使用
const knowledgeService = require('./StandardKnowledgeService')

// DeepSeek API 地址
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

/**
 * 检查类型 → 配合比参数字段映射
 * 用于结构化规则匹配时，将条款的 checkType 映射到配合比对象的具体字段
 */
const CHECK_TYPE_FIELD_MAP = {
  water_binder_ratio: 'waterBinderRatio',
  min_cement: 'cementContent',
  sand_ratio: 'sandRatio',
  max_flyash: 'flyAshRatio',
  max_slag: 'slagRatio',
  max_slump: 'slump',
  min_slump: 'slump',
  air_content: 'airContent'
}

/**
 * 条款参数限值名称 → 对比函数映射
 * 每个参数名对应一条规则：从配合比参数取当前值，与条款限值做数值比对
 */
const PARAM_RULES = {
  maxWaterBinderRatio: {
    field: 'waterBinderRatio',
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `水胶比 ${current} 超过规范限值 ${limit}`
  },
  minCementContent: {
    field: 'cementContent',
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `水泥用量 ${current} kg/m³ 低于规范最小值 ${limit} kg/m³`
  },
  maxCementContent: {
    field: 'cementContent',
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `水泥用量 ${current} kg/m³ 超过规范最大值 ${limit} kg/m³`
  },
  maxFlyAshRatio: {
    field: 'flyAshRatio',
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `粉煤灰掺量 ${current}% 超过规范限值 ${limit}%`
  },
  maxSlagRatio: {
    field: 'slagRatio',
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `矿渣粉掺量 ${current}% 超过规范限值 ${limit}%`
  },
  minSandRatio: {
    field: 'sandRatio',
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `砂率 ${current}% 低于规范最小值 ${limit}%`
  },
  maxSandRatio: {
    field: 'sandRatio',
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `砂率 ${current}% 超过规范最大值 ${limit}%`
  },
  maxSlump: {
    field: 'slump',
    compare: (current, limit) => current <= limit,
    message: (current, limit) => `坍落度 ${current} mm 超过规范最大值 ${limit} mm`
  },
  minSlump: {
    field: 'slump',
    compare: (current, limit) => current >= limit,
    message: (current, limit) => `坍落度 ${current} mm 低于规范最小值 ${limit} mm`
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
   * @param {string[]|null} standardIds - 要审查的规范ID列表，null表示全部
   * @returns {Promise<object>} 审查报告
   */
  async check(mixDesign, standardIds = null) {
    try {
      // 第一步：加载知识包
      console.log('[StandardCompliance] 正在加载知识包...')
      const allClauses = await this._knowledgeService.loadAllStandards()

      if (!allClauses || allClauses.length === 0) {
        return this._buildEmptyReport('未找到任何规范知识包，请先导入规范PDF')
      }

      // 按 standardIds 过滤
      let clauses = allClauses
      if (standardIds && standardIds.length > 0) {
        clauses = allClauses.filter(c => standardIds.includes(c.standardId))
        if (clauses.length === 0) {
          return this._buildEmptyReport(`未找到指定规范的知识包`)
        }
      }

      // 过滤掉没有 embedding 的条款
      const clausesWithEmbedding = clauses.filter(c => c.embedding && c.embedding.length > 0)
      const clausesWithoutEmbedding = clauses.filter(c => !c.embedding || c.embedding.length === 0)

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
      const allRuleClauses = [...clausesWithEmbedding, ...clausesWithoutEmbedding]
      const ruleResults = this._matchStructuralRules(mixDesign, allRuleClauses)

      // 第六步：合并去重（规则匹配优先）
      const mergedResults = this._mergeResults(vectorResults, ruleResults)

      if (mergedResults.length === 0) {
        return this._buildEmptyReport('未找到与当前配合比相关的规范条款')
      }

      // 第七步：调用 DeepSeek 生成审查报告
      try {
        console.log('[StandardCompliance] 正在调用DeepSeek生成审查报告...')
        const report = await this._generateReport(mixDesign, ruleResults, mergedResults)
        return report
      } catch (aiError) {
        console.error('[StandardCompliance] DeepSeek生成报告失败，降级返回规则匹配结果:', aiError.message)
        // 降级：返回结构化规则匹配结果
        return this._buildFallbackReport(ruleResults, mixDesign)
      }
    } catch (error) {
      console.error('[StandardCompliance] 规范审查失败:', error)
      throw new Error(`规范审查失败: ${error.message}`)
    }
  }

  // ========== 私有方法 ==========

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

    // 环境条件
    if (mixDesign.environment) {
      parts.push(`环境条件${mixDesign.environment}`)
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
   * 根据条款的 checkType 映射到配合比参数，做数值比对
   * @param {object} mixDesign - 配合比参数对象
   * @param {Array} clauses - 条款列表
   * @returns {Array} 规则匹配结果列表
   */
  _matchStructuralRules(mixDesign, clauses) {
    // 从配合比参数中提取比较值
    const paramValues = this._extractParamValues(mixDesign)
    const results = []

    for (const clause of clauses) {
      // 仅对自检类型的条款做匹配
      if (!clause.checkType) continue

      const fieldName = CHECK_TYPE_FIELD_MAP[clause.checkType]
      if (!fieldName) continue

      // 如果配合比中该字段无值，跳过
      const currentValue = paramValues[fieldName]
      if (currentValue == null) continue

      // 遍历条款参数中的限值，做比对
      if (!clause.parameters || !Array.isArray(clause.parameters)) continue

      for (const param of clause.parameters) {
        const rule = PARAM_RULES[param.name]
        if (!rule) continue

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
              ? `${rule.field === 'waterBinderRatio' ? '水胶比' : rule.field === 'sandRatio' ? '砂率' : rule.field} ${currentValue} 接近规范限值 ${limitValue}（偏差在5%以内）`
              : `满足规范要求`)
            : rule.message(currentValue, limitValue),
          severity: isCompliant ? (status === 'marginal' ? 'warning' : 'info') : 'error',
          source: 'rule' // 标记来源：规则匹配
        })
      }
    }

    return results
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
   * 合并向量检索结果和规则匹配结果，去重
   * 规则匹配优先：同一条款如果规则匹配和向量检索都命中，保留规则匹配结果
   * @param {Array} vectorResults - 向量检索结果
   * @param {Array} ruleResults - 规则匹配结果
   * @returns {Array} 合并去重后的结果列表
   */
  _mergeResults(vectorResults, ruleResults) {
    const merged = []

    // 先加入规则匹配结果
    const ruleClauseKeys = new Set()
    for (const rule of ruleResults) {
      const key = `${rule.standardId || rule.standardName}__${rule.clause}__${rule.checkType}`
      ruleClauseKeys.add(key)
      merged.push({ ...rule, source: 'rule' })
    }

    // 再加入向量检索结果（去重）
    for (const vr of vectorResults) {
      const key = `${vr.standardId || vr.standardName}__${vr.section || ''}__${vr.checkType || ''}`
      if (!ruleClauseKeys.has(key)) {
        merged.push({ ...vr, source: 'vector' })
      }
    }

    return merged
  }

  /**
   * 调用 DeepSeek 生成审查报告
   * 直接调用 DeepSeek API，不经过 chat() 方法，避免注入不需要的 system prompt
   * @param {object} mixDesign - 配合比参数
   * @param {Array} ruleResults - 规则匹配结果
   * @param {Array} relevantClauses - 相关条款（合并去重后）
   * @returns {Promise<object>} 审查报告
   */
  async _generateReport(mixDesign, ruleResults, relevantClauses) {
    const systemPrompt = `你是一个混凝土规范审查专家。请根据提供的规范条款和配合比数据，生成详细的合规审查报告。

要求：
1. 严格按照JSON格式输出，不要输出任何其他内容
2. issues中的每条问题必须包含所有字段
3. compliantItems中列出满足要求的条款
4. summary用一段话概括审查结论
5. severity级别：error(不合规)、warning(临界)、info(合规)
6. suggestion给出具体的调整建议`

    const userMessage = this._buildAuditPrompt(mixDesign, ruleResults, relevantClauses)

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
        return this._buildFallbackReport(ruleResults, mixDesign)
      }
    }

    // 标准化报告格式
    return this._normalizeReport(responseText, ruleResults, mixDesign)
  }

  /**
   * 构建审查 Prompt 给 DeepSeek
   * @param {object} mixDesign - 配合比参数
   * @param {Array} ruleResults - 规则匹配结果
   * @param {Array} relevantClauses - 相关条款
   * @returns {string} 审查 Prompt
   */
  _buildAuditPrompt(mixDesign, ruleResults, relevantClauses) {
    // 配合比参数摘要
    const paramSummary = this._buildQueryText(mixDesign)

    // 规则匹配结果摘要
    const ruleSummary = ruleResults.map(r =>
      `[${r.status.toUpperCase()}] ${r.standardName} ${r.clause} - ${r.message} (当前值: ${r.currentValue}, 限值: ${r.limitValue})`
    ).join('\n')

    // 相关条款摘要（去除 embedding 等大体积字段）
    const clausesSummary = relevantClauses.map(c => ({
      section: c.section || c.clause,
      title: c.title,
      standardName: c.standardName,
      checkType: c.checkType,
      rule: c.rule,
      condition: c.condition,
      parameters: c.parameters,
      similarity: c.similarity ? c.similarity.toFixed(4) : undefined,
      source: c.source
    }))

    return `请对以下混凝土配合比进行规范合规审查：

## 配合比参数
${paramSummary}
${mixDesign.strength ? `强度等级: ${mixDesign.strength}` : ''}
${mixDesign.environment ? `环境条件: ${mixDesign.environment}` : ''}

## 结构化规则匹配结果
${ruleSummary || '（无直接规则匹配结果）'}

## 语义相关条款
${JSON.stringify(clausesSummary, null, 2)}

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
      "currentValue": 当前值,
      "limitValue": 限值,
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
  _buildFallbackReport(ruleResults, mixDesign) {
    // 分类规则匹配结果
    const nonCompliant = ruleResults.filter(r => r.status === 'non_compliant')
    const marginal = ruleResults.filter(r => r.status === 'marginal')
    const compliant = ruleResults.filter(r => r.status === 'compliant')

    // 判定整体合规状态
    let complianceStatus = 'compliant'
    if (nonCompliant.length > 0) {
      complianceStatus = 'non_compliant'
    } else if (marginal.length > 0) {
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
      issues,
      compliantItems,
      summary: summaryParts.join(''),
      _fallback: true // 标记为降级报告
    }
  }

  /**
   * 构建空报告（没有知识包或没有相关条款时）
   * @param {string} message - 提示信息
   * @returns {object} 空审查报告
   */
  _buildEmptyReport(message) {
    return {
      complianceStatus: 'conditional',
      issues: [],
      compliantItems: [],
      summary: message || '未找到相关规范条款，无法完成审查',
      _empty: true
    }
  }
}

module.exports = StandardComplianceService
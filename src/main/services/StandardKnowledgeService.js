/**
 * 规范知识包构建服务
 * 负责：Markdown文件读取 → DeepSeek结构化提取条款 → 本地嵌入模型计算向量 → 保存JSON知识包
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

const DeepSeekService = require('./DeepSeekService')
const SystemService = require('./SystemService')
const EmbeddingService = require('./EmbeddingService')
const StandardScopeService = require('./StandardScopeService')
const StandardClauseNormalizer = require('./StandardClauseNormalizer')

// 知识包存储目录
const STANDARDS_DIR = path.join(app.getPath('userData'), 'standards')

// 每个文本块的最大字符数
const MAX_CHUNK_SIZE = 3000

// DeepSeek 条款提取并发数（过大易触发 429，过小则总耗时长）
const EXTRACT_CONCURRENCY = 4

// DeepSeek 结构化提取的 Prompt
const EXTRACT_SYSTEM_PROMPT = `你是一个混凝土规范条款提取专家。你的任务是从国家标准文本中提取与混凝土配合比设计相关的条款。

请严格按照以下JSON格式输出，不要输出任何其他内容：
{
  "clauses": [
    {
      "section": "条款所在章节编号，如 5.2.1",
      "title": "条款标题，简洁概括",
      "originalText": "条款的原文内容，保持原文不变",
      "condition": "条款适用条件，描述什么情况下该条款生效",
      "rule": "条款规则内容，描述具体的计算规则、限值或要求",
      "checkType": "校验类型：range(范围校验) | formula(公式计算) | lookup(查表取值) | constraint(约束条件)",
      "parameters": [
        {
          "name": "参数名称",
          "symbol": "参数符号",
          "value": "参数值或取值范围",
          "unit": "参数单位"
        }
      ]
    }
  ]
}

## 提取要求：
1. **必须**提取所有与配合比设计直接相关的条款，包括但不限于：
   - 水胶比限值、最小水泥用量、最大/最小胶凝材料用量
   - 砂率范围、用水量、坍落度相关要求
   - 掺合料掺量限值（粉煤灰、矿渣粉、锂渣、复合粉等）
   - 强度等级与配置强度的对应关系
   - 减水剂相关要求
   - 养护条件要求
2. **不提取**与配合比设计无关的通用管理条款
3. condition 和 rule 用简洁的中文描述，便于后续语义匹配
4. 参数提取要完整，包括所有涉及的计算参数
5. originalText 必须保持原文，不要改写`

/**
 * 确保知识包存储目录存在
 */
const ensureStandardsDir = () => {
  if (!fs.existsSync(STANDARDS_DIR)) {
    fs.mkdirSync(STANDARDS_DIR, { recursive: true })
  }
}

const normalizeAliases = (aliases) => (
  StandardScopeService.normalizeStringArray(aliases)
)

const buildScopeKeywords = (name, category, aliases) => {
  const keywords = new Set(StandardScopeService.normalizeStringArray([
    category,
    ...normalizeAliases(aliases)
  ]))
  const standardName = String(name || '')
  const nameKeywords = ['公路', '桥涵', '桥梁', '路面', '铁路', '水工', '水利', '建筑', '普通混凝土', '大体积']

  for (const keyword of nameKeywords) {
    if (standardName.includes(keyword)) {
      keywords.add(keyword)
    }
  }

  return [...keywords]
}

const getPackageCategory = (pkg) => (
  pkg.category || StandardScopeService.inferCategory(pkg.name)
)

const getPackageAliases = (pkg) => (
  normalizeAliases(pkg.aliases)
)

const getPackageScopeKeywords = (pkg, category, aliases) => {
  const storedKeywords = StandardScopeService.normalizeStringArray(pkg.scopeKeywords)
  return storedKeywords.length > 0
    ? storedKeywords
    : buildScopeKeywords(pkg.name, category, aliases)
}

const getPackageQuality = (pkg) => (
  pkg.quality || StandardClauseNormalizer.buildQualitySummary(pkg.clauses || [])
)

/**
 * 计算文件的 MD5 校验码
 * @param {string} filePath - 文件路径
 * @returns {string} MD5 十六进制字符串
 */
const computeFileMD5 = (filePath) => {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(buffer).digest('hex')
}

/**
 * 读取本地 Markdown 文件（UTF-8）
 * @param {string} markdownPath - 文件路径
 * @param {Function} [reportProgress] - (stage, message, percent) => void
 * @returns {Promise<string>}
 */
const readMarkdownFile = async (markdownPath, reportProgress) => {
  if (reportProgress) {
    reportProgress('chunk', '正在读取Markdown文件...', 5)
  }
  return fs.promises.readFile(markdownPath, 'utf-8')
}

/**
 * 将文本按章节标题分块
 * 匹配 "第X章" 和 "X.X" 格式的章节标题
 * 超出 MAX_CHUNK_SIZE 的块会按句子进一步拆分
 * @param {string} text - 完整文本
 * @returns {Array<{section: string, content: string}>} 分块结果
 */
const splitTextBySections = (text) => {
  const chunks = []

  // 按照章节标题拆分
  // 匹配模式：行首的 "第X章" 或 "X.X" 或 "X.X.X" 格式的标题行
  const sectionPattern = /^(第[一二三四五六七八九十百千]+章|第\d+章|\d+\.\d+(?:\.\d+)?(?:\s+.+)?)/gm

  const lines = text.split('\n')
  let currentSection = '前言'
  let currentContent = []
  const sectionMap = new Map() // 用于合并同一章节的内容

  for (const line of lines) {
    const trimmedLine = line.trim()
    // 检测是否是章节标题行
    const sectionMatch = trimmedLine.match(/^(第[一二三四五六七八九十百千]+章|第\d+章)\s*/)
    const subSectionMatch = trimmedLine.match(/^(\d+\.\d+(?:\.\d+)?)\s*/)

    if (sectionMatch) {
      // 保存前一段内容
      if (currentContent.length > 0) {
        const content = currentContent.join('\n').trim()
        if (content) {
          if (!sectionMap.has(currentSection)) {
            sectionMap.set(currentSection, [])
          }
          sectionMap.get(currentSection).push(content)
        }
      }
      currentSection = sectionMatch[1]
      currentContent = [trimmedLine]
    } else if (subSectionMatch) {
      // 子章节标题，保存前一段并开始新段落
      if (currentContent.length > 0) {
        const content = currentContent.join('\n').trim()
        if (content) {
          if (!sectionMap.has(currentSection)) {
            sectionMap.set(currentSection, [])
          }
          sectionMap.get(currentSection).push(content)
        }
      }
      currentSection = subSectionMatch[1]
      currentContent = [trimmedLine]
    } else {
      currentContent.push(line)
    }
  }

  // 保存最后一段
  if (currentContent.length > 0) {
    const content = currentContent.join('\n').trim()
    if (content) {
      if (!sectionMap.has(currentSection)) {
        sectionMap.set(currentSection, [])
      }
      sectionMap.get(currentSection).push(content)
    }
  }

  // 合并同一章节的内容，并拆分超长块
  for (const [section, contents] of sectionMap) {
    const fullContent = contents.join('\n')
    if (fullContent.length <= MAX_CHUNK_SIZE) {
      chunks.push({ section, content: fullContent })
    } else {
      // 超出限制，按句子拆分
      const subChunks = splitLongText(fullContent, MAX_CHUNK_SIZE)
      for (let i = 0; i < subChunks.length; i++) {
        chunks.push({
          section: subChunks.length > 1 ? `${section}(${i + 1}/${subChunks.length})` : section,
          content: subChunks[i]
        })
      }
    }
  }

  return chunks
}

/**
 * 将超长文本按句子拆分成不超过 maxLen 的子块
 * @param {string} text - 超长文本
 * @param {number} maxLen - 每个子块的最大字符数
 * @returns {string[]} 拆分后的子块列表
 */
const splitLongText = (text, maxLen) => {
  // 中文句子结束标记
  const sentenceEnders = /[。！？；\n]/
  const chunks = []
  let current = ''

  // 先尝试按句子拆分
  const sentences = text.split(sentenceEnders)
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue

    if ((current + trimmed).length <= maxLen) {
      current += (current ? '。' : '') + trimmed
    } else {
      if (current) {
        chunks.push(current)
      }
      // 如果单个句子超过 maxLen，强制按字符拆分
      if (trimmed.length > maxLen) {
        for (let i = 0; i < trimmed.length; i += maxLen) {
          const slice = trimmed.slice(i, i + maxLen)
          if (slice.length > 0) {
            chunks.push(slice)
          }
        }
        current = ''
      } else {
        current = trimmed
      }
    }
  }

  if (current) {
    chunks.push(current)
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)]
}

/**
 * 获取 DeepSeek 服务实例
 * @returns {Promise<DeepSeekService|null>}
 */
const getDeepSeekService = async () => {
  try {
    const apiKeyResult = await SystemService.getParamByName('deepseekApiKey')
    if (!apiKeyResult || !apiKeyResult.value) {
      throw new Error('DeepSeek API密钥未配置，请在系统设置中配置')
    }
    return new DeepSeekService(apiKeyResult.value)
  } catch (error) {
    console.error('获取DeepSeek服务失败:', error)
    throw error
  }
}

/**
 * 调用 DeepSeek 从文本块中提取结构化条款
 * @param {import('./DeepSeekService')} service - 已初始化的 DeepSeek 服务（避免每块重复读密钥）
 * @param {string} textContent - 文本块内容
 * @param {string} section - 章节标识
 * @returns {Promise<Array>} 提取的条款列表（不含 id，由上层按顺序编号）
 */
const extractClausesFromChunk = async (service, textContent, section) => {
  const userPrompt = `请从以下混凝土规范文本中提取与配合比设计相关的结构化条款。

文本内容：
${textContent}

请严格按照JSON格式输出，每条条款必须包含 section, title, originalText, condition, rule, checkType, parameters 字段。`

  try {
    const result = await service.chat(userPrompt, null, {
        rawMode: true,
        systemPrompt: EXTRACT_SYSTEM_PROMPT
      })

    // 解析 DeepSeek 返回的 JSON
    let responseText = result.reply || result

    // 如果是字符串，尝试提取 JSON
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
        console.error(`章节 ${section} 的DeepSeek响应JSON解析失败:`, parseError.message)
        console.error('原始响应:', responseText.substring(0, 200))
        return []
      }
    }

    const clauses = responseText.clauses || responseText

    if (!Array.isArray(clauses)) {
      console.warn(`章节 ${section} 提取结果不是数组，跳过`)
      return []
    }

    // 为每条条款分配章节等字段（id 由 buildFromPdf 合并后统一分配）
    return clauses.map(clause => ({
      section: clause.section || section,
      title: clause.title || '',
      originalText: clause.originalText || '',
      condition: clause.condition || '',
      rule: clause.rule || '',
      checkType: clause.checkType || 'constraint',
      parameters: clause.parameters || []
    }))
  } catch (error) {
    console.error(`章节 ${section} 条款提取失败:`, error)
    throw new Error(`DeepSeek条款提取失败: ${error.message}`)
  }
}

class StandardKnowledgeService {
  /**
   * 主入口：从 Markdown 构建知识包
   * 流程：解析 → 分块 → 提取 → 向量化 → 保存
   * @param {string} filePath - Markdown文件路径
   * @param {Object} options - 选项
   * @param {string} options.name - 规范名称（如 "JGJ 55-2011"）
   * @param {string} options.version - 规范版本（如 "2011"）
   * @param {Function} options.onProgress - 进度回调 (stage, message, percent)
   * @returns {Promise<Object>} 构建结果
   */
  async buildFromPdf(filePath, options = {}) {
    const { name = path.basename(filePath, '.md'), version = '', category, aliases, onProgress } = options
    const normalizedAliases = normalizeAliases(aliases)
    const inferredCategory = category || StandardScopeService.inferCategory(name)
    const scopeKeywords = buildScopeKeywords(name, inferredCategory, normalizedAliases)

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`)
    }

    const reportProgress = (stage, message, percent) => {
      console.log(`[StandardKnowledge] ${stage}: ${message} (${percent}%)`)
      if (onProgress) {
        onProgress(stage, message, percent)
      }
    }

    try {
      // 第一步：读取 Markdown 文件
      const fullText = await readMarkdownFile(filePath, reportProgress)
      if (!fullText || fullText.trim().length === 0) {
        throw new Error('文件内容为空，请确认文件有效')
      }

      // 计算 MD5 校验码
      const md5 = computeFileMD5(filePath)
      reportProgress('chunk', `文件读取完成，共 ${fullText.length} 字符`, 12)

      // 第二步：文本分块
      reportProgress('chunk', '正在对文本进行分块...', 15)
      const chunks = splitTextBySections(fullText)
      reportProgress('chunk', `分块完成，共 ${chunks.length} 个文本块`, 25)

      // 第三步：DeepSeek 结构化提取（单次取服务 + 分批并发，减少总等待时间）
      reportProgress('extract', '正在通过AI提取结构化条款...', 35)
      const deepSeekService = await getDeepSeekService()
      const allClauses = []

      for (let batchStart = 0; batchStart < chunks.length; batchStart += EXTRACT_CONCURRENCY) {
        const batchEnd = Math.min(batchStart + EXTRACT_CONCURRENCY, chunks.length)
        reportProgress(
          'extract',
          `正在提取第 ${batchStart + 1}–${batchEnd}/${chunks.length} 块（每批最多 ${EXTRACT_CONCURRENCY} 路并行）...`,
          35 + Math.floor((batchStart / chunks.length) * 40)
        )

        const batch = chunks.slice(batchStart, batchEnd)
        const batchResults = await Promise.all(
          batch.map(async (chunk, j) => {
            const globalIndex = batchStart + j + 1
            try {
              return await extractClausesFromChunk(deepSeekService, chunk.content, chunk.section)
            } catch (extractError) {
              console.error(`第 ${globalIndex} 块提取失败，跳过:`, extractError.message)
              return []
            }
          })
        )

        for (const clauses of batchResults) {
          allClauses.push(...clauses)
        }
      }

      allClauses.forEach((c, idx) => {
        c.id = idx + 1
      })

      if (allClauses.length === 0) {
        throw new Error('未能从文件中提取到任何配合比相关条款')
      }

      reportProgress('extract', `条款提取完成，共 ${allClauses.length} 条`, 75)

      // 第四步：计算向量嵌入
      reportProgress('embed', '正在计算条款向量...', 80)

      // 分批计算向量（每批最多16条，防止内存溢出）
      const EMBED_BATCH_SIZE = 16
      for (let i = 0; i < allClauses.length; i += EMBED_BATCH_SIZE) {
        const batch = allClauses.slice(i, i + EMBED_BATCH_SIZE)
        const texts = batch.map(c => {
          // 拼接 rule + condition 作为嵌入文本
          const parts = []
          if (c.condition) parts.push(c.condition)
          if (c.rule) parts.push(c.rule)
          return parts.join('，') || c.title || c.originalText.slice(0, 100)
        })

        try {
          const embeddings = await EmbeddingService.embedBatch(texts)
          for (let j = 0; j < batch.length; j++) {
            allClauses[i + j].embedding = embeddings[j]
          }
        } catch (embedError) {
          console.error(`批量嵌入计算失败(第${i}~${i + batch.length}条):`, embedError.message)
          // 向量计算失败不影响知识包保存，仅标记为空
          for (let j = 0; j < batch.length; j++) {
            allClauses[i + j].embedding = null
          }
        }

        const embedPercent = 80 + Math.floor((i / allClauses.length) * 15)
        reportProgress('embed', `已计算 ${Math.min(i + EMBED_BATCH_SIZE, allClauses.length)}/${allClauses.length} 条向量`, embedPercent)
      }

      // 第五步：构建知识包并保存
      reportProgress('save', '正在保存知识包...', 96)

      const standardId = `std_${Date.now()}_${md5.slice(0, 8)}`
      const normalizedClauses = StandardClauseNormalizer.normalizeClauses(allClauses)
      const quality = StandardClauseNormalizer.buildQualitySummary(normalizedClauses)
      const knowledgePackage = {
        id: standardId,
        name,
        version,
        category: inferredCategory,
        aliases: normalizedAliases,
        scopeKeywords,
        quality,
        sourceFile: path.basename(filePath),
        md5,
        createdAt: new Date().toISOString(),
        totalChunks: chunks.length,
        totalClauses: normalizedClauses.length,
        clauses: normalizedClauses,
        metadata: {
          textLength: fullText.length,
          chunkSize: MAX_CHUNK_SIZE
        }
      }

      ensureStandardsDir()
      const outputPath = path.join(STANDARDS_DIR, `${standardId}.json`)
      fs.writeFileSync(outputPath, JSON.stringify(knowledgePackage, null, 2), 'utf-8')

      reportProgress('done', '知识包构建完成', 100)

      return {
        id: standardId,
        name,
        version,
        category: inferredCategory,
        aliases: normalizedAliases,
        scopeKeywords,
        quality,
        totalClauses: normalizedClauses.length,
        totalChunks: chunks.length,
        md5,
        createdAt: knowledgePackage.createdAt
      }
    } catch (error) {
      console.error('构建知识包失败:', error)
      throw new Error(`构建知识包失败: ${error.message}`)
    }
  }

  /**
   * 列出所有规范知识包（不含 embedding）
   * @returns {Promise<Array>} 规范列表
   */
  async listStandards() {
    ensureStandardsDir()
    const files = fs.readdirSync(STANDARDS_DIR).filter(f => f.endsWith('.json'))

    const standards = []
    for (const file of files) {
      try {
        const filePath = path.join(STANDARDS_DIR, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        const pkg = JSON.parse(content)
        const category = getPackageCategory(pkg)
        const aliases = getPackageAliases(pkg)
        const scopeKeywords = getPackageScopeKeywords(pkg, category, aliases)
        const quality = getPackageQuality(pkg)

        // 不返回 embedding，减少数据量
        standards.push({
          id: pkg.id,
          name: pkg.name,
          version: pkg.version,
          category,
          aliases,
          scopeKeywords,
          quality,
          sourceFile: pkg.sourceFile,
          md5: pkg.md5,
          createdAt: pkg.createdAt,
          totalClauses: pkg.totalClauses,
          totalChunks: pkg.totalChunks,
          metadata: pkg.metadata
        })
      } catch (error) {
        console.error(`读取知识包 ${file} 失败:`, error.message)
      }
    }

    return standards
  }

  /**
   * 获取单条规范知识包详情
   * @param {string} standardId - 规范ID
   * @returns {Promise<Object>} 规范详情（含条款，不含 embedding）
   */
  async getStandardDetail(standardId) {
    ensureStandardsDir()
    const filePath = path.join(STANDARDS_DIR, `${standardId}.json`)

    if (!fs.existsSync(filePath)) {
      throw new Error(`知识包不存在: ${standardId}`)
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const pkg = JSON.parse(content)
      const category = getPackageCategory(pkg)
      const aliases = getPackageAliases(pkg)
      const scopeKeywords = getPackageScopeKeywords(pkg, category, aliases)
      const quality = getPackageQuality(pkg)

      // 返回条款但不含 embedding（节省传输量）
      const clausesWithoutEmbedding = pkg.clauses.map(c => {
        const { embedding, ...rest } = c
        return rest
      })

      return {
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        category,
        aliases,
        scopeKeywords,
        quality,
        sourceFile: pkg.sourceFile,
        md5: pkg.md5,
        createdAt: pkg.createdAt,
        totalClauses: pkg.totalClauses,
        totalChunks: pkg.totalChunks,
        metadata: pkg.metadata,
        clauses: clausesWithoutEmbedding
      }
    } catch (error) {
      console.error(`读取知识包 ${standardId} 失败:`, error)
      throw new Error(`读取知识包失败: ${error.message}`)
    }
  }

  /**
   * 删除知识包
   * @param {string} standardId - 规范ID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteStandard(standardId) {
    ensureStandardsDir()
    const filePath = path.join(STANDARDS_DIR, `${standardId}.json`)

    if (!fs.existsSync(filePath)) {
      throw new Error(`知识包不存在: ${standardId}`)
    }

    try {
      fs.unlinkSync(filePath)
      console.log(`知识包 ${standardId} 已删除`)
      return { success: true, id: standardId }
    } catch (error) {
      console.error(`删除知识包 ${standardId} 失败:`, error)
      throw new Error(`删除知识包失败: ${error.message}`)
    }
  }

  /**
   * 加载所有知识包用于审查（返回所有条款含向量）
   * 用于 AI 审查时进行语义匹配
   * @returns {Promise<Array>} 所有条款列表（含 embedding）
   */
  async loadAllStandards() {
    ensureStandardsDir()
    const files = fs.readdirSync(STANDARDS_DIR).filter(f => f.endsWith('.json'))

    const allClauses = []
    for (const file of files) {
      try {
        const filePath = path.join(STANDARDS_DIR, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        const pkg = JSON.parse(content)

        // 为每条条款附加来源信息
        const category = getPackageCategory(pkg)
        const quality = getPackageQuality(pkg)

        for (const clause of pkg.clauses) {
          allClauses.push({
            ...clause,
            standardId: pkg.id,
            standardName: pkg.name,
            standardVersion: pkg.version,
            standardCategory: category,
            standardQuality: quality
          })
        }
      } catch (error) {
        console.error(`加载知识包 ${file} 失败:`, error.message)
      }
    }

    return allClauses
  }

  /**
   * 语义搜索：根据输入文本在所有知识包中查找最相似的条款
   * @param {string} queryText - 查询文本
   * @param {number} topK - 返回最相似的 topK 条条款
   * @param {number} threshold - 相似度阈值（余弦相似度），低于此值的结果不返回
   * @returns {Promise<Array>} 匹配的条款列表，按相似度从高到低排序
   */
  async searchClauses(queryText, topK = 10, threshold = 0.5) {
    // 计算查询文本的向量
    const queryEmbedding = await EmbeddingService.embed(queryText)

    // 加载所有条款（含向量）
    const allClauses = await this.loadAllStandards()

    // 过滤没有向量的条款
    const clausesWithEmbedding = allClauses.filter(c => c.embedding && c.embedding.length > 0)

    // 计算余弦相似度
    const scoredResults = clausesWithEmbedding.map(clause => {
      const similarity = cosineSimilarity(queryEmbedding, clause.embedding)
      return { ...clause, similarity }
    })

    // 按相似度降序排序
    scoredResults.sort((a, b) => b.similarity - a.similarity)

    // 过滤低于阈值的结果
    const filtered = scoredResults.filter(r => r.similarity >= threshold)

    // 返回 topK 条，去除 embedding
    return filtered.slice(0, topK).map(({ embedding, ...rest }) => rest)
  }
}

/**
 * 计算两个向量的余弦相似度
 * @param {number[]} vecA - 向量A
 * @param {number[]} vecB - 向量B
 * @returns {number} 余弦相似度
 */
const cosineSimilarity = (vecA, vecB) => {
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

module.exports = new StandardKnowledgeService()

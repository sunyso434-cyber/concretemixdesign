const matter = require('gray-matter')
const yaml = require('js-yaml')

const KNOWN_CATEGORIES = {
  '回复风格': 'replyStyle',
  '专业偏好': 'professionalPrefs',
  '已忽略的建议类型': 'ignoredSuggestionTypes',
  '工作流程': 'workflow',
  '自定义知识': 'customKnowledge'
}

/**
 * AgentMdParser - 纯函数解析器
 * 输入 agent.md Markdown 字符串，输出结构化对象
 * 整个模块无 IO 副作用，便于单测
 */
class AgentMdParser {
  /**
   * 解析 Markdown 内容为结构化对象
   * @param {string} content - Markdown 内容
   * @returns {Object} 解析结果
   */
  static parse(content) {
    // 1. 剥离 UTF-8 BOM
    if (typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1)
    }

    // 2. 空内容直接返回默认结构
    if (!content || !content.trim()) {
      return {
        version: 1,
        replyStyle: {},
        professionalPrefs: { materials: [], method: null },
        ignoredSuggestionTypes: [],
        unknownV1Keys: [],
        workflow: [],
        customKnowledge: [],
        unknownSections: {}
      }
    }

    // 3. 解析 frontmatter
    const { data, content: body } = matter(content)
    const version = data.version || 1

    // 4. 初始化结果
    const result = {
      version,
      replyStyle: {},
      professionalPrefs: { materials: [], method: null },
      ignoredSuggestionTypes: [],
      unknownV1Keys: [],
      workflow: [],
      customKnowledge: [],
      unknownSections: {}
    }

    // 5. 按 ## 标题分段
    const sections = this._splitSections(body)
    for (const [title, sectionBody] of sections) {
      const trimmedTitle = title.trim()
      const categoryKey = KNOWN_CATEGORIES[trimmedTitle]
      if (!categoryKey) {
        // 未知类别：保留原始段落
        result.unknownSections[trimmedTitle] = sectionBody.trim()
        continue
      }

      if (categoryKey === 'workflow') {
        // 工作流程用数组
        result.workflow = this._parseListItems(sectionBody)
      } else if (categoryKey === 'customKnowledge') {
        // 自定义知识用数组
        result.customKnowledge = this._parseListItems(sectionBody)
      } else if (categoryKey === 'ignoredSuggestionTypes') {
        // 已忽略的建议类型：用列表项解析，过滤掉含冒号的"键值"脏行
        const allItems = this._parseListItems(sectionBody)
        result.ignoredSuggestionTypes = allItems.filter(item => !item.includes('：') && !item.includes(':'))
      } else if (categoryKey === 'professionalPrefs') {
        // 专业偏好：v2 YAML code block 优先，v1 扁平兼容
        if (this._hasStrayFlatLines(sectionBody)) {
          console.warn('agent.md 中 ## 专业偏好 段落存在 code block 外的扁平键，已忽略')
        }
        const parsed = this._parseProfessionalPrefsSection(sectionBody)
        result.professionalPrefs = {
          materials: parsed.materials,
          method: parsed.method
        }
        if (parsed.unknownV1Keys.length > 0) {
          result.unknownV1Keys = parsed.unknownV1Keys
        }
      } else {
        // 回复风格用键值对，键原样保留（中文键透传）
        const kvPairs = this._parseKeyValueLines(sectionBody)
        Object.assign(result[categoryKey], kvPairs)
      }
    }

    return result
  }

  /**
   * 将结构化对象格式化为 Markdown 字符串
   * @param {Object} parsed - parse() 的输出
   * @returns {string} Markdown 内容
   */
  static formatToMarkdown(parsed) {
    const parts = [`---\nversion: ${parsed.version}\n---\n\n# 我的智能助手规则\n`]

    if (parsed.replyStyle && Object.keys(parsed.replyStyle).length > 0) {
      parts.push('\n## 回复风格\n')
      for (const [k, v] of Object.entries(parsed.replyStyle)) {
        parts.push(`- ${k}: ${v}\n`)
      }
    }

    if (parsed.professionalPrefs && Object.keys(parsed.professionalPrefs).length > 0) {
      parts.push('\n## 专业偏好\n\n')
      const mats = (parsed.professionalPrefs && parsed.professionalPrefs.materials) || []
      const method = parsed.professionalPrefs && parsed.professionalPrefs.method
      const yamlObj = { materials: mats }
      if (method) yamlObj.method = method
      parts.push('```yaml\n')
      parts.push(yaml.dump(yamlObj, { lineWidth: -1, noRefs: true, forceQuotes: false }))
      parts.push('```\n')
    }

    if (parsed.ignoredSuggestionTypes && parsed.ignoredSuggestionTypes.length > 0) {
      parts.push('\n## 已忽略的建议类型\n')
      for (const t of parsed.ignoredSuggestionTypes) {
        parts.push(`- ${t}\n`)
      }
    }

    if (parsed.workflow && parsed.workflow.length > 0) {
      parts.push('\n## 工作流程\n')
      parsed.workflow.forEach((item, i) => {
        parts.push(`${i + 1}. ${item}\n`)
      })
    }

    if (parsed.customKnowledge && parsed.customKnowledge.length > 0) {
      parts.push('\n## 自定义知识\n')
      parsed.customKnowledge.forEach(item => {
        parts.push(`- ${item}\n`)
      })
    }

    if (parsed.unknownSections) {
      for (const [title, body] of Object.entries(parsed.unknownSections)) {
        parts.push(`\n## ${title}\n${body}\n`)
      }
    }

    return parts.join('')
  }

  /**
   * 按 ## 标题切分正文
   * @param {string} body - frontmatter 之后的正文
   * @returns {Array<[string, string]>} [标题, 内容]
   */
  static _splitSections(body) {
    const sections = []
    const lines = body.split('\n')
    let currentTitle = null
    let currentBody = []

    for (const line of lines) {
      const match = line.match(/^##\s+(.+)$/)
      if (match) {
        if (currentTitle !== null) {
          sections.push([currentTitle, currentBody.join('\n')])
        }
        currentTitle = match[1]
        currentBody = []
      } else if (currentTitle !== null) {
        currentBody.push(line)
      }
    }
    if (currentTitle !== null) {
      sections.push([currentTitle, currentBody.join('\n')])
    }
    return sections
  }

  /**
   * 解析键值对行（"- key: value"）
   * 错误行静默忽略
   * @param {string} body
   * @returns {Object}
   */
  static _parseKeyValueLines(body) {
    const result = {}
    const lines = body.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('-')) continue
      const kv = trimmed.slice(1).trim().match(/^(.+?)[：:](.+)$/)
      if (kv) {
        result[kv[1].trim()] = kv[2].trim()
      }
      // 错误行静默忽略
    }
    return result
  }

  /**
   * 解析列表项（支持 "- item" 和 "1. item" 两种格式）
   * @param {string} body
   * @returns {string[]}
   */
  static _parseListItems(body) {
    const items = []
    const lines = body.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      const m1 = trimmed.match(/^[-*]\s+(.+)$/)
      const m2 = trimmed.match(/^\d+\.\s+(.+)$/)
      if (m1) items.push(m1[1])
      else if (m2) items.push(m2[1])
    }
    return items
  }

  /**
   * 解析 ## 专业偏好 段落中的 fenced YAML code block
   * 若不含 code block 走 v1 扁平兼容解析
   * @param {string} body
   * @returns {{materials: Array, method: string|null, unknownV1Keys: string[]}}
   */
  static _parseProfessionalPrefsSection(body) {
    const codeBlockMatch = body.match(/```yaml\n([\s\S]*?)\n```/)
    if (codeBlockMatch) {
      // 含 fenced code block：只解析 code block 内的 YAML
      const yamlText = codeBlockMatch[1]
      try {
        const parsed = yaml.load(yamlText) || {}
        return {
          materials: Array.isArray(parsed.materials) ? parsed.materials : [],
          method: parsed.method || null,
          unknownV1Keys: []
        }
      } catch (err) {
        throw new Error('agent.md ## 专业偏好 段 YAML 解析失败: ' + err.message)
      }
    }

    // 不含 code block：v1 扁平兼容
    const flat = this._parseKeyValueLines(body)
    const materials = []
    const unknownV1Keys = []
    const V1_KEY_MAP = {
      '常用水泥': { category: '水泥', dimension: '厂家' },
      '常用粉煤灰': { category: '掺合料', dimension: '种类' },
      '常用矿粉': { category: '掺合料', dimension: '种类' },
      '常用外加剂': { category: '外加剂', dimension: '种类' }
    }
    const V1_DROP_KEYS = new Set(['默认强度'])

    for (const [k, v] of Object.entries(flat)) {
      if (V1_DROP_KEYS.has(k)) continue
      if (V1_KEY_MAP[k]) {
        materials.push({ ...V1_KEY_MAP[k], value: v })
      } else {
        unknownV1Keys.push(k)
      }
    }
    return { materials, method: null, unknownV1Keys }
  }

  /**
   * 检测段落内是否同时存在 fenced code block 外的扁平行（脏数据）
   * @param {string} body
   * @returns {boolean}
   */
  static _hasStrayFlatLines(body) {
    const codeBlockMatch = body.match(/```yaml\n[\s\S]*?\n```/)
    if (!codeBlockMatch) return false
    const codeBlockStr = codeBlockMatch[0]
    const rest = body.replace(codeBlockStr, '')
    // 检查 rest 中是否含 "- key: value" 形态
    return /^\s*-\s*.+[：:].+$/m.test(rest)
  }
}

module.exports = { AgentMdParser }

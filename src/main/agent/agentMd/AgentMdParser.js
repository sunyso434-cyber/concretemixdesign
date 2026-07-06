const matter = require('gray-matter')

/**
 * AgentMdParser v2 — 纯结构化解析器
 * 输入：markdown 字符串
 * 输出：{ version, sections: [{title, subSections: [{title, items, rawText}]}] }
 *
 * 设计原则（v2）：
 * - 不识别 section / subSection 含义
 * - 只识别 ## 一级 + ### 二级 + - 列表项
 * - 其他内容（YAML / KV / 裸文本）作为 rawText 原样保留
 * - formatToMarkdown 几乎无逻辑，按原样输出
 */
class AgentMdParser {
  static parse(content) {
    // 1. 剥离 UTF-8 BOM
    if (typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1)
    }

    // 2. 空内容返回空结构
    if (!content || !content.trim()) {
      return { version: 2, sections: [] }
    }

    // 3. 解析 frontmatter
    const { data, content: body } = matter(content)
    const version = data.version || 2

    // 4. 按 ## 切 sections
    const sections = this._splitSections(body)
    const result = { version, sections: [] }

    for (const [title, sectionBody] of sections) {
      const subSections = this._parseSubSections(sectionBody)
      result.sections.push({ title: title.trim(), subSections })
    }

    return result
  }

  static formatToMarkdown(parsed) {
    const parts = [`---\nversion: ${parsed.version}\n---\n\n`]
    for (const section of parsed.sections) {
      parts.push(`## ${section.title}\n`)
      for (const sub of section.subSections) {
        if (sub.title) {
          parts.push(`### ${sub.title}\n`)
        }
        for (const item of sub.items) {
          parts.push(`- ${item}\n`)
        }
        if (sub.rawText) {
          parts.push(sub.rawText.endsWith('\n') ? sub.rawText : sub.rawText + '\n')
        }
      }
    }
    return parts.join('')
  }

  /**
   * 按 ## 标题切分正文
   * @returns Array<[string, string]>
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
   * 解析一个 section 的 body 为 subSections
   * 每个 ### 起一个新 subSection，其余按 - 列表项 + 裸文本处理
   * fenced code block 整段保留为 rawText（不拆解为列表项）
   */
  static _parseSubSections(body) {
    const lines = body.split('\n')
    const subSections = []
    let currentSub = { title: null, items: [], rawText: '' }
    let currentRawBuffer = []
    let inFence = false // ponytail: 跟踪 fenced code block，整段不解析

    const flushRaw = () => {
      if (currentRawBuffer.length > 0) {
        currentSub.rawText = (currentSub.rawText ? currentSub.rawText + '\n' : '') + currentRawBuffer.join('\n')
        currentRawBuffer = []
      }
    }

    for (const line of lines) {
      // fenced code block 开关（```）
      if (line.trim().startsWith('```')) {
        inFence = !inFence
        currentRawBuffer.push(line)
        continue
      }
      // 在 fenced 内：所有内容都进 rawText，不解析为 items
      if (inFence) {
        currentRawBuffer.push(line)
        continue
      }

      const subMatch = line.match(/^###\s+(.+)$/)
      const itemMatch = line.match(/^\s*-\s+(.+)$/)

      if (subMatch) {
        // 新 subSection
        flushRaw()
        subSections.push(currentSub)
        currentSub = { title: subMatch[1].trim(), items: [], rawText: '' }
      } else if (itemMatch) {
        // 列表项
        flushRaw()
        currentSub.items.push(itemMatch[1].trim())
      } else if (line.trim()) {
        // 裸文本
        currentRawBuffer.push(line)
      }
    }
    flushRaw()
    subSections.push(currentSub)

    // 过滤掉全空的 subSection
    return subSections.filter(s => s.items.length > 0 || s.rawText || s.title)
  }
}

module.exports = { AgentMdParser }

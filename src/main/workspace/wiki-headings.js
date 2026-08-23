// Clean-headings 假标题启发式（从 WikiEngine.js 拆分，行为不变）
// 纯函数组：PDF 页眉/页脚、Excel Sheet 名、合并单元格标题行等"假标题"识别与真标题回退搜索。
// WikiEngine 类内保留同名一行委托方法（computeSections/_extractHeading/_isFakeHeading 等），
// 调用路径与测试（WikiEngine.cleanHeadings.test.js 经实例访问）零改动。

// 假标题黑名单（PDF 页眉/页脚、Excel Sheet 名、合并单元格标题行等）
const FAKE_HEADING_PATTERNS = [
  /^Sheet:\s+/i,                                // XLSX：## Sheet: <name>
  /^_?\(空\s*(sheet|_)?\)?_?$/i,                // XLSX：_(空 sheet)_ / _(空)_ 占位符
  /^--?\s*\d+\s*of\s*\d+\s*--?$/i,              // PDF 页脚：-- 1 of 19 --
  /^Page\s+\d+\s+of\s+\d+$/i,                   // 英文页脚：Page 1 of 19
  /^(Journal|Proceedings|Transactions)\s+of\s+/i, // 期刊/会议名页眉
  /^.*?\d+\s*\(\d{4}\)\s+\d+[-\d]*$/,           // 期刊卷期号：78 (2023) 107738 / Cement and Concrete Composites 133 (2022) 104709
  /^https?:\/\/(doi|www\.)/i,                   // DOI 链接
  /^Contents\s+lists\s+available/i,             // ScienceDirect 标记
  /^Available\s+online/i,                       // "Available online 14 Sep 2023"
  /^Received\s+\d+\s+\w+\s+\d{4}/i,             // "Received 23 May 2023"
  /^\d+\s+(of|for)\s+\d+$/i,                    // 孤立页码 "2 of 19"
  /^E-?mail\s+addresses?:/i,                    // "E-mail addresses: ..."
  /^\*\s*(Corresponding\s+author\.?)/i,         // "* Corresponding author."
  /^Z\.\s+\w+\s+et\s+al\.$/i,                   // 作者引用行：Z. Fang et al.
  /^Z\.\s+\w+\s+et\s+al\.?$/i,                  // Z. Fang et al.（无尾点）
  /^[\s\S]*?[\x00-\x08\x0B-\x1F\x7F]/,         // 含二进制/控制字符（PDF 提取垃圾）
]
// markdown 表格行判定（至少 2 个 | 视为表格行；用于识别合并单元格标题）
const TABLE_HEADING_LINE_RE = /^\s*\|.*\|.*\|/

// 真标题识别（段内搜索假标题回退用）
// 优先级：编号式 > 子编号 > 全大写单词 > Keywords: > markdown ## >
//        TitleCase 短语
const REAL_HEADING_PATTERNS = [
  /^\d+\.\s+[A-Z][a-zA-Z一-龥]/,         // "1. Introduction" / "1. 引言"
  /^\d+\.\d+\.?\s+[A-Z]/,                          // "2.1 Materials" / "2.3.1 Methods"
  /^[A-Z][A-Z\s]{5,}$/,                            // "A B S T R A C T" / "INTRODUCTION"
  /^Keywords:/i,                                   // "Keywords: ..."
  /^#{1,6}\s+\S+/,                                 // markdown ## 形式
  /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,5}$/,          // 短 TitleCase 短语（≤ 6 个词）
]
// 段内搜索真标题的最大行数（防止把正文误判为标题；PDF 页面级段落常 > 100 行）
const MAX_HEADING_SEARCH_LINES = 100

/**
 * 判定 heading 是否为"假标题"（结构性元数据，不应作为 wiki section heading）
 * @param {string} heading - 已提取的 heading 文本（去前后空格，最长 60 字符）
 * @param {string} firstLine - 段落首行原文（用于判断"是否表格行"）
 * @returns {boolean}
 */
function isFakeHeading(heading, firstLine) {
  for (const re of FAKE_HEADING_PATTERNS) {
    if (re.test(heading)) return true
  }
  // 表格首行（至少 2 个 |）一律不当 heading
  if (TABLE_HEADING_LINE_RE.test(firstLine)) return true
  return false
}

/**
 * 判定一行是否"看起来像正文"（过滤掉非标题行）
 * - 超长（> 100 字符）通常是段落
 * - 行尾以句号/问号/感叹号结束（句子结束），且行较长
 * - 含引用标记 [N] 通常是正文
 * - 含公式符号（= + − × ÷）通常是公式
 * - 公式变量短词（Dmax、Dmin、C3S）：≤ 8 字符、首大写后续小写、无空格
 * @param {string} trimmed - 已 trim 的行内容
 * @returns {boolean} true = 像正文，应跳过
 */
function looksLikeBodyText(trimmed) {
  if (trimmed.length > 100) return true
  if (trimmed.length < 3) return true  // 1-2 字符基本都是公式碎片（"Dq"、"Ss"、"q"）
  if (/\[\d+\]|\[\d+[-–,]\s*\d+\]/.test(trimmed)) return true  // 引文标记
  // 行尾以 .?! 结束（句子结束），且行较长 → 句子
  // 注意：不能用 /[.?,;][^.?,;]*$/，会把 "2.2. Mixture proportions..." 误判（中间小数点）
  if (/[.?!]$/.test(trimmed) && trimmed.length > 30) return true
  if (/[=+\-×÷]\s*[A-Za-z0-9]/.test(trimmed) && /\d/.test(trimmed)) return true  // 公式行
  // 公式变量短词：≤ 8 字符、首大写后续小写、无空格（CamelCase 公式变量：Dmax、Dmin、C3S、q1）
  // 真标题 "Acknowledgements"、"References"、"Conclusion" 长度 ≥ 10，会被排除
  if (trimmed.length <= 8 && /^[A-Z][a-z]+(\d|[A-Z]?[a-z]*)$/.test(trimmed) && !/\s/.test(trimmed)) {
    return true
  }
  return false
}

/**
 * 在段内搜索"真标题"（firstLine 是假标题时的回退方案）
 * - 跳过空行、假标题行、明显是"正文"的行（超长 / 含句末标点 / 含公式）
 * - 优先级：编号式（"1. Introduction"、"2.2. Methods"）> markdown ## > 全大写/TitleCase > Keywords:
 *   - 编号式内部：选"编号最深 + 最晚出现"的（"2.2." > "2.1" > "2"；同级取最晚）
 *   - PDF 段内常同时有 "2. Materials" 和 "2.2. Mixture..."，应选更具体的 "2.2."
 * - 最多扫 MAX_HEADING_SEARCH_LINES 行（避免误判正文）
 * @returns {string} 真标题；找不到返回 ''
 */
function findRealHeadingInSegment(lines) {
  const SEARCH_LIMIT = Math.min(lines.length, MAX_HEADING_SEARCH_LINES)
  const isCandidate = (trimmed, raw) => {
    if (!trimmed) return false
    if (isFakeHeading(trimmed.slice(0, 60), raw)) return false
    if (looksLikeBodyText(trimmed)) return false
    return true
  }
  // 第一遍：编号式（"1. Introduction"、"2.1. Materials"）—— 最强信号
  // 策略：扫完整段，选编号最深的；同级则取最晚出现的
  let bestNumbered = { text: '', depth: 0, index: -1 }
  for (let i = 1; i < SEARCH_LIMIT; i++) {
    const raw = lines[i] || ''
    const trimmed = raw.trim()
    if (!isCandidate(trimmed, raw)) continue
    // 提取编号深度："2.1.1" → 3，"2." → 1
    const depthMatch = trimmed.match(/^(\d+(?:\.\d+)*)\.?\s+/)
    if (depthMatch && (REAL_HEADING_PATTERNS[0].test(trimmed) || REAL_HEADING_PATTERNS[1].test(trimmed))) {
      const depth = depthMatch[1].split('.').length
      // 编号更深，或同深但更晚出现
      if (depth > bestNumbered.depth ||
          (depth === bestNumbered.depth && i > bestNumbered.index)) {
        bestNumbered = { text: trimmed, depth, index: i }
      }
    }
  }
  if (bestNumbered.text) return bestNumbered.text.slice(0, 60)
  // 第二遍：markdown ## 标题
  for (let i = 1; i < SEARCH_LIMIT; i++) {
    const raw = lines[i] || ''
    const trimmed = raw.trim()
    if (!isCandidate(trimmed, raw)) continue
    if (REAL_HEADING_PATTERNS[4].test(trimmed)) {
      const mdMatch = trimmed.match(/^#{1,6}\s+(.+)/)
      return (mdMatch ? mdMatch[1].trim() : trimmed).slice(0, 60)
    }
  }
  // 第三遍：全大写 / TitleCase（"A B S T R A C T"、"Acknowledgements"）
  for (let i = 1; i < SEARCH_LIMIT; i++) {
    const raw = lines[i] || ''
    const trimmed = raw.trim()
    if (!isCandidate(trimmed, raw)) continue
    if (REAL_HEADING_PATTERNS[2].test(trimmed) || REAL_HEADING_PATTERNS[5].test(trimmed)) {
      return trimmed.slice(0, 60)
    }
  }
  // 第四遍：Keywords:（最后兜底，论文前端元信息）
  for (let i = 1; i < SEARCH_LIMIT; i++) {
    const raw = lines[i] || ''
    const trimmed = raw.trim()
    if (!isCandidate(trimmed, raw)) continue
    if (REAL_HEADING_PATTERNS[3].test(trimmed)) {
      return trimmed.slice(0, 60)
    }
  }
  return ''
}

/**
 * 从段落提取 heading（第一个标题行，或空字符串）
 * 黑名单过滤：丢弃 PDF 页眉/页脚、Excel Sheet 名、合并单元格标题行等"假标题"。
 * 段内搜索：firstLine 是假标题时，向后扫描寻找真标题（PDF 段落包含页眉+正文，真标题在中部）。
 */
function extractHeading(seg) {
  if (!seg.text) return ''
  const lines = seg.text.split('\n')
  const firstLine = lines[0] || ''
  const headingMatch = firstLine.match(/^#{1,6}\s+(.+)/)
  let heading = ''
  if (headingMatch) {
    heading = headingMatch[1].trim()
  } else {
    // 兜底：没有 markdown 标题时，用段落首行前 60 字符作为 heading
    // PDF 提取的文本通常没有 ## 格式标题，纯按空行切分
    heading = firstLine.trim().slice(0, 60)
  }
  if (heading && isFakeHeading(heading, firstLine)) {
    // 段内搜索真标题（PDF 页面段落常以页眉开头，真标题在中部）
    heading = findRealHeadingInSegment(lines)
  }
  return heading || ''
}

/**
 * 合并空 heading section（清理 PDF 跨页长段、页脚/页眉残留）
 * - 1-2 行的空 section（页脚/页眉残留）→ 直接删除
 * - 多行空 section（跨页正文）→ 合并到上一个非空 section（扩展其 endLine）
 * - 文件开头的空 section（无上一个保留 section）→ 直接删除
 * - 重新分配 id（0, 1, 2...）
 */
function mergeEmptySections(sections) {
  if (!sections || sections.length === 0) return sections
  const result = []
  for (const sec of sections) {
    const isEmpty = !sec.heading
    const isJunk = isEmpty && (sec.endLine - sec.startLine) <= 1
    if (isJunk) {
      // 1-2 行的空 section = 页脚/页眉残留 → 直接删除（不合并）
      continue
    }
    if (isEmpty) {
      // 多行空 section = 跨页正文 → 合并到上一个保留 section
      if (result.length > 0) {
        result[result.length - 1].endLine = sec.endLine
      }
      // 文件开头的空 section → 直接丢弃
      continue
    }
    // 保留 section
    result.push({ ...sec })
  }
  // 重新分配 id
  return result.map((s, i) => ({ ...s, id: i }))
}

/**
 * 预计算 sections 元数据（编排入口，复用注入的分段函数）
 * 强制约束：必须从 _splitIntoSegments 复用 segments，禁止自行重新切分
 * @param {string} content - 正文（不含 frontmatter）
 * @param {(content: string) => Array} splitIntoSegments - WikiEngine 的分段委托
 * @returns {Array<{id, heading, startLine, endLine}>}
 */
function computeSections(content, splitIntoSegments) {
  const segments = splitIntoSegments(content)
  const rawSections = segments.map(seg => ({
    id: seg.id,
    heading: extractHeading(seg),
    startLine: seg.startLine,
    endLine: seg.endLine
  }))
  return mergeEmptySections(rawSections)
}

module.exports = { isFakeHeading, looksLikeBodyText, findRealHeadingInSegment, extractHeading, mergeEmptySections, computeSections }

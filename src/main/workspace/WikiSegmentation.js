const SINGLE_SEGMENT_MAX_SIZE = 20 * 1024
const TABLE_MAX_ROWS = 500
const RELEVANCE_THRESHOLD_HIGH = 0.5
const DEFAULT_CONTEXT_LINES = 5

function parseLineInfo(content) {
  return content.split('\n').map((text, lineNumber) => ({ lineNumber, text }))
}

function isTableLine(text) {
  return /^\|.*\|$/.test(text)
}

function detectTableRegions(lines) {
  const tableLines = new Set()
  let i = 0
  while (i < lines.length) {
    if (isTableLine(lines[i].text)) {
      while (i < lines.length && isTableLine(lines[i].text)) {
        tableLines.add(lines[i].lineNumber)
        i++
      }
    } else {
      i++
    }
  }
  return tableLines
}

function splitByHeadings(lines, tableLines) {
  const headingRe = /^#{1,6} /
  const sections = []
  let currentLines = []
  let currentLevel = 0
  let currentStartLine = lines.length > 0 ? lines[0].lineNumber : 0

  for (const line of lines) {
    if (tableLines.has(line.lineNumber)) {
      currentLines.push(line)
      continue
    }

    if (headingRe.test(line.text)) {
      if (currentLines.length > 0) {
        sections.push({ lines: currentLines, startLine: currentStartLine, level: currentLevel })
      }
      currentLines = [line]
      currentLevel = line.text.match(/^(#{1,6})/)[1].length
      currentStartLine = line.lineNumber
    } else {
      currentLines.push(line)
    }
  }

  if (currentLines.length > 0) {
    sections.push({ lines: currentLines, startLine: currentStartLine, level: currentLevel })
  }
  return sections
}

function splitSectionByBlankLines(lines, _sectionStartLine, level) {
  const segments = []
  let currentLines = []

  for (const line of lines) {
    if (isTableLine(line.text)) {
      currentLines.push(line)
      continue
    }

    if (/^\s*$/.test(line.text)) {
      if (currentLines.length > 0) {
        segments.push({ lines: currentLines, startLine: currentLines[0].lineNumber, level })
        currentLines = []
      }
    } else {
      currentLines.push(line)
    }
  }

  if (currentLines.length > 0) {
    segments.push({ lines: currentLines, startLine: currentLines[0].lineNumber, level })
  }
  return segments
}

function splitLargeSegmentByLines(lines) {
  const chunks = []
  let currentLines = []
  let currentSize = 0

  for (const line of lines) {
    const lineSize = Buffer.byteLength(line.text + '\n', 'utf-8')
    if (currentSize + lineSize > SINGLE_SEGMENT_MAX_SIZE && currentLines.length > 0) {
      chunks.push({ lines: currentLines })
      currentLines = []
      currentSize = 0
    }
    currentLines.push(line)
    currentSize += lineSize
  }

  if (currentLines.length > 0) chunks.push({ lines: currentLines })
  return chunks
}

function splitIntoSegments(content) {
  if (!content || !content.trim()) return []

  const lines = parseLineInfo(content)
  const tableRegions = detectTableRegions(lines)
  const headingSections = splitByHeadings(lines, tableRegions)
  const afterBlankSplit = []
  for (const section of headingSections) {
    afterBlankSplit.push(...splitSectionByBlankLines(section.lines, section.startLine, section.level))
  }

  const headingRe = /^#{1,6} /
  const segments = []
  let segId = 0
  for (const seg of afterBlankSplit) {
    const isTable = seg.lines.length > 0 && isTableLine(seg.lines[0].text)
    const rawText = seg.lines.map(line => line.text).join('\n')
    let effectiveLevel = seg.level

    if (!isTable && seg.lines.length > 0) {
      effectiveLevel = headingRe.test(seg.lines[0].text)
        ? seg.lines[0].text.match(/^(#{1,6})/)[1].length
        : 0
    }

    if (isTable && seg.lines.length > TABLE_MAX_ROWS) {
      const headerLine = seg.lines[0]
      const separatorLine = seg.lines[1]
      const tableHeader = headerLine.text + '\n' + separatorLine.text
      const dataLines = seg.lines.slice(2)
      const chunkSize = TABLE_MAX_ROWS - 2
      for (let i = 0; i < dataLines.length; i += chunkSize) {
        const chunk = dataLines.slice(i, i + chunkSize)
        segments.push({
          id: segId++,
          level: 0,
          text: tableHeader + '\n' + chunk.map(line => line.text).join('\n'),
          startLine: headerLine.lineNumber,
          endLine: chunk[chunk.length - 1].lineNumber,
          isTable: true,
          tableHeader
        })
      }
    } else if (isTable) {
      segments.push({
        id: segId++,
        level: 0,
        text: rawText,
        startLine: seg.lines[0].lineNumber,
        endLine: seg.lines[seg.lines.length - 1].lineNumber,
        isTable: true
      })
    } else if (Buffer.byteLength(rawText, 'utf-8') > SINGLE_SEGMENT_MAX_SIZE) {
      for (const chunk of splitLargeSegmentByLines(seg.lines)) {
        segments.push({
          id: segId++,
          level: effectiveLevel,
          text: chunk.lines.map(line => line.text).join('\n'),
          startLine: chunk.lines[0].lineNumber,
          endLine: chunk.lines[chunk.lines.length - 1].lineNumber
        })
      }
    } else {
      segments.push({
        id: segId++,
        level: effectiveLevel,
        text: rawText,
        startLine: seg.lines[0].lineNumber,
        endLine: seg.lines[seg.lines.length - 1].lineNumber
      })
    }
  }

  return segments
}

function truncateToSize(content, maxBytes) {
  if (Buffer.byteLength(content, 'utf-8') <= maxBytes) return content
  const slice = content.slice(0, Math.floor(maxBytes * 1.3))
  const lastParagraph = slice.lastIndexOf('\n\n')
  const truncationSuffix = '\n\n[... 已截断（原始内容 > 300KB）...]'
  const suffixBytes = Buffer.byteLength(truncationSuffix, 'utf-8')
  let result = lastParagraph > maxBytes * 0.5 ? slice.slice(0, lastParagraph) : slice

  while (Buffer.byteLength(result, 'utf-8') + suffixBytes > maxBytes) {
    const lastNewline = result.lastIndexOf('\n')
    if (lastNewline <= 0) break
    result = result.slice(0, lastNewline)
  }
  return result + truncationSuffix
}

function decideMode(scored, contextLines = DEFAULT_CONTEXT_LINES) {
  if (!scored || scored.length === 0) return []

  const hitRanges = scored
    .filter(segment => segment.score > RELEVANCE_THRESHOLD_HIGH)
    .map(segment => ({
      start: segment.startLine - contextLines,
      end: segment.endLine + contextLines
    }))
    .sort((a, b) => a.start - b.start)

  const mergedRanges = []
  for (const range of hitRanges) {
    const last = mergedRanges[mergedRanges.length - 1]
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end)
    } else {
      mergedRanges.push({ start: range.start, end: range.end })
    }
  }

  return scored.map(segment => {
    const isHit = segment.score > RELEVANCE_THRESHOLD_HIGH
    const inContext = mergedRanges.some(range => (
      segment.endLine >= range.start && segment.startLine <= range.end
    ))
    return { ...segment, mode: isHit || inContext ? 'full' : 'summary', score: segment.score }
  })
}

module.exports = {
  SINGLE_SEGMENT_MAX_SIZE,
  TABLE_MAX_ROWS,
  RELEVANCE_THRESHOLD_HIGH,
  DEFAULT_CONTEXT_LINES,
  splitIntoSegments,
  parseLineInfo,
  detectTableRegions,
  isTableLine,
  splitByHeadings,
  splitSectionByBlankLines,
  splitLargeSegmentByLines,
  truncateToSize,
  decideMode
}

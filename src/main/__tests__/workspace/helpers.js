// src/main/__tests__/workspace/helpers.js
// 测试辅助函数：buildSectionsFromContent + createTestWikiPage
// 目的：让测试不手写 frontmatter 字段和 startLine/endLine 行号，
//      全部通过 helper 自动生成，避免跟 WikiEngine 实际切分逻辑脱节。

const matter = require('gray-matter')
const path = require('path')
const fs = require('fs').promises

/**
 * 从 markdown 内容自动生成 sections（不在测试里手写行号）
 * 调用 WikiEngine._splitIntoSegments，保证和 ingest 一致
 */
function buildSectionsFromContent(engine, content) {
  const segments = engine._splitIntoSegments(content)
  return segments.map(seg => ({
    id: seg.id,
    heading: engine._extractHeading ? engine._extractHeading(seg) : '',
    startLine: seg.startLine,
    endLine: seg.endLine
  }))
}

/**
 * 用 gray-matter 创建测试 wiki 页（不手写 frontmatter）
 */
async function createTestWikiPage(dir, filename, content, extraFm = {}) {
  const md = matter.stringify(content, {
    type: 'wiki-source-page',
    title: filename.replace('.md', ''),
    source: `${filename.replace('.md', '')}.pdf`,
    tags: [],
    ingested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    quality: 'high',
    summary: null,
    keyPoints: [],
    relatedPages: [],
    sections_version: 1,
    sections: [],
    ...extraFm
  })
  const p = path.join(dir, filename)
  await fs.writeFile(p, md.replace(/\r\n/g, '\n'), 'utf-8')
  return p
}

module.exports = { buildSectionsFromContent, createTestWikiPage }

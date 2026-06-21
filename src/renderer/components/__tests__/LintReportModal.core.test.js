/**
 * LintReportModal 纯函数核心测试
 * 覆盖：normalizeLintResponse / summarizeReport / getIssueSections / formatStaleSummary / validateReport
 *
 * 跑法：npx jest src/renderer/components/__tests__/LintReportModal.core.test.js
 */

const {
  normalizeLintResponse,
  summarizeReport,
  getIssueSections,
  formatStaleSummary,
  validateReport,
  ISSUE_CATEGORIES
} = require('../LintReportModal.core')

const sampleReport = {
  missingFrontmatter: [
    { path: 'sources/old.md', missing: ['title', 'quality'] }
  ],
  orphans: [
    { path: 'sources/orphan1.md' },
    { path: 'sources/orphan2.md' }
  ],
  missingCrossRefs: [
    { path: 'sources/a.md', ref: 'sources/ghost.md' }
  ],
  staleSummaries: [
    { path: 'sources/b.md', sourceFile: 'b.xlsx', sourceMtime: 1700000000000, wikiMtime: 1699999900000 }
  ],
  contradictions: [],
  scannedAt: '2026-06-22T08:00:00.000Z'
}

describe('LintReportModal.core', () => {
  describe('ISSUE_CATEGORIES', () => {
    test('共 5 类，按展示顺序排列', () => {
      expect(ISSUE_CATEGORIES.length).toBe(5)
      expect(ISSUE_CATEGORIES.map(c => c.key)).toEqual([
        'orphans',
        'missingFrontmatter',
        'staleSummaries',
        'missingCrossRefs',
        'contradictions'
      ])
    })

    test('每类都有中文 label', () => {
      for (const c of ISSUE_CATEGORIES) {
        expect(typeof c.label).toBe('string')
        expect(c.label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('normalizeLintResponse', () => {
    test('直接 LintReport 对象 → 原样返回', () => {
      const out = normalizeLintResponse(sampleReport)
      expect(out).toBe(sampleReport)
    })

    test('包了一层 { report } → 返回 report', () => {
      const out = normalizeLintResponse({ report: sampleReport })
      expect(out).toBe(sampleReport)
    })

    test('标准 IPC {success:true, ...} → 去掉 success 字段', () => {
      const out = normalizeLintResponse({
        success: true,
        missingFrontmatter: sampleReport.missingFrontmatter,
        orphans: sampleReport.orphans,
        scannedAt: sampleReport.scannedAt
      })
      expect(out.success).toBeUndefined()
      expect(out.orphans).toEqual(sampleReport.orphans)
    })

    test('失败响应 {success:false, error} → 返回 null', () => {
      expect(normalizeLintResponse({ success: false, error: 'NOT_OPEN' })).toBeNull()
    })

    test('空 / 非对象 / 字段全无 → 返回 null', () => {
      expect(normalizeLintResponse(null)).toBeNull()
      expect(normalizeLintResponse(undefined)).toBeNull()
      expect(normalizeLintResponse('str')).toBeNull()
      expect(normalizeLintResponse(123)).toBeNull()
      expect(normalizeLintResponse({})).toBeNull()
    })
  })

  describe('summarizeReport', () => {
    test('空报告 → total=0, level=ok', () => {
      const s = summarizeReport({
        missingFrontmatter: [], orphans: [], missingCrossRefs: [], staleSummaries: [], contradictions: []
      })
      expect(s.total).toBe(0)
      expect(s.level).toBe('ok')
      for (const k of ['orphans', 'missingFrontmatter', 'staleSummaries', 'missingCrossRefs', 'contradictions']) {
        expect(s.byKey[k]).toBe(0)
      }
    })

    test('sampleReport：总数 5（orphan=2 + missingFM=1 + missingXRef=1 + stale=1 + contra=0）', () => {
      const s = summarizeReport(sampleReport)
      expect(s.total).toBe(5)
      expect(s.byKey.orphans).toBe(2)
      expect(s.byKey.missingFrontmatter).toBe(1)
      expect(s.byKey.missingCrossRefs).toBe(1)
      expect(s.byKey.staleSummaries).toBe(1)
      expect(s.byKey.contradictions).toBe(0)
      // 5 项触发 error 等级
      expect(s.level).toBe('error')
    })

    test('1-4 项 → level=warn', () => {
      const s = summarizeReport({
        missingFrontmatter: [{ path: 'x', missing: ['title'] }],
        orphans: [], missingCrossRefs: [], staleSummaries: [], contradictions: []
      })
      expect(s.total).toBe(1)
      expect(s.level).toBe('warn')
    })

    test('null / 字段缺失 → 不抛错，按 0 处理', () => {
      const s = summarizeReport(null)
      expect(s.total).toBe(0)
      expect(s.level).toBe('ok')
    })

    test('非数组字段 → 不抛错，按 0 处理', () => {
      const s = summarizeReport({ orphans: 'oops' })
      expect(s.byKey.orphans).toBe(0)
    })
  })

  describe('getIssueSections', () => {
    test('空报告 → 返回 []', () => {
      expect(getIssueSections({
        missingFrontmatter: [], orphans: [], missingCrossRefs: [], staleSummaries: [], contradictions: []
      })).toEqual([])
    })

    test('sampleReport：返回 4 个 section（contra=0 跳过）', () => {
      const out = getIssueSections(sampleReport)
      expect(out.length).toBe(4)
      expect(out.map(s => s.key)).toEqual([
        'orphans',
        'missingFrontmatter',
        'staleSummaries',
        'missingCrossRefs'
      ])
      expect(out[0].label).toBe('孤儿页（无入链）')
      expect(out[0].items.length).toBe(2)
    })

    test('null / 非对象 → 返回 []', () => {
      expect(getIssueSections(null)).toEqual([])
      expect(getIssueSections('xxx')).toEqual([])
    })
  })

  describe('formatStaleSummary', () => {
    test('秒级差', () => {
      const out = formatStaleSummary({ sourceMtime: 1000 * 31, wikiMtime: 1000 })
      expect(out).toMatch(/秒前/)
    })

    test('分钟级差', () => {
      const out = formatStaleSummary({ sourceMtime: 1000 * 60 * 5 + 1000, wikiMtime: 1000 })
      expect(out).toMatch(/分钟前/)
    })

    test('小时级差', () => {
      const out = formatStaleSummary({ sourceMtime: 1000 * 60 * 60 * 3, wikiMtime: 1000 })
      expect(out).toMatch(/小时前/)
    })

    test('天级差', () => {
      const out = formatStaleSummary({ sourceMtime: 1000 * 60 * 60 * 24 * 2, wikiMtime: 1000 })
      expect(out).toMatch(/天前/)
    })

    test('源文件比 wiki 还旧（diff<0）→ 返回空串', () => {
      expect(formatStaleSummary({ sourceMtime: 1000, wikiMtime: 2000 })).toBe('')
    })

    test('非法输入（null / NaN / 非对象）→ 返回空串', () => {
      expect(formatStaleSummary(null)).toBe('')
      expect(formatStaleSummary({ sourceMtime: 'x', wikiMtime: 1 })).toBe('')
      expect(formatStaleSummary({ sourceMtime: 1 })).toBe('')
    })
  })

  describe('validateReport', () => {
    test('合法报告', () => {
      expect(validateReport(sampleReport)).toEqual({ ok: true })
    })

    test('空对象（5 类字段都缺失 → 当作缺省视为合法）', () => {
      expect(validateReport({})).toEqual({ ok: true })
    })

    test('null / 非对象', () => {
      expect(validateReport(null)).toEqual({ ok: false, error: 'report 必须是对象' })
      expect(validateReport('str')).toEqual({ ok: false, error: 'report 必须是对象' })
    })

    test('某类字段不是数组', () => {
      const bad = { ...sampleReport, orphans: 'oops' }
      const v = validateReport(bad)
      expect(v.ok).toBe(false)
      expect(v.error).toMatch(/orphans 必须是数组/)
    })
  })
})

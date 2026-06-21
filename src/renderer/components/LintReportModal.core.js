/**
 * LintReportModal 纯函数核心
 * 拆出 UI 中可被 Node 测试覆盖的纯逻辑：
 *  - normalizeLintResponse: 兼容 IPC 包装形态（直接 LintReport 或 {report:...} 或 {success,data}）
 *  - summarizeReport:       统计 5 类错误总数 + 等级（ok/warn/error）
 *  - getIssueSections:      拆出可分块展示的 issues 列表（按 missingFrontmatter/orphans/missingCrossRefs/staleSummaries/contradictions）
 *  - formatStaleSummary:    过期摘要项的友好时间描述
 *  - validateReport:        入参 report shape 校验
 *
 * LintReport shape（来自 src/main/workspace/WikiEngine.js#lint）：
 *  {
 *    missingFrontmatter: [{ path, missing: [...] }],
 *    orphans:            [{ path }],
 *    missingCrossRefs:   [{ path, ref }],
 *    staleSummaries:     [{ path, sourceFile, sourceMtime, wikiMtime }],
 *    contradictions:     [],
 *    scannedAt:          ISO string
 *  }
 *
 * 保持纯函数（无 DOM/React 依赖），UI 组件 LintReportModal.jsx 仅做展示。
 */

export const ISSUE_CATEGORIES = [
  { key: 'orphans',            label: '孤儿页（无入链）' },
  { key: 'missingFrontmatter', label: '缺失 frontmatter 必填字段' },
  { key: 'staleSummaries',     label: '过期摘要（源文件已更新）' },
  { key: 'missingCrossRefs',   label: '缺失交叉引用' },
  { key: 'contradictions',     label: '内容冲突（V1.5 预留）' }
]

/**
 * 兼容 IPC 返回的多种形态：
 *  - 直接的 LintReport：{missingFrontmatter,...}
 *  - 包了一层 report：{report: {...}}
 *  - 标准 IPC：{success: true, ...report fields}
 *  - 错误：{success: false, error: '...'} → 返回 null
 *
 * @param {any} raw
 * @returns {object|null}
 */
export function normalizeLintResponse(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.success === false) return null
  if (raw.report && typeof raw.report === 'object') return raw.report
  // 标准 IPC 包装：{success: true, missingFrontmatter, ...}
  if (raw.success === true) {
    const { success: _s, ...rest } = raw
    return rest
  }
  // 直接 LintReport
  if (Array.isArray(raw.missingFrontmatter)) return raw
  return null
}

/**
 * 统计报告 5 类问题总数 + 健康等级
 * @param {object} report
 * @returns {{total:number, byKey:object, level:'ok'|'warn'|'error'}}
 */
export function summarizeReport(report) {
  const byKey = {}
  let total = 0
  for (const cat of ISSUE_CATEGORIES) {
    const arr = (report && report[cat.key]) || []
    const n = Array.isArray(arr) ? arr.length : 0
    byKey[cat.key] = n
    total += n
  }
  let level = 'ok'
  if (total > 0) level = 'warn'
  if (total >= 5) level = 'error'
  return { total, byKey, level }
}

/**
 * 拆出可分块渲染的 sections（过滤掉 0 项的分类；保持 ISSUE_CATEGORIES 顺序）
 * @param {object} report
 * @returns {Array<{key:string, label:string, items:any[]}>}
 */
export function getIssueSections(report) {
  if (!report || typeof report !== 'object') return []
  const out = []
  for (const cat of ISSUE_CATEGORIES) {
    const arr = report[cat.key]
    if (Array.isArray(arr) && arr.length > 0) {
      out.push({ key: cat.key, label: cat.label, items: arr })
    }
  }
  return out
}

/**
 * 过期摘要项的友好时间描述
 * @param {object} item {sourceMtime, wikiMtime} (ms number)
 * @returns {string}
 */
export function formatStaleSummary(item) {
  if (!item || typeof item !== 'object') return ''
  const src = Number(item.sourceMtime)
  const wiki = Number(item.wikiMtime)
  if (!Number.isFinite(src) || !Number.isFinite(wiki)) return ''
  const diffMs = src - wiki
  if (diffMs < 0) return ''
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec} 秒前源文件已更新`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前源文件已更新`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前源文件已更新`
  const day = Math.floor(hr / 24)
  return `${day} 天前源文件已更新`
}

/**
 * 校验 report shape，返回 { ok, error }
 * @param {any} report
 */
export function validateReport(report) {
  if (!report || typeof report !== 'object') {
    return { ok: false, error: 'report 必须是对象' }
  }
  for (const cat of ISSUE_CATEGORIES) {
    const v = report[cat.key]
    if (v != null && !Array.isArray(v)) {
      return { ok: false, error: `report.${cat.key} 必须是数组` }
    }
  }
  return { ok: true }
}

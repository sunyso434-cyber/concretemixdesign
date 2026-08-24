/**
 * v0.9.x 输出优化：从消息 timeline 提取"产出文件"（回合交付物 chips）
 *
 * 数据源：timeline 中 tool 节点（status==='done' 且工具会产出文件）
 * - workspace_writeFile：把 Markdown 报告写入工作区 reports/（result.path）
 * - 后续新增产出类工具（officecli 系列）在此扩展
 *
 * result 形如 { path, size, savedAt }；path 相对/绝对均可，
 * FileMessageCard 用 path 打开与定位。type 从扩展名推断（docx/xlsx/md/pdf…）。
 */

const PRODUCING_TOOLS = new Set(['workspace_writeFile', 'generate_xlsx_report'])

export function extractProducedFiles(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return []
  const seen = new Set()
  const files = []
  for (const item of timeline) {
    if (!item || item.type !== 'tool' || item.status !== 'done') continue
    if (!PRODUCING_TOOLS.has(item.toolName)) continue
    const result = item.result && typeof item.result === 'object' ? item.result : {}
    // 兼容两种返回形态：顶层 path（workspace_writeFile / generate_xlsx_report）
    // 或 data.filePath 包装（officecli 系列未来接入时无需再改这里）
    const inner = result.data && typeof result.data === 'object' ? result.data : {}
    const p = result.path || result.filePath || inner.path || inner.filePath
    if (typeof p !== 'string' || p.length === 0 || seen.has(p)) continue
    seen.add(p)
    const extMatch = p.split('.').pop()
    const ext = extMatch ? extMatch.toLowerCase() : ''
    files.push({
      path: p,
      size: typeof result.size === 'number'
        ? result.size
        : (typeof inner.size === 'number' ? inner.size : undefined),
      type: ext || undefined,
    })
  }
  return files
}

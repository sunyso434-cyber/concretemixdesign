/**
 * FileMessageCard 纯函数核心
 * 拆出 UI 中可被 Node 测试覆盖的纯逻辑：
 *  - basename:  从完整路径提取文件名（兼容 \ 和 /）
 *  - formatSize: 字节 → "12 KB" / "3.4 MB"
 *  - iconForType: 文件类型 → AntD icon name
 *  - buildActions: 3 个按钮的 onClick 处理函数
 *  - validateFile: 入参 file shape 校验
 *
 * 保持纯函数（无 DOM/React 依赖），UI 组件 FileMessageCard.jsx 仅做展示。
 */

export const SUPPORTED_TYPES = new Set(['docx', 'xlsx', 'md', 'pdf'])

/**
 * 从路径提取文件名
 * @param {string} filePath
 * @returns {string}
 */
export function basename(filePath) {
  if (!filePath || typeof filePath !== 'string') return ''
  return filePath.split(/[\\/]/).pop() || ''
}

/**
 * 字节数 → 人类可读字符串（保留 1 位小数）
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 文件类型 → Ant Design icon 名字符串
 * @param {string} type
 * @returns {string}
 */
export function iconForType(type) {
  switch ((type || '').toLowerCase()) {
    case 'docx': return 'FileTextOutlined'
    case 'xlsx': return 'FileExcelOutlined'
    case 'pdf':  return 'FilePdfOutlined'
    case 'md':   return 'FileMarkdownOutlined'
    default:     return 'FileOutlined'
  }
}

/**
 * 构造 3 个按钮的 click handler。
 * 返回的 handler 接收 electronAPI，可独立注入（便于测试）。
 *
 * @returns {{
 *   onOpen: (api: any, filePath: string) => any,
 *   onShowInFolder: (api: any, filePath: string) => any,
 *   onCopyPath: (clipboard: any, filePath: string) => any
 * }}
 */
export function buildActions() {
  return {
    onOpen: (api, filePath) => api?.openFile?.(filePath),
    onShowInFolder: (api, filePath) => api?.showInFolder?.(filePath),
    onCopyPath: (clipboard, filePath) => clipboard?.writeText?.(filePath),
  }
}

/**
 * 校验 file 入参 shape，返回 { ok, error }
 * @param {any} file
 */
export function validateFile(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, error: 'file 必须是对象' }
  }
  if (typeof file.path !== 'string' || !file.path) {
    return { ok: false, error: 'file.path 必填且为字符串' }
  }
  if (file.size != null && (typeof file.size !== 'number' || file.size < 0)) {
    return { ok: false, error: 'file.size 必须是非负数' }
  }
  if (file.type != null && typeof file.type !== 'string') {
    return { ok: false, error: 'file.type 必须是字符串' }
  }
  return { ok: true }
}

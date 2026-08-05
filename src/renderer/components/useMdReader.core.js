// useMdReader 纯逻辑核心（node 可测，仿 FileMessageCard.core 模式）
export const MAX_TABS = 10
export const MIN_WIDTH = 280
export const MAX_WIDTH = 600
export const SAVE_DEBOUNCE_MS = 800
export const EDIT_DISABLE_BYTES = 1 * 1024 * 1024

export function normalizePath(filePath) {
  if (!filePath) return ''
  return filePath.split(/[\\/]/).join('/').toLowerCase()
}

export function basename(filePath) {
  if (!filePath) return ''
  return filePath.split(/[\\/]/).pop() || ''
}

export function clampWidth(width, innerWidth) {
  const max = Math.min(MAX_WIDTH, (innerWidth || 0) * 0.6)
  if (width < MIN_WIDTH) return MIN_WIDTH
  if (width > max) return Math.max(MIN_WIDTH, max)
  return width
}

export function dedupeOpen(state, file) {
  const key = normalizePath(file.path)
  const idx = state.tabs.findIndex(t => t.key === key)
  if (idx >= 0) {
    return { ...state, activeKey: key, isOpen: true }
  }
  if (state.tabs.length >= MAX_TABS) {
    return { ...state, rejected: true }
  }
  return {
    ...state,
    isOpen: true,
    activeKey: key,
    tabs: [...state.tabs, { key, title: basename(file.path), path: file.path, status: 'loading', error: null, mode: 'preview', dirty: false, conflict: null }]
  }
}

export function applyReadSuccess(state, key, { content, body, mtimeMs, size }) {
  return {
    ...state,
    // 读成功后清掉非阻塞提示（"文件已被外部修改 [点击刷新]"不留残留）
    noticeKey: state.noticeKey === key ? undefined : state.noticeKey,
    contents: { ...state.contents, [key]: body },
    drafts: { ...state.drafts, [key]: content },
    lastSeen: { ...state.lastSeen, [key]: { mtimeMs, size } },
    // 读成功后 draft == 磁盘内容，dirty 恒为 false（含 reload 成功：用户已选"载入最新"丢弃修改）
    tabs: state.tabs.map(t => t.key === key ? { ...t, status: 'done', error: null, dirty: false } : t)
  }
}

export function applyReadFailure(state, key, error) {
  return {
    ...state,
    tabs: state.tabs.map(t => t.key === key ? { ...t, status: 'error', error } : t)
  }
}

export function applyFileChanged(state, key, { mtimeMs, size }) {
  const tab = state.tabs.find(t => t.key === key)
  if (!tab) return state
  const last = state.lastSeen[key]
  if (last && last.mtimeMs === mtimeMs && last.size === size) {
    return state // 自身写或重复事件
  }
  if (tab.mode === 'edit') {
    if (tab.dirty) {
      // 有未保存修改 → 冲突提示条
      return {
        ...state,
        tabs: state.tabs.map(t => t.key === key ? { ...t, conflict: 'external-change' } : t)
      }
    }
    // 编辑中无未保存修改 → 非阻塞提示（不自动刷新 draft，防 textarea 光标/选区丢失）
    return { ...state, noticeKey: key }
  }
  // 预览态 → 静默刷新
  return { ...state, reloadKey: key }
}

export function resolveConflict(state, key, choice) {
  const tab = state.tabs.find(t => t.key === key)
  if (!tab) return state
  if (choice === 'reload') {
    // 只置 reloadKey + 清 conflict，不动 drafts（contents[key] 是去 frontmatter 的 body，
    // 写入 drafts 会静默剥掉 YAML frontmatter）。重读成功由 applyReadSuccess 用完整原文覆盖 drafts；
    // 重读失败则 draft 保留用户完整内容，再次保存不丢 frontmatter。dirty 也不动：重读成功前无法判定是否丢弃成功。
    return {
      ...state,
      reloadKey: key,
      tabs: state.tabs.map(t => t.key === key ? { ...t, conflict: null } : t)
    }
  }
  // keep：保留草稿，清冲突；保存失败时上层置 conflict='save-failed'
  return {
    ...state,
    tabs: state.tabs.map(t => t.key === key ? { ...t, conflict: null } : t)
  }
}

export function applyWorkspaceChanged(state, workspaceRoot) {
  // 白名单外 tab 置只读（禁编辑/暂停监视）。实现时按实际白名单判定；此处标记所有非当前 workspace 前缀路径
  return {
    ...state,
    tabs: state.tabs.map(t => ({
      ...t,
      readOnly: !(t.path || '').toLowerCase().startsWith(String(workspaceRoot || '').toLowerCase())
    }))
  }
}

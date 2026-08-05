// useMdReader：MD 阅读器状态管理 hook（UI 封装层，纯逻辑在 useMdReader.core.js）
import { useEffect, useRef, useCallback, useState } from 'react'
import {
  normalizePath, basename, clampWidth, dedupeOpen, applyReadSuccess, applyReadFailure,
  applyFileChanged, resolveConflict as applyResolve, applyWorkspaceChanged,
  SAVE_DEBOUNCE_MS, EDIT_DISABLE_BYTES
} from './useMdReader.core'

const PANEL_WIDTH_KEY = 'md-reader-panel-width'

export function useMdReader() {
  const [state, setState] = useState({
    isOpen: false,
    tabs: [],
    activeKey: null,
    contents: {},
    drafts: {},
    lastSeen: {},
    inflight: new Set()
  })
  const [panelWidth, setPanelWidthState] = useState(() =>
    clampWidth(Number(localStorage.getItem(PANEL_WIDTH_KEY)) || 380, window.innerWidth)
  )
  const saveTimers = useRef({})
  const stateRef = useRef(state)
  stateRef.current = state

  const readFile = useCallback(async (key, path, roots) => {
    const res = await window.electronAPI.md.read(path)
    if (!res) return
    if ('error' in res) {
      const stillOpen = stateRef.current.tabs.some(t => t.key === key)
      if (stillOpen) setState(s => applyReadFailure(s, key, res.error))
    } else {
      const stillOpen = stateRef.current.tabs.some(t => t.key === key)
      if (stillOpen) {
        setState(s => applyReadSuccess(s, key, res))
        setState(s => ({ ...s, inflight: new Set([...s.inflight].filter(k => k !== key)) }))
      }
    }
  }, [])

  const reload = useCallback((key) => {
    const tab = stateRef.current.tabs.find(t => t.key === key)
    if (!tab) return
    readFile(key, tab.path)
  }, [readFile])

  const openFile = useCallback(async (path) => {
    const key = normalizePath(path)
    if (stateRef.current.inflight.has(key)) return
    setState(s => dedupeOpen(s, { path }))
    const next = dedupeOpen(stateRef.current, { path })
    if (next.rejected) return
    setState(s => ({ ...s, inflight: new Set([...s.inflight, key]) }))
    window.electronAPI.md.watch(path)
    await readFile(key, path)
  }, [readFile])

  // 注意：saveDraftNow 在下文定义，但 closeTab 在渲染完成、事件触发时才调用，闭包捕获的引用此时已初始化（合法前向引用）
  const closeTab = useCallback((key) => {
    const tab = stateRef.current.tabs.find(t => t.key === key)
    if (!tab) return
    // dirty 先 flush 保存（fire-and-forget；保存逻辑见 saveDraftNow）
    if (tab.dirty) saveDraftNow(key)
    window.electronAPI.md.unwatch(tab.path)
    setState(s => {
      const idx = s.tabs.findIndex(t => t.key === key)
      const tabs = s.tabs.filter(t => t.key !== key)
      const contents = { ...s.contents }; delete contents[key]
      const drafts = { ...s.drafts }; delete drafts[key]
      const lastSeen = { ...s.lastSeen }; delete lastSeen[key]
      const inflight = new Set([...s.inflight].filter(k => k !== key))
      const activeKey = s.activeKey === key
        ? (tabs[idx] ? tabs[idx].key : tabs[tabs.length - 1]?.key || null)
        : s.activeKey
      return { ...s, tabs, contents, drafts, lastSeen, inflight, activeKey, isOpen: tabs.length > 0 ? s.isOpen : false }
    })
  }, [])

  const selectTab = useCallback((key) => setState(s => ({ ...s, activeKey: key })), [])
  const collapse = useCallback(() => setState(s => ({ ...s, isOpen: false })), [])

  const saveDraftNow = useCallback((key) => {
    const tab = stateRef.current.tabs.find(t => t.key === key)
    const draft = stateRef.current.drafts[key]
    if (!tab || typeof draft !== 'string') return
    window.electronAPI.md.write(tab.path, draft).then(res => {
      if (res && res.ok) {
        // body 由主进程写回后重新解析（去掉 frontmatter），供预览态渲染
        setState(s => ({
          ...applyReadSuccess(s, key, { content: draft, body: res.body || draft, mtimeMs: res.mtimeMs, size: res.size }),
          tabs: s.tabs.map(t => t.key === key ? { ...t, dirty: false } : t)
        }))
      } else {
        setState(s => ({ ...s, tabs: s.tabs.map(t => t.key === key ? { ...t, conflict: 'save-failed' } : t) }))
      }
    })
  }, [])

  const toggleEdit = useCallback((key) => {
    const tab = stateRef.current.tabs.find(t => t.key === key)
    if (!tab || tab.readOnly) return
    if (tab.mode === 'preview') {
      const size = stateRef.current.lastSeen[key]?.size || 0
      if (size > EDIT_DISABLE_BYTES) {
        alert(`文件过大（${(size / 1024 / 1024).toFixed(1)}MB），暂不支持编辑`)
        return
      }
      setState(s => ({ ...s, tabs: s.tabs.map(t => t.key === key ? { ...t, mode: 'edit' } : t) }))
    } else {
      if (tab.dirty) saveDraftNow(key)
      setState(s => ({ ...s, tabs: s.tabs.map(t => t.key === key ? { ...t, mode: 'preview' } : t) }))
    }
  }, [saveDraftNow])

  const setDraft = useCallback((key, text) => {
    setState(s => ({ ...s, drafts: { ...s.drafts, [key]: text }, tabs: s.tabs.map(t => t.key === key ? { ...t, dirty: true } : t) }))
    clearTimeout(saveTimers.current[key])
    saveTimers.current[key] = setTimeout(() => saveDraftNow(key), SAVE_DEBOUNCE_MS)
  }, [saveDraftNow])

  const resolveConflict = useCallback((key, choice) => {
    if (choice === 'retry') { saveDraftNow(key); return }
    if (choice === 'reload') {
      const s = stateRef.current
      const next = applyResolve(s, key, 'reload')
      setState(next)
      if (next.reloadKey) {
        readFile(next.reloadKey, s.tabs.find(t => t.key === next.reloadKey)?.path)
      }
      return
    }
    setState(s => applyResolve(s, key, 'keep'))
  }, [saveDraftNow, readFile])

  // 订阅外部文件变更（主进程推送时携带最新 stat，渲染端无需 fs.stat）
  useEffect(() => {
    const id = window.electronAPI.md.onFileChanged(({ filePath, mtimeMs, size }) => {
      const key = normalizePath(filePath)
      const tab = stateRef.current.tabs.find(t => t.key === key)
      if (!tab) return
      const res = applyFileChanged(stateRef.current, key, { mtimeMs, size })
      if (res.reloadKey) {
        readFile(res.reloadKey, tab.path) // 预览态：静默刷新
      } else if (res !== stateRef.current) {
        setState(res) // 编辑态：冲突提示条 / 非阻塞提示条
      }
    })
    return () => window.electronAPI.md.removeFileChangedListener(id)
  }, [readFile])

  const handleWorkspaceChanged = useCallback((workspaceRoot) => {
    setState(s => applyWorkspaceChanged(s, workspaceRoot))
  }, [])

  const setPanelWidth = useCallback((width) => {
    const w = clampWidth(width, window.innerWidth)
    setPanelWidthState(w)
    localStorage.setItem(PANEL_WIDTH_KEY, String(w))
  }, [])

  return {
    state, panelWidth, openFile, closeTab, selectTab, collapse, toggleEdit, setDraft,
    resolveConflict, handleWorkspaceChanged, setPanelWidth
  }
}

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
    // 解锁：无论读成功/失败/空响应/期间关 tab，都从 inflight 移除该 key（避免永久阻塞）
    const unlock = s => ({ ...s, inflight: new Set([...s.inflight].filter(k => k !== key)) })
    if (!res) {
      setState(unlock)
      return
    }
    // 用函数式 updater 在最新 state 内判断 tab 是否仍在（stateRef 可能滞后于异步返回）
    if ('error' in res) {
      setState(s => s.tabs.some(t => t.key === key)
        ? unlock(applyReadFailure(s, key, res.error))
        : unlock(s))
    } else {
      setState(s => s.tabs.some(t => t.key === key)
        ? unlock(applyReadSuccess(s, key, res))
        : unlock(s))
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
    const next = dedupeOpen(stateRef.current, { path })
    if (next.rejected) return
    const isExisting = next.tabs.length === stateRef.current.tabs.length
    setState(s => dedupeOpen(s, { path }))
    if (isExisting) {
      // 命中已打开 tab：只切 tab，不 watch 不 readFile（防重读覆盖未保存草稿）
      // 例外：tab 处于 error 态时需重读重试（配合读失败解锁 inflight）
      const tab = stateRef.current.tabs.find(t => t.key === key)
      if (tab && tab.status !== 'error') return
    }
    setState(s => ({ ...s, inflight: new Set([...s.inflight, key]) }))
    window.electronAPI.md.watch(path)
    await readFile(key, path)
  }, [readFile])

  const saveDraftNow = useCallback((key) => {
    const tab = stateRef.current.tabs.find(t => t.key === key)
    const draft = stateRef.current.drafts[key]
    if (!tab || typeof draft !== 'string') return Promise.resolve(false)
    return window.electronAPI.md.write(tab.path, draft).then(res => {
      if (res && res.ok) {
        // body 由主进程写回后重新解析（去掉 frontmatter），供预览态渲染
        // 保存回调返回时 tab 可能已被关闭：查 stillOpen，已关闭则不再把 contents/drafts/lastSeen 加回
        setState(s => {
          if (!s.tabs.some(t => t.key === key)) return s
          return {
            ...applyReadSuccess(s, key, { content: draft, body: res.body || draft, mtimeMs: res.mtimeMs, size: res.size }),
            tabs: s.tabs.map(t => t.key === key ? { ...t, dirty: false, conflict: null } : t)
          }
        })
        return true
      }
      setState(s => {
        if (!s.tabs.some(t => t.key === key)) return s
        return { ...s, tabs: s.tabs.map(t => t.key === key ? { ...t, conflict: 'save-failed' } : t) }
      })
      return false
    })
  }, [])

  const selectTab = useCallback((key) => setState(s => ({ ...s, activeKey: key })), [])
  const collapse = useCallback(() => setState(s => ({ ...s, isOpen: false })), [])

  // closeTab(key, force)：force=true 视为"确认丢弃"（跳过保存直接关，用于 tab 已处于 save-failed 冲突态时再点 ×）
  const closeTab = useCallback(async (key, force = false) => {
    const tab = stateRef.current.tabs.find(t => t.key === key)
    if (!tab) return
    // dirty 且非"确认丢弃"：先保存；失败则保留 tab（saveDraftNow 已置 conflict='save-failed'，提示条在 UI 渲染），不删 drafts
    if (tab.dirty && !force) {
      const ok = await saveDraftNow(key)
      if (!ok) return
    }
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
  }, [saveDraftNow])

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

  // 外部文件变更的统一处理：chokidar 推送 + agent 主动通知共用
  // applyFileChanged 内部按 mtimeMs/size 去重（自身写跳过），并按 tab 状态分流：
  //   预览态 → reloadKey 静默刷新；编辑态 dirty → 冲突条；编辑态无 dirty → 非阻塞提示
  const handleExternalFileChange = useCallback((filePath, mtimeMs, size) => {
    const key = normalizePath(filePath)
    const tab = stateRef.current.tabs.find(t => t.key === key)
    if (!tab) return
    const res = applyFileChanged(stateRef.current, key, { mtimeMs, size })
    if (res.reloadKey) {
      readFile(res.reloadKey, tab.path) // 预览态：静默刷新
    } else if (res !== stateRef.current) {
      setState(res) // 编辑态：冲突提示条 / 非阻塞提示条
    }
  }, [readFile])

  // chokidar 推送的外部文件变更（编辑器/外部程序修改）
  useEffect(() => {
    const id = window.electronAPI.md.onFileChanged(({ filePath, mtimeMs, size }) => {
      handleExternalFileChange(filePath, mtimeMs, size)
    })
    return () => window.electronAPI.md.removeFileChangedListener(id)
  }, [handleExternalFileChange])

  // agent 写盘成功的主动通知（payload 与 onFileChanged 同格式，路径与 openFile 同源可匹配 tab）
  // 主动通知先到则刷新 + 更新 lastSeen，chokidar 随后推相同 stat 被 applyFileChanged 去重跳过，不重复刷新
  useEffect(() => {
    const id = window.electronAPI.md.onReportWritten(({ path: filePath, mtimeMs, size }) => {
      handleExternalFileChange(filePath, mtimeMs, size)
    })
    return () => window.electronAPI.md.removeReportWrittenListener(id)
  }, [handleExternalFileChange])

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

import React, { Suspense, lazy, useState, useEffect, useRef } from 'react'
import { Tooltip, message } from 'antd'
import {
  LeftOutlined,
  PicLeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  MinusOutlined,
  BorderOutlined,
  CloseOutlined,
  FullscreenOutlined,
} from '@ant-design/icons'
import { AgentStoreProvider, useAgentStore } from '../components/AgentStore'
import { SmartDesignChat } from '../components/SmartDesignChat'
import BackgroundTaskBar from '../components/BackgroundTaskBar'
import LeftButtonBar from '../components/LeftButtonBar'

// 管理页面懒加载
const MaterialsPage = lazy(() => import('./MaterialsPage'))
const SchemesPage = lazy(() => import('./SchemesPage'))
const SettingsPage = lazy(() => import('./SettingsPage'))
const TrialRecordsPage = lazy(() => import('./TrialRecordsPage'))
const RemotePanelPage = lazy(() => import('./RemotePanelPage'))

const LoadingFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
    <div style={{ color: 'var(--text-tertiary)' }}>加载中...</div>
  </div>
)

function WorkspaceContent() {
  const { state, dispatch } = useAgentStore()
  const [hasTasks, setHasTasks] = useState(false)
  // 当前激活视图：'chat' | 'materials' | 'schemes' | 'settings'
  const [activeView, setActiveView] = useState('chat')
  // 管理页面左侧导航选中项
  const [matNavType, setMatNavType] = useState('全部')
  const [schNavType, setSchNavType] = useState('全部方案')
  const [setNavType, setSetNavType] = useState('使用帮助')
  // 原材料搜索关键词
  const [matSearchKeyword, setMatSearchKeyword] = useState('')
  // 窗口最大化状态（用于切换最大化/还原图标）
  const [isMaximized, setIsMaximized] = useState(false)

  // 三个页面的 ref，用于左侧导航调用页面方法
  const materialsRef = useRef(null)
  const schemesRef = useRef(null)
  const settingsRef = useRef(null)

  // 监听主进程窗口最大化/还原事件，同步自定义控制按钮图标
  useEffect(() => {
    const api = window.electronAPI?.window
    if (!api) return
    const onMax = () => setIsMaximized(true)
    const onUnmax = () => setIsMaximized(false)
    const maxId = api.onMaximized?.(onMax)
    const unmaxId = api.onUnmaximized?.(onUnmax)
    return () => {
      try {
        if (maxId) api.removeListener?.(maxId)
        if (unmaxId) api.removeListener?.(unmaxId)
      } catch (_) {}
    }
  }, [])

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const result = await window.electronAPI.invoke('get-all-tasks')
        if (result?.success && Array.isArray(result?.data)) {
          const running = result.data.some(t => t?.status === 'running')
          setHasTasks(!!running)
        }
      } catch (err) {
        console.error('WorkspacePage: load tasks error:', err)
      }
    }
    loadTasks()

    const handler = (...args) => {
      try {
        const task = args[0]
        if (!task || !task.id) return
        if (task.status === 'running') {
          setHasTasks(true)
        } else if (task.status === 'completed' || task.status === 'failed') {
          setHasTasks(false)
        }
      } catch (err) {
        console.error('WorkspacePage: task progress error:', err)
      }
    }

    const listenerId = window.electronAPI.on('background-task-progress', handler)
    return () => {
      window.electronAPI.removeListener(listenerId)
    }
  }, [])

  const sidebarCollapsed = state.session.sidebarCollapsed

  // 切换视图：聊天视图需要保留历史会话侧栏收起状态，管理视图不显示历史会话
  const handleSelectView = (view) => {
    setActiveView(view)
  }

  return (
    <div
      className="workspace-container v9-layout"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDrop={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        const files = Array.from(e.dataTransfer.files).filter(f =>
          /\.(jpe?g|png|webp)$/i.test(f.name)
        )
        if (files.length === 0) {
          message.warning('请拖入 jpg/jpeg/png/webp 图片')
          return
        }
        for (const file of files) {
          const result = await window.electronAPI.vision.upload(file)
          if (result?.success) {
            message.success(`已上传：${file.name}`)
          } else {
            message.error(`上传失败：${result?.error || '未知错误'}`)
          }
        }
      }}
    >
      {/* TopBar - 白色简洁风格（无原生标题栏，此处为可拖拽区域） */}
      <div className="topbar">
        <div className="topbar-logo">
          <img src="./logo.png" alt="Logo" />
          <span className="topbar-title">
            <span className="topbar-title-cn">砼智</span> Concrete Agent
          </span>
          {/* 历史会话开关按钮 — 仅在聊天视图显示 */}
          {activeView === 'chat' && (
            <Tooltip title={sidebarCollapsed ? '打开历史会话' : '关闭历史会话'}>
              <button
                className={`topbar-sidebar-toggle ${sidebarCollapsed ? '' : 'active'}`}
                onClick={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: !sidebarCollapsed })}
              >
                <PicLeftOutlined />
              </button>
            </Tooltip>
          )}
        </div>

        <div className="topbar-right">
          {hasTasks && <span className="topbar-task-dot has-tasks" />}
          <span className="topbar-version">v0.6.1</span>

          {/* 自定义窗口控制按钮（无原生标题栏时使用） */}
          <div className="topbar-window-controls">
            <Tooltip title="最小化">
              <button
                className="topbar-window-btn"
                onClick={() => window.electronAPI?.window?.minimize?.()}
                type="button"
              >
                <MinusOutlined />
              </button>
            </Tooltip>
            <Tooltip title={isMaximized ? '还原' : '最大化'}>
              <button
                className="topbar-window-btn"
                onClick={() => window.electronAPI?.window?.maximize?.()}
                type="button"
              >
                {isMaximized ? <FullscreenOutlined /> : <BorderOutlined />}
              </button>
            </Tooltip>
            <Tooltip title="关闭">
              <button
                className="topbar-window-btn topbar-window-btn-close"
                onClick={() => window.electronAPI?.window?.close?.()}
                type="button"
              >
                <CloseOutlined />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 主体区域：横向布局 = 按钮区 + [历史会话/导航栏] + 主界面 */}
      <div className="v9-main">
        {/* 最左侧按钮区 */}
        <LeftButtonBar activeView={activeView} onSelect={handleSelectView} />

        {/* 聊天视图：历史会话侧栏 + 主聊天界面 */}
        {activeView === 'chat' && (
          <SmartDesignChat />
        )}

        {/* 原材料管理视图：导航栏 + 主管理界面 */}
        {activeView === 'materials' && (
          <div className="v9-manage-body">
            <div className="v9-manage-nav">
              {/* 搜索框 */}
              <div className="v9-mat-search">
                <SearchOutlined className="v9-mat-search-icon" />
                <input
                  type="text"
                  className="v9-mat-search-input"
                  placeholder="搜索材料..."
                  value={matSearchKeyword}
                  onChange={(e) => {
                    setMatSearchKeyword(e.target.value)
                    materialsRef.current?.setSearchKeyword(e.target.value)
                  }}
                />
              </div>
              {/* 图标按钮：刷新 + 新增 */}
              <div className="v9-mat-actions">
                <Tooltip title="刷新">
                  <button className="v9-mat-icon-btn" onClick={() => materialsRef.current?.refresh()}>
                    <ReloadOutlined />
                  </button>
                </Tooltip>
                <Tooltip title="新增材料">
                  <button className="v9-mat-icon-btn primary" onClick={() => materialsRef.current?.addNew()}>
                    <PlusOutlined />
                  </button>
                </Tooltip>
              </div>
              <div className="v9-mat-nav-label">材料类型</div>
              <div className="v9-mat-nav">
                {['全部', '水泥', '粉煤灰', '矿渣粉', '锂渣', '复合粉', '细骨料', '粗骨料', '减水剂', '其他'].map(t => (
                  <div key={t} className={`v9-mat-nav-item ${matNavType === t ? 'active' : ''}`} onClick={() => { setMatNavType(t); materialsRef.current?.filterByType(t) }}>{t}</div>
                ))}
              </div>
            </div>
            <div className="v9-manage-content">
              <Suspense fallback={<LoadingFallback />}>
                <MaterialsPage ref={materialsRef} />
              </Suspense>
            </div>
          </div>
        )}

        {/* 方案管理视图：导航栏 + 主管理界面 */}
        {activeView === 'schemes' && (
          <div className="v9-manage-body">
            <div className="v9-manage-nav">
              <div className="v9-mat-nav-label">方案分类</div>
              <div className="v9-mat-nav">
                {['全部方案', '正式方案', '草稿方案', '已对比'].map(t => (
                  <div key={t} className={`v9-mat-nav-item ${schNavType === t ? 'active' : ''}`} onClick={() => { setSchNavType(t); schemesRef.current?.filterScheme(t) }}>{t}</div>
                ))}
              </div>
            </div>
            <div className="v9-manage-content">
              <Suspense fallback={<LoadingFallback />}>
                <SchemesPage ref={schemesRef} />
              </Suspense>
            </div>
          </div>
        )}

        {/* 试配记录视图：只读查看页 */}
        {activeView === 'trial-records' && (
          <div className="v9-manage-body">
            <div className="v9-manage-content">
              <Suspense fallback={<LoadingFallback />}>
                <TrialRecordsPage />
              </Suspense>
            </div>
          </div>
        )}

        {/* 远程连接视图：桌面「远程连接」面板（R10） */}
        {activeView === 'remote' && (
          <div className="v9-manage-body">
            <div className="v9-manage-content">
              <Suspense fallback={<LoadingFallback />}>
                <RemotePanelPage />
              </Suspense>
            </div>
          </div>
        )}

        {/* 系统设置视图：导航栏 + 主管理界面 */}
        {activeView === 'settings' && (
          <div className="v9-manage-body">
            <div className="v9-manage-nav">
              <div className="v9-mat-nav-label">设置分类</div>
              <div className="v9-mat-nav">
                {['JGJ55标准', '备份设置', 'LLM管理', '模型管理', '技能管理', '销售报价', '系统设置'].map(t => (
                  <div key={t} className={`v9-mat-nav-item ${setNavType === t ? 'active' : ''}`} onClick={() => { setSetNavType(t); settingsRef.current?.switchTab(t) }}>{t}</div>
                ))}
              </div>
            </div>
            <div className="v9-manage-content">
              <Suspense fallback={<LoadingFallback />}>
                <SettingsPage ref={settingsRef} />
              </Suspense>
            </div>
          </div>
        )}
      </div>

      <BackgroundTaskBar />
    </div>
  )
}

export default function WorkspacePage() {
  return (
    <AgentStoreProvider>
      <WorkspaceContent />
    </AgentStoreProvider>
  )
}

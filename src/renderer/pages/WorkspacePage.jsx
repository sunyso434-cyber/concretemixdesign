import React, { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react'
import { Spin, Drawer, Button, Space, Tooltip } from 'antd'
import { AppstoreOutlined, SettingOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import ResizablePanels from '../components/ResizablePanels'
import WorkspaceTabs from '../components/WorkspaceTabs'
import BackgroundTaskBar from '../components/BackgroundTaskBar'

// Lazy load all page components
const MaterialsPage = lazy(() => import('./MaterialsPage'))
const MixDesignPage = lazy(() => import('./MixDesignPage'))
const AIAnalysisPage = lazy(() => import('./AIAnalysisPage'))
const OptimizationPage = lazy(() => import('./OptimizationPage'))
const InverseCalculationPage = lazy(() => import('./InverseCalculationPage'))
const SchemesPage = lazy(() => import('./SchemesPage'))
const SettingsPage = lazy(() => import('./SettingsPage'))

const MIDDLE_TABS = [
  { key: 'ai-analysis', label: 'AI分析' },
  { key: 'mixdesign', label: '配合比设计' },
  { key: 'optimization', label: '成本优化' },
  { key: 'inverse-calculation', label: '参数反算' },
]

function loadTab(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    if (v) return v
  } catch (e) { /* ignore */ }
  return fallback
}

function saveTab(key, value) {
  try { localStorage.setItem(key, value) } catch (e) { /* ignore */ }
}

const LoadingFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
    <Spin size="default" />
  </div>
)

export default function WorkspacePage() {
  const materialsRef = useRef(null)
  const [middleTab, setMiddleTab] = useState(() => loadTab('middleActiveTab', 'ai-analysis'))
  const [hasTasks, setHasTasks] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(null) // null | 'schemes' | 'settings'

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('get-all-tasks')
        if (result && result.success && Array.isArray(result.data)) {
          const running = result.data.some(t => t && t.status === 'running')
          setHasTasks(running)
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

    window.electron.ipcRenderer.on('background-task-progress', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('background-task-progress', handler)
    }
  }, [])

  const handleMiddleChange = useCallback((key) => {
    setMiddleTab(key)
    saveTab('middleActiveTab', key)
  }, [])

  const renderMiddleContent = () => {
    const style = hidden => hidden ? { display: 'none' } : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }
    return (
      <>
        <div style={style(middleTab !== 'mixdesign')} className="panel-content">
          <Suspense fallback={<LoadingFallback />}><MixDesignPage /></Suspense>
        </div>
        <div style={style(middleTab !== 'ai-analysis')} className="panel-content">
          <Suspense fallback={<LoadingFallback />}><AIAnalysisPage /></Suspense>
        </div>
        <div style={style(middleTab !== 'optimization')} className="panel-content">
          <Suspense fallback={<LoadingFallback />}><OptimizationPage /></Suspense>
        </div>
        <div style={style(middleTab !== 'inverse-calculation')} className="panel-content">
          <Suspense fallback={<LoadingFallback />}><InverseCalculationPage /></Suspense>
        </div>
      </>
    )
  }

  const leftContent = (
    <>
      <div className="workspace-tabs" style={{ justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
        <span className="workspace-tab-label">原材料管理</span>
        <Space size={0}>
          <Button
            type="text"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => materialsRef.current?.addNew()}
            title="新增材料"
          />
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => materialsRef.current?.refresh()}
            title="刷新"
          />
        </Space>
      </div>
      <div className="panel-content">
        <Suspense fallback={<LoadingFallback />}><MaterialsPage ref={materialsRef} hideActionBar /></Suspense>
      </div>
    </>
  )

  const middleContent = (
    <>
      <div className="workspace-tabs">
        {MIDDLE_TABS.map(tab => {
          const isActive = middleTab === tab.key
          return (
            <button
              key={tab.key}
              className={`workspace-tab ${isActive ? 'active' : ''}`}
              onClick={() => handleMiddleChange(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          )
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title="方案管理">
            <span className="topbar-icon" onClick={() => setDrawerOpen('schemes')}><AppstoreOutlined /></span>
          </Tooltip>
          <Tooltip title="系统设置">
            <span className="topbar-icon" onClick={() => setDrawerOpen('settings')}><SettingOutlined /></span>
          </Tooltip>
          <span className="topbar-version">v8.3.1</span>
        </div>
      </div>
      {renderMiddleContent()}
    </>
  )

  return (
    <div className="workspace-container">
      <ResizablePanels left={leftContent} middle={middleContent} />
      <Drawer
        title="方案管理"
        open={drawerOpen === 'schemes'}
        onClose={() => setDrawerOpen(null)}
        width="80%"
        destroyOnClose
      >
        <Suspense fallback={<LoadingFallback />}><SchemesPage /></Suspense>
      </Drawer>
      <Drawer
        title="系统设置"
        open={drawerOpen === 'settings'}
        onClose={() => setDrawerOpen(null)}
        width="80%"
        destroyOnClose
      >
        <Suspense fallback={<LoadingFallback />}><SettingsPage /></Suspense>
      </Drawer>
      <BackgroundTaskBar />
    </div>
  )
}

import React, { Suspense, lazy, useState, useCallback, useEffect } from 'react'
import { Spin } from 'antd'
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
  { key: 'mixdesign', label: '配合比设计' },
  { key: 'ai-analysis', label: 'AI分析' },
  { key: 'optimization', label: '成本优化' },
  { key: 'inverse-calculation', label: '参数反算' },
]

const RIGHT_TABS = [
  { key: 'schemes', label: '方案管理' },
  { key: 'settings', label: '系统设置' },
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
  const [middleTab, setMiddleTab] = useState(() => loadTab('middleActiveTab', 'mixdesign'))
  const [rightTab, setRightTab] = useState(() => loadTab('rightActiveTab', 'schemes'))
  const [hasTasks, setHasTasks] = useState(false)

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

  const handleRightChange = useCallback((key) => {
    setRightTab(key)
    saveTab('rightActiveTab', key)
  }, [])

  const renderMiddleContent = () => {
    const style = hidden => ({ display: hidden ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0 })
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

  const renderRightContent = () => {
    const style = hidden => ({ display: hidden ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0 })
    return (
      <>
        <div style={style(rightTab !== 'schemes')} className="panel-content">
          <Suspense fallback={<LoadingFallback />}><SchemesPage /></Suspense>
        </div>
        <div style={style(rightTab !== 'settings')} className="panel-content">
          <Suspense fallback={<LoadingFallback />}><SettingsPage /></Suspense>
        </div>
      </>
    )
  }

  const leftContent = (
    <>
      <WorkspaceTabs
        tabs={[{ key: 'materials', label: '原材料管理' }]}
        activeKey="materials"
        readonly
      />
      <div className="panel-content">
        <Suspense fallback={<LoadingFallback />}><MaterialsPage /></Suspense>
      </div>
    </>
  )

  const middleContent = (
    <>
      <WorkspaceTabs tabs={MIDDLE_TABS} activeKey={middleTab} onChange={handleMiddleChange} />
      {renderMiddleContent()}
    </>
  )

  const rightContent = (
    <>
      <WorkspaceTabs tabs={RIGHT_TABS} activeKey={rightTab} onChange={handleRightChange} />
      {renderRightContent()}
    </>
  )

  return (
    <div className="workspace-container">
      <header className="topbar">
        <span className="topbar-title">混凝土配合比设计系统</span>
        <div className="topbar-right">
          <span className="topbar-version">v3.1.0</span>
          <span className={`topbar-task-dot${hasTasks ? ' has-tasks' : ''}`} />
        </div>
      </header>
      <ResizablePanels left={leftContent} middle={middleContent} right={rightContent} />
      <BackgroundTaskBar />
    </div>
  )
}

import React, { Suspense, lazy } from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, Layout, Spin } from 'antd'
import zhCN from 'antd/lib/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'
import BackgroundTaskBar from './components/BackgroundTaskBar'
import NavRail from './components/NavRail'

// 页面组件 - 使用 lazy 加载
const MaterialsPage = lazy(() => import('./pages/MaterialsPage').catch(err => {
  console.error('MaterialsPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">📦</div><div className="empty-title">加载失败</div><div className="empty-description">MaterialsPage 加载失败：{err.message}</div></div> }
}))
const MixDesignPage = lazy(() => import('./pages/MixDesignPage').catch(err => {
  console.error('MixDesignPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">📝</div><div className="empty-title">加载失败</div><div className="empty-description">MixDesignPage 加载失败：{err.message}</div></div> }
}))
const SchemesPage = lazy(() => import('./pages/SchemesPage').catch(err => {
  console.error('SchemesPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">📋</div><div className="empty-title">加载失败</div><div className="empty-description">SchemesPage 加载失败：{err.message}</div></div> }
}))
const SettingsPage = lazy(() => import('./pages/SettingsPage').catch(err => {
  console.error('SettingsPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">⚙️</div><div className="empty-title">加载失败</div><div className="empty-description">SettingsPage 加载失败：{err.message}</div></div> }
}))
const OptimizationPage = lazy(() => import('./pages/OptimizationPage').catch(err => {
  console.error('OptimizationPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">🎯</div><div className="empty-title">加载失败</div><div className="empty-description">OptimizationPage 加载失败：{err.message}</div></div> }
}))
const InverseCalculationPage = lazy(() => import('./pages/InverseCalculationPage').catch(err => {
  console.error('InverseCalculationPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">🔢</div><div className="empty-title">加载失败</div><div className="empty-description">InverseCalculationPage 加载失败：{err.message}</div></div> }
}))
const MassConcretePage = lazy(() => import('./pages/MassConcretePage').catch(err => {
  console.error('MassConcretePage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">🧊</div><div className="empty-title">加载失败</div><div className="empty-description">MassConcretePage 加载失败：{err.message}</div></div> }
}))

const { Header, Content } = Layout

// 加载中的占位符
const LoadingFallback = () => (
  <div className="custom-loading">
    <Spin size="large" />
    <div className="loading-text">加载中，请稍候...</div>
  </div>
)

// 错误边界组件
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('React Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="custom-empty">
          <div className="empty-icon">⚠️</div>
          <div className="empty-title">页面加载出错</div>
          <div className="empty-description">
            {this.state.error?.message}
            <details style={{ marginTop: '16px', textAlign: 'left' }}>
              <summary>错误详情</summary>
              <pre style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                {this.state.error?.stack}
              </pre>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#334155',
          colorSuccess: '#10B981',
          colorWarning: '#F59E0B',
          colorError: '#EF4444',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          borderRadius: 6,
        },
        components: {
          Button: { borderRadius: 6, controlHeight: 40 },
          Card: { borderRadius: 8 },
          Input: { borderRadius: 6, controlHeight: 40 },
          Select: { borderRadius: 6, controlHeight: 40 },
          Table: { borderRadius: 8 },
          Modal: { borderRadius: 8 },
        },
      }}
    >
      <Router>
        <Layout style={{ minHeight: '100vh' }}>
          <Header style={{
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            padding: '0 24px',
            height: 64,
            lineHeight: '64px',
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              height: '100%'
            }}>
              <div style={{
                fontSize: 17,
                fontWeight: 500,
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
              }}>
                <span style={{ marginRight: 8, fontSize: 24 }}>🏗️</span>
                混凝土配合比设计系统
              </div>
            </div>
          </Header>

          <NavRail />

          <Content style={{
            padding: '32px',
            background: '#F8FAFC',
            minHeight: 'calc(100vh - 64px)',
            marginLeft: 48,
            transition: 'margin-left 200ms ease',
          }}>
            <div style={{
              maxWidth: '1383px',
              margin: '0 auto',
              minHeight: '100%'
            }}>
              <ErrorBoundary>
                <Suspense fallback={<LoadingFallback />}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/materials" replace />} />
                    <Route path="/materials" element={<MaterialsPage />} />
                    <Route path="/mixdesign" element={<MixDesignPage />} />
                    <Route path="/optimization" element={<OptimizationPage />} />
                    <Route path="/inverse-calculation" element={<InverseCalculationPage />} />
                    <Route path="/mass-concrete" element={<MassConcretePage />} />
                    <Route path="/schemes" element={<SchemesPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          </Content>
        </Layout>
      </Router>
      <BackgroundTaskBar />
    </ConfigProvider>
  )
}

export default App

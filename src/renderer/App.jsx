import React, { useState, Suspense, lazy, useEffect } from 'react'
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { ConfigProvider, Menu, Layout, Spin, Typography, Space, Divider } from 'antd'
import zhCN from 'antd/lib/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'
import BackgroundTaskBar from './components/BackgroundTaskBar'

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

const { Header, Content, Sider } = Layout
const { Title } = Typography

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

// 导航组件
const Navigation = ({ activeKey, setActiveKey }) => {
  const location = useLocation()

  useEffect(() => {
    // 根据当前路径更新活动菜单项
    const path = location.pathname.replace('/', '')
    if (path) {
      setActiveKey(path)
    }
  }, [location.pathname, setActiveKey])

  const handleMenuClick = (e) => {
    console.log('菜单点击:', e.key)
    setActiveKey(e.key)
  }

  return (
    <Menu
      mode="horizontal"
      selectedKeys={[activeKey]}
      style={{
        flex: 1,
        minWidth: 0,
        background: 'transparent',
        borderBottom: 'none'
      }}
      onClick={handleMenuClick}
      items={[
        {
          key: 'materials',
          label: <Link to="/materials">原材料管理</Link>,
          icon: <span className="nav-icon" aria-label="原材料">📦</span>
        },
        {
          key: 'mixdesign',
          label: <Link to="/mixdesign">配合比设计</Link>,
          icon: <span className="nav-icon" aria-label="配合比设计">📝</span>
        },
        {
          key: 'optimization',
          label: <Link to="/optimization">成本优化</Link>,
          icon: <span className="nav-icon" aria-label="成本优化">🎯</span>
        },
        {
          key: 'inverse-calculation',
          label: <Link to="/inverse-calculation">参数反算</Link>,
          icon: <span className="nav-icon" aria-label="参数反算">🔢</span>
        },
        {
          key: 'mass-concrete',
          label: <Link to="/mass-concrete">大体积混凝土</Link>,
          icon: <span className="nav-icon" aria-label="大体积混凝土">🧊</span>
        },
        {
          key: 'schemes',
          label: <Link to="/schemes">方案管理</Link>,
          icon: <span className="nav-icon" aria-label="方案管理">📋</span>
        },
        {
          key: 'settings',
          label: <Link to="/settings">系统管理</Link>,
          icon: <span className="nav-icon" aria-label="系统设置">⚙️</span>
        }
      ]}
    />
  )
}

function App() {
  const [activeKey, setActiveKey] = useState('materials')

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1E56A0',
          colorSuccess: '#009966',
          colorWarning: '#ff9900',
          colorError: '#cc0033',
          colorInfo: '#666666',
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          borderRadius: 4,
          transitionDuration: '0.33s',
        },
        components: {
          Menu: {
            itemBorderRadius: 4,
            itemHoverBg: '#F4F4F4',
            itemSelectedBg: '#F4F4F4',
            itemSelectedColor: '#1E56A0',
            horizontalItemHoverColor: '#171A20',
            horizontalItemSelectedColor: '#3E6AE1',
            itemColor: '#171A20',
          },
          Button: {
            borderRadius: 4,
            controlHeight: 40,
          },
          Card: {
            borderRadius: 12,
          },
          Input: {
            borderRadius: 4,
            controlHeight: 40,
          },
          Select: {
            borderRadius: 4,
            controlHeight: 40,
          },
          Table: {
            borderRadius: 12,
          },
          Modal: {
            borderRadius: 12,
          },
        },
      }}
    >
      <Router>
        <Layout style={{ minHeight: '100vh' }}>
          <Header style={{
            background: '#FFFFFF',
            borderBottom: '1px solid #EEEEEE',
            padding: '0 32px',
            position: 'sticky',
            top: 0,
            zIndex: 100
          }}>
            <a href="#main-content" className="skip-to-content">跳转到主要内容</a>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              height: '64px'
            }}>
              <div style={{
                fontSize: '17px',
                fontWeight: '500',
                color: '#171A20',
                marginRight: '48px',
                display: 'flex',
                alignItems: 'center',
                letterSpacing: 'normal'
              }}>
                <span style={{ marginRight: '8px' }}>🏗️</span>
                混凝土配合比设计系统
              </div>
              <Navigation activeKey={activeKey} setActiveKey={setActiveKey} />
            </div>
          </Header>
          <Content style={{
            padding: '32px',
            background: '#FFFFFF',
            minHeight: 'calc(100vh - 64px)'
          }} id="main-content">
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

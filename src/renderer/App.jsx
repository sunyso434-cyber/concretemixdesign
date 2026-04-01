import React, { useState, Suspense, lazy, useEffect } from 'react'
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import { ConfigProvider, Menu, Layout, Spin, Typography, Space, Divider } from 'antd'
import zhCN from 'antd/lib/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'

// 页面组件 - 使用 lazy 加载
const MaterialsPage = lazy(() => import('./pages/MaterialsPage').catch(err => {
  console.error('MaterialsPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">📦</div><div className="empty-title">加载失败</div><div className="empty-description">MaterialsPage 加载失败: {err.message}</div></div> }
}))
const MixDesignPage = lazy(() => import('./pages/MixDesignPage').catch(err => {
  console.error('MixDesignPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">📝</div><div className="empty-title">加载失败</div><div className="empty-description">MixDesignPage 加载失败: {err.message}</div></div> }
}))
const SchemesPage = lazy(() => import('./pages/SchemesPage').catch(err => {
  console.error('SchemesPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">📋</div><div className="empty-title">加载失败</div><div className="empty-description">SchemesPage 加载失败: {err.message}</div></div> }
}))
const SettingsPage = lazy(() => import('./pages/SettingsPage').catch(err => {
  console.error('SettingsPage 加载失败:', err)
  return { default: () => <div className="custom-empty"><div className="empty-icon">⚙️</div><div className="empty-title">加载失败</div><div className="empty-description">SettingsPage 加载失败: {err.message}</div></div> }
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
          icon: <span className="nav-icon">📦</span>
        },
        {
          key: 'mixdesign',
          label: <Link to="/mixdesign">配合比设计</Link>,
          icon: <span className="nav-icon">📝</span>
        },
        {
          key: 'schemes',
          label: <Link to="/schemes">方案管理</Link>,
          icon: <span className="nav-icon">📋</span>
        },
        {
          key: 'settings',
          label: <Link to="/settings">系统管理</Link>,
          icon: <span className="nav-icon">⚙️</span>
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
          colorPrimary: 'var(--primary-color)',
          colorSuccess: 'var(--success-color)',
          colorWarning: 'var(--warning-color)',
          colorError: 'var(--error-color)',
          colorInfo: 'var(--info-color)',
          fontFamily: 'var(--font-sans)',
          borderRadius: 8,
        },
        components: {
          Menu: {
            itemBorderRadius: 6,
            itemHoverBg: 'var(--primary-light)',
            itemSelectedBg: 'var(--primary-light)',
            itemSelectedColor: 'var(--primary-dark)',
          },
          Button: {
            borderRadius: 6,
          },
          Card: {
            borderRadius: 12,
          },
          Input: {
            borderRadius: 6,
          },
          Select: {
            borderRadius: 6,
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
            background: 'var(--card-bg)', 
            boxShadow: 'var(--shadow-md)',
            padding: '0 var(--spacing-xl)',
            position: 'sticky',
            top: 0,
            zIndex: 100
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              height: '72px'
            }}>
              <div style={{ 
                display: 'flex',
                alignItems: 'center',
                marginRight: 'var(--spacing-2xl)'
              }}>
                <div style={{ 
                  fontSize: '20px', 
                  fontWeight: '700', 
                  color: 'var(--primary-color)',
                  marginRight: 'var(--spacing-sm)',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <span style={{ marginRight: '8px' }}>🏗️</span>
                  混凝土配合比设计系统
                </div>
              </div>
              <Navigation activeKey={activeKey} setActiveKey={setActiveKey} />
            </div>
          </Header>
          <Content style={{ 
            padding: 'var(--spacing-xl)', 
            background: 'var(--bg-color)',
            minHeight: 'calc(100vh - 72px)'
          }}>
            <div style={{ 
              maxWidth: '1400px', 
              margin: '0 auto',
              minHeight: '100%'
            }}>
              <ErrorBoundary>
                <Suspense fallback={<LoadingFallback />}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/materials" replace />} />
                    <Route path="/materials" element={<MaterialsPage />} />
                    <Route path="/mixdesign" element={<MixDesignPage />} />
                    <Route path="/schemes" element={<SchemesPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          </Content>
        </Layout>
      </Router>
    </ConfigProvider>
  )
}

export default App

import React, { Suspense, lazy } from 'react'
import { ConfigProvider, Spin } from 'antd'
import zhCN from 'antd/lib/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'

const WorkspacePage = lazy(() => import('./pages/WorkspacePage'))

const SplashFallback = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: 16,
    background: '#F5F5F5'
  }}>
    <Spin size="large" />
    <div style={{ color: '#737373', fontSize: 14 }}>加载中，请稍候...</div>
  </div>
)

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#4B3FE3',
          colorSuccess: '#34C759',
          colorWarning: '#FF9500',
          colorError: '#FF3B30',
          fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          borderRadius: 8,
        },
        components: {
          Button: { borderRadius: 8, controlHeight: 40 },
          Card: { borderRadius: 8 },
          Input: { borderRadius: 8, controlHeight: 40 },
          Select: { borderRadius: 8, controlHeight: 40 },
          Table: { borderRadius: 8 },
          Modal: { borderRadius: 8 },
        },
      }}
    >
      <Suspense fallback={<SplashFallback />}>
        <WorkspacePage />
      </Suspense>
    </ConfigProvider>
  )
}

export default App

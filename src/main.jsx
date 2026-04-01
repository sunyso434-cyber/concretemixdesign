import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.jsx'
import store from './store/index.js'
import './index.css'

// 渲染应用根组件
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* 配置Ant Design的语言为中文 */}
    <ConfigProvider locale={zhCN}>
      {/* 提供Redux状态管理 */}
      <Provider store={store}>
        {/* 配置路由 */}
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </ConfigProvider>
  </React.StrictMode>,
)

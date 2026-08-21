import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import store from './store/index'
import App from './App.jsx'
// 本地字体（替代 Google Fonts 远程加载，离线可用）
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/roboto-mono/latin-400.css'
import '@fontsource/roboto-mono/latin-500.css'
import './index.css'

// 添加全局错误处理
window.onerror = function(msg, url, lineNo, columnNo, error) {
  console.error('全局JS错误:', msg, '位置:', url, lineNo, columnNo, error)
}

// 真实环境由 preload 注入 electronAPI；浏览器开发环境动态加载 mock（独立 chunk，Electron 下不加载）
// 判断 electronAPI 而非 electron：真实环境 preload 只暴露 electronAPI（问题 14）
async function bootstrap() {
  if (!window.electronAPI) {
    await import('./mocks/electronMock')
  }
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>,
  )
  console.log('React应用已挂载到root元素')
}

bootstrap()

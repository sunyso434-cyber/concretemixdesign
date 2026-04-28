import React, { useState, useEffect } from 'react'
import { Spin } from 'antd'

const SplashPage = ({ onReady }) => {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // 模拟加载进度
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          return 100
        }
        // 前2秒内匀速到达100
        const increment = 100 / 20 // 20次更新，2000ms/20=100ms每次
        return Math.min(prev + increment, 100)
      })
    }, 100)

    // 2秒后触发完成
    const timer = setTimeout(() => {
      onReady()
    }, 2000)

    return () => {
      clearInterval(interval)
      clearTimeout(timer)
    }
  }, [onReady])

  return (
    <div className="splash-page">
      <div className="splash-content">
        <div className="splash-icon">🏗️</div>
        <h1 className="splash-title">混凝土配合比设计系统</h1>
        <p className="splash-subtitle">正在初始化...</p>
        <div className="splash-progress">
          <div className="splash-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="splash-spinner">
          <Spin size="small" />
        </div>
      </div>
    </div>
  )
}

export default SplashPage
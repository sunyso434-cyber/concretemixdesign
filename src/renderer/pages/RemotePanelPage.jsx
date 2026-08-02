// RemotePanelPage：桌面「远程连接」面板页面（R10）
// 包装 RemotePanel 组件成独立页面，由 WorkspacePage 侧边栏「远程连接」入口进入。
import React from 'react'
import RemotePanel from '../components/RemotePanel'

export default function RemotePanelPage() {
  return (
    <div className="page-container remote-panel-page">
      <RemotePanel />
    </div>
  )
}

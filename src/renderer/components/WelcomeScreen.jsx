// src/renderer/components/WelcomeScreen.jsx
// v9.0.0 补充21：欢迎页组件
// 应用启动时默认显示。布局：
//   ┌──────────────────────────────────────────────────┐
//   │ 工作区状态条（路径 + 切换/清空）                      │
//   ├──────────────────────┬───────────────────────────┤
//   │ 最近会话（卡片列表）     │   砼智欢迎语 + 4 个快捷按钮  │
//   │                      │   [➕ 新建会话]              │
//   └──────────────────────┴───────────────────────────┘
//
// 所有交互通过 props 回调，避免组件直接依赖 AgentStore（方便单测）。

import React, { useMemo } from 'react'
import { Button, Empty, Tag, Tooltip } from 'antd'
import {
  PlusOutlined,
  BulbOutlined,
  AppstoreOutlined,
  FolderOpenOutlined,
  CloseCircleOutlined,
  MessageOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'

const QUICK_PROMPTS = [
  { label: '帮我设计C30配合比', message: '帮我设计C30配合比，坍落度180mm', icon: BulbOutlined },
  { label: '优化成本', message: '帮我优化配合比成本，找到最便宜的材料组合', icon: BulbOutlined },
  { label: '对比材料', message: '帮我对比不同水泥对配合比的影响', icon: BulbOutlined },
  { label: '/ 查看技能', message: '/', icon: AppstoreOutlined, isSlash: true },
]

/**
 * 把时间戳格式化为"X 分钟前 / X 小时前 / 昨天 / X 天前 / YYYY-MM-DD"
 */
function formatRelativeTime(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const now = Date.now()
  const diffMs = now - d.getTime()
  const sec = Math.floor(diffMs / 1000)
  const min = Math.floor(sec / 60)
  const hr = Math.floor(min / 60)
  const day = Math.floor(hr / 24)
  if (sec < 60) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  if (hr < 24) return `${hr} 小时前`
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  // 超过 7 天显示具体日期
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * 从完整路径中提取最后一段作为显示名。
 */
function basename(p) {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}

const WelcomeScreen = ({
  workspacePath = null,
  recentSessions = [],
  onPickWorkspace,
  onClearWorkspace,
  onNewSession,
  onOpenSession,
  onQuickPrompt,
}) => {
  const workspaceName = useMemo(() => basename(workspacePath), [workspacePath])

  return (
    <div className="welcome-screen">
      {/* 顶部工作区状态条 */}
      <div className="welcome-workspace-bar">
        <div className="welcome-workspace-info">
          <FolderOpenOutlined style={{ color: 'var(--primary-color, #1677ff)', fontSize: 16 }} />
          <span className="welcome-workspace-label">当前工作区：</span>
          {workspacePath ? (
            <Tooltip title={workspacePath} placement="bottom">
              <span className="welcome-workspace-name">{workspaceName}</span>
            </Tooltip>
          ) : (
            <span className="welcome-workspace-empty">未选择（点击右侧"选择工作区"开始）</span>
          )}
        </div>
        <div className="welcome-workspace-actions">
          {workspacePath && (
            <Button
              size="small"
              icon={<CloseCircleOutlined />}
              onClick={onClearWorkspace}
            >
              关闭工作区
            </Button>
          )}
          <Button
            size="small"
            type="primary"
            icon={<FolderOpenOutlined />}
            onClick={onPickWorkspace}
          >
            {workspacePath ? '切换工作区' : '选择工作区'}
          </Button>
        </div>
      </div>

      {/* 主内容：左侧最近会话 + 右侧欢迎语 */}
      <div className="welcome-main">
        {/* 左侧：最近会话列表 */}
        <div className="welcome-left">
          <div className="welcome-section-header">
            <span className="welcome-section-title">最近会话</span>
            {recentSessions.length > 0 && (
              <span className="welcome-section-count">（{recentSessions.length}）</span>
            )}
          </div>
          {recentSessions.length === 0 ? (
            <div className="welcome-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无历史会话，点击右侧 ➕ 新建会话开始"
              />
            </div>
          ) : (
            <div className="welcome-session-list">
              {recentSessions.map((s) => (
                <div
                  key={s.sessionId}
                  className="welcome-session-card"
                  onClick={() => onOpenSession && onOpenSession(s.sessionId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenSession && onOpenSession(s.sessionId)
                    }
                  }}
                >
                  <div className="welcome-session-card-row1">
                    <MessageOutlined style={{ color: 'var(--primary-color, #1677ff)', marginRight: 6 }} />
                    <span className="welcome-session-title">{s.sessionName || '新会话'}</span>
                  </div>
                  <div className="welcome-session-card-row2">
                    <span className="welcome-session-time">
                      <ClockCircleOutlined style={{ marginRight: 4 }} />
                      {formatRelativeTime(s.lastActivity)}
                    </span>
                    {s.workspacePath && (
                      <Tag color="blue" style={{ marginLeft: 6 }}>
                        {basename(s.workspacePath)}
                      </Tag>
                    )}
                    {s.messageCount > 0 && (
                      <span className="welcome-session-msgcount">{s.messageCount} 条消息</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：欢迎语 + 快捷按钮 */}
        <div className="welcome-right">
          <div className="welcome-hero">
            <div className="welcome-hero-title">
              <span className="welcome-hero-cn">砼智</span>
              <span className="welcome-hero-en">Concrete Agent</span>
            </div>
            <div className="welcome-hero-subtitle">
              智能混凝土配合比设计助手
            </div>
          </div>

          <div className="welcome-quick-grid">
            {QUICK_PROMPTS.map((item, i) => {
              const Icon = item.icon
              return (
                <button
                  key={i}
                  className="welcome-quick-card"
                  onClick={() => onQuickPrompt && onQuickPrompt(item.message)}
                  type="button"
                >
                  <div className="welcome-quick-card-icon">
                    <Icon />
                  </div>
                  <div className="welcome-quick-card-label">{item.label}</div>
                </button>
              )
            })}
          </div>

          <div className="welcome-cta">
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={onNewSession}
            >
              新建会话
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WelcomeScreen
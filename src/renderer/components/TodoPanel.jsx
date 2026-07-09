import React, { useState, useEffect } from 'react'
import { Card, Progress, Tag, Space, Typography } from 'antd'
import {
  CheckCircleOutlined,
  LoadingOutlined,
  BorderOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'

const { Text } = Typography

// 优先级映射：颜色 + 中文标签
const PRIORITY_COLOR = { high: 'red', medium: 'orange', low: 'default' }
const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' }

/**
 * 单个 todo 的状态图标
 * - completed: 绿色实心对勾
 * - in_progress: 蓝色旋转 loading 图标
 * - pending: 灰色空心边框
 */
const StatusIcon = ({ status }) => {
  if (status === 'completed') {
    return <CheckCircleOutlined style={{ color: 'var(--color-success, #34C759)' }} />
  }
  if (status === 'in_progress') {
    return <LoadingOutlined style={{ color: 'var(--color-primary, #0071e3)' }} spin />
  }
  return <BorderOutlined style={{ color: 'var(--color-text-secondary, #999)' }} />
}

/**
 * TodoPanel — LLM 计划实时面板
 *
 * 数据来源：
 * - mount 时调 `todo.list(sessionId)` 拉一次兜底数据
 * - 订阅 `todo:updated` 事件，收到后按 sessionId 过滤 + 更新本地状态
 *
 * Props:
 * - sessionId: 当前会话 ID（必填，实时模式）
 * - readOnly: 只读模式（用于消息内历史快照展示，不订阅事件）
 * - snapshot: 只读模式的快照数据 { todos, summary: { total, completed } }
 *
 * 视觉：进度条 + 列表 + 状态可视化，让用户"看着 LLM 一项项推进"
 */
const TodoPanel = ({ sessionId, readOnly = false, snapshot = null }) => {
  const [todos, setTodos] = useState([])
  const [summary, setSummary] = useState({ total: 0, completed: 0 })
  const [collapsed, setCollapsed] = useState(false)

  // 只读模式：直接用 snapshot 数据
  useEffect(() => {
    if (readOnly && snapshot) {
      setTodos(snapshot.todos || [])
      setSummary(snapshot.summary || { total: 0, completed: 0 })
    }
  }, [readOnly, snapshot])

  // 初始拉取 + 每次 sessionId 变化重新拉（仅实时模式）
  useEffect(() => {
    if (readOnly || !sessionId || !window.electronAPI?.todo) return
    let cancelled = false
    window.electronAPI.todo.list(sessionId).then(res => {
      if (cancelled) return
      if (res?.success) {
        setTodos(res.todos || [])
        setSummary({ total: res.total || 0, completed: res.completed || 0 })
      }
    }).catch(() => { /* 拉取失败静默忽略，订阅通道仍可用 */ })
    return () => { cancelled = true }
  }, [sessionId, readOnly])

  // 订阅实时更新（仅实时模式）
  useEffect(() => {
    if (readOnly || !sessionId || !window.electronAPI?.todo) return
    const listenerId = window.electronAPI.todo.onUpdate((payload) => {
      if (!payload || payload.sessionId !== sessionId) return
      setTodos(payload.todos || [])
      setSummary({ total: payload.total || 0, completed: payload.completed || 0 })
    })
    return () => {
      try { window.electronAPI.todo.removeUpdateListener(listenerId) } catch (_) {}
    }
  }, [sessionId, readOnly])

  // 空态：LLM 还没调 todo_manage 时不渲染面板
  if (!todos || todos.length === 0) return null

  // 实时模式：全部完成时隐藏面板（快照已留在消息内）
  if (!readOnly && summary.total > 0 && summary.completed === summary.total) return null

  const percent = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0

  return (
    <Card
      size="small"
      style={{
        marginBottom: 8,
        maxWidth: 480,
        borderColor: 'var(--color-primary, #0071e3)'
      }}
      bodyStyle={{ padding: '8px 12px' }}
    >
      {/* 标题栏 + 折叠按钮 */}
      <Space
        style={{ width: '100%', justifyContent: 'space-between', cursor: 'pointer' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Space size={6}>
          <UnorderedListOutlined style={{ color: 'var(--color-primary, #0071e3)' }} />
          <Text strong style={{ fontSize: 13 }}>LLM 计划 ({summary.completed}/{summary.total})</Text>
        </Space>
        {collapsed
          ? <CaretRightOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary, #999)' }} />
          : <CaretDownOutlined style={{ fontSize: 10, color: 'var(--color-text-secondary, #999)' }} />
        }
      </Space>

      {/* 进度条 */}
      <Progress
        percent={percent}
        size="small"
        showInfo={false}
        style={{ margin: '4px 0 6px 0' }}
      />

      {/* 列表 */}
      {!collapsed && (
        <div style={{ marginTop: 2 }}>
          {todos.map(todo => {
            const isCompleted = todo.status === 'completed'
            const isInProgress = todo.status === 'in_progress'
            return (
              <div
                key={todo.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 0',
                  opacity: isCompleted ? 0.55 : 1,
                  background: isInProgress ? 'rgba(0, 113, 227, 0.04)' : 'transparent',
                  borderRadius: 3
                }}
              >
                <StatusIcon status={todo.status} />
                <Text
                  style={{
                    fontSize: 13,
                    flex: 1,
                    textDecoration: isCompleted ? 'line-through' : 'none',
                    color: isInProgress
                      ? 'var(--color-primary, #0071e3)'
                      : 'var(--color-text-body, #333)'
                  }}
                >
                  {todo.content}
                </Text>
                {todo.priority && (
                  <Tag
                    color={PRIORITY_COLOR[todo.priority]}
                    style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 6px' }}
                  >
                    {PRIORITY_LABEL[todo.priority]}
                  </Tag>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

export default TodoPanel
import React, { useState, useEffect } from 'react'
import { Button, List, Typography, Space, Tabs, Popconfirm, Layout, Dropdown, Modal, Input, message } from 'antd'
import { HistoryOutlined, PlusOutlined, DeleteOutlined, RobotOutlined, FolderOpenOutlined, MoreOutlined, EditOutlined } from '@ant-design/icons'
import { useAgentStore } from './AgentStore'
import { createSession, switchSession, loadSessionList } from './agentActions'

const { Text } = Typography
const { Sider } = Layout

/** 将时间差转为可读相对时间（如 "1 周"、"3 天"、"2 小时"） */
function relativeTime(dateStr) {
  if (!dateStr) return ''
  const now = Date.now()
  const dt = new Date(dateStr).getTime()
  if (isNaN(dt)) return ''
  const diff = now - dt
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天`
  const weeks = Math.floor(days / 7)
  return `${weeks} 周`
}

/**
 * MemorySidebar - 记忆管理侧栏（v2.15b 按工作区分组）
 * - 从 agent:listSessionsGrouped 获取分组数据
 * - 按工作区折叠分组渲染
 * - 保留新建/切换/删除会话功能
 *
 * Props:
 * - onToggle: 关闭侧栏按钮的回调
 */
const MemorySidebar = ({ onToggle }) => {
  const { state, dispatch } = useAgentStore()
  const sessions = state.session.list
  const currentSessionId = state.session.currentId

  const [sidebarTab, setSidebarTab] = useState('history')
  const [groupedData, setGroupedData] = useState({ workspaces: [], unclassified: [] })

  // 获取按工作区分组的会话列表
  const fetchGroupedSessions = async () => {
    try {
      const result = await window.electronAPI.invoke('agent:listSessionsGrouped')
      if (result) {
        setGroupedData(result)
      }
    } catch (err) {
      console.warn('[MemorySidebar] 获取分组会话列表失败:', err)
    }
  }

  // 初始加载 + sessions 列表变化时刷新
  useEffect(() => {
    fetchGroupedSessions()
  }, [sessions.length])

  const handleNewSession = () => {
    createSession({ dispatch })
  }

  const handleLoadSession = (sessionId) => {
    switchSession({ dispatch, sessionId })
  }

  const handleDeleteSession = async (sessionId) => {
    await window.electronAPI.invoke('agent:deleteSession', { sessionId })
    await loadSessionList({ dispatch })
    if (sessionId === currentSessionId) {
      handleNewSession()
    }
  }

  const handleRenameSession = (sessionId, currentName) => {
    let inputValue = currentName || ''
    let modalInstance = null

    const handleOk = async () => {
      const trimmedName = inputValue.trim()
      if (!trimmedName) {
        message.warning('会话名称不能为空')
        return
      }
      if (trimmedName === (currentName || '').trim()) {
        message.info('名称未改变')
        return
      }
      try {
        await window.electronAPI.invoke('agent:renameSession', {
          sessionId,
          sessionName: trimmedName
        })
        await loadSessionList({ dispatch })
        // 同时刷新分组数据
        await fetchGroupedSessions()
        message.success('重命名成功')
      } catch (err) {
        console.error('重命名失败:', err)
        message.error('重命名失败: ' + err.message)
      }
    }

    modalInstance = Modal.confirm({
      title: '重命名会话',
      content: (
        <div>
          <p>请输入新的会话名称：</p>
          <Input
            defaultValue={currentName}
            autoFocus
            onChange={e => { inputValue = e.target.value }}
            onPressEnter={() => {
              modalInstance && modalInstance.destroy()
              handleOk()
            }}
            placeholder="输入会话名称"
          />
        </div>
      ),
      okText: '确认',
      cancelText: '取消',
      onOk: handleOk
    })
  }

  const { workspaces, unclassified } = groupedData

  return (
    <Sider width="28%" style={{
      background: 'var(--color-surface, #fff)',
      borderRight: '1px solid var(--color-border)',
      overflow: 'auto',
      padding: 'var(--space-md, 16px)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 14 }}><HistoryOutlined /> 记忆管理</Text>
        <Space>
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={handleNewSession} title="新建对话" />
          {onToggle && (
            <Button size="small" type="text" onClick={onToggle} title="关闭侧栏">×</Button>
          )}
        </Space>
      </div>

      <Tabs
        size="small"
        activeKey={sidebarTab}
        onChange={setSidebarTab}
        items={[
          {
            key: 'history',
            label: '对话',
            children: (workspaces.length === 0 && unclassified.length === 0) ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Text type="secondary">暂无对话记录</Text>
              </div>
            ) : (
              <div>
                {/* 项目标题 — 参考样例2.png 灰色小字 */}
                <div style={{
                  color: 'var(--color-text-tertiary, #999)',
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 8,
                  paddingLeft: 4,
                  textTransform: 'uppercase',
                  letterSpacing: 1
                }}>
                  项目
                </div>

                {/* 按工作区分组渲染 */}
                {workspaces.map(ws => (
                  <div key={ws.path} style={{ marginBottom: 12 }}>
                    {/* 工作区组头：文件夹图标 + basename */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px 4px 6px 4px',
                      color: 'var(--color-text, #333)',
                      fontWeight: 600,
                      fontSize: 13
                    }}>
                      <FolderOpenOutlined style={{ marginRight: 6, color: 'var(--color-primary, #1890ff)' }} />
                      <Text ellipsis style={{ fontSize: 13, fontWeight: 600 }}>{ws.basename}</Text>
                    </div>

                    {/* 该工作区下的会话列表（缩进） */}
                    {ws.sessions.map(s => (
                      <List.Item
                        key={s.sessionId || `${ws.path}-${Math.random()}`}
                        style={{
                          cursor: 'pointer',
                          background: s.sessionId === currentSessionId ? 'var(--color-border)' : 'transparent',
                          padding: '4px 8px 4px 24px',
                          borderRadius: 4,
                          border: 'none'
                        }}
                        onClick={() => handleLoadSession(s.sessionId)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <Space size={6}>
                            <RobotOutlined style={{ fontSize: 11, color: 'var(--color-text-secondary)' }} />
                            <Text style={{ fontSize: 12, maxWidth: 160 }} ellipsis={{ tooltip: s.title || s.sessionId }}>
                              {s.title || (s.sessionId ? s.sessionId.substring(0, 8) : '未命名')}
                            </Text>
                          </Space>
                          <Space size={4}>
                            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                              {relativeTime(s.lastActivity)}
                            </Text>
                            <Dropdown
                              menu={{
                                items: [
                                  {
                                    key: 'rename',
                                    label: '重命名',
                                    icon: <EditOutlined />,
                                    onClick: () => handleRenameSession(s.sessionId, s.title)
                                  },
                                  {
                                    key: 'delete',
                                    label: '删除',
                                    icon: <DeleteOutlined />,
                                    danger: true,
                                    onClick: () => handleDeleteSession(s.sessionId)
                                  }
                                ]
                              }}
                              trigger={['click']}
                            >
                              <Button
                                size="small"
                                type="text"
                                icon={<MoreOutlined />}
                                onClick={e => e.stopPropagation()}
                              />
                            </Dropdown>
                          </Space>
                        </div>
                      </List.Item>
                    ))}
                  </div>
                ))}

                {/* v4.10.0.1 (fix): 渲染 unclassified — workspacePath=null 的旧 session（v4.9.x 时代） */}
                {unclassified.length > 0 && (
                  <div key="__unclassified" style={{ marginBottom: 12 }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px 4px 6px 4px',
                      color: 'var(--color-text-tertiary, #999)',
                      fontWeight: 600,
                      fontSize: 13
                    }}>
                      <FolderOpenOutlined style={{ marginRight: 6 }} />
                      <Text ellipsis style={{ fontSize: 13, fontWeight: 600 }}>未分类（v4.9.x 旧数据）</Text>
                    </div>
                    {unclassified.map(s => (
                      <List.Item
                        key={s.sessionId || `unclassified-${Math.random()}`}
                        style={{
                          cursor: 'pointer',
                          background: s.sessionId === currentSessionId ? 'var(--color-border)' : 'transparent',
                          padding: '4px 8px 4px 24px',
                          borderRadius: 4,
                          border: 'none'
                        }}
                        onClick={() => handleLoadSession(s.sessionId)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <Space size={6}>
                            <RobotOutlined style={{ fontSize: 11, color: 'var(--color-text-secondary)' }} />
                            <Text style={{ fontSize: 12, maxWidth: 160 }} ellipsis={{ tooltip: s.title || s.sessionId }}>
                              {s.title || (s.sessionId ? s.sessionId.substring(0, 8) : '未命名')}
                            </Text>
                          </Space>
                          <Space size={4}>
                            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                              {relativeTime(s.lastActivity)}
                            </Text>
                            <Dropdown
                              menu={{
                                items: [
                                  {
                                    key: 'rename',
                                    label: '重命名',
                                    icon: <EditOutlined />,
                                    onClick: () => handleRenameSession(s.sessionId, s.title)
                                  },
                                  {
                                    key: 'delete',
                                    label: '删除',
                                    icon: <DeleteOutlined />,
                                    danger: true,
                                    onClick: () => handleDeleteSession(s.sessionId)
                                  }
                                ]
                              }}
                              trigger={['click']}
                            >
                              <Button
                                size="small"
                                type="text"
                                icon={<MoreOutlined />}
                                onClick={e => e.stopPropagation()}
                              />
                            </Dropdown>
                          </Space>
                        </div>
                      </List.Item>
                    ))}
                  </div>
                )}
              </div>
            )
          }
        ]}
      />

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 8 }}>
        <Button size="small" danger block icon={<DeleteOutlined />} onClick={async () => {
          if (confirm('确定清空全部对话历史？')) {
            await window.electronAPI.invoke('agent:clearAllMemory')
            handleNewSession()
          }
        }}>清空全部对话</Button>
      </div>
    </Sider>
  )
}

export default MemorySidebar

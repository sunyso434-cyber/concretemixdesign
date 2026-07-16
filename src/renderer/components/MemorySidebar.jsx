import React, { useState, useEffect } from 'react'
import { Button, List, Typography, Space, Tabs, Popconfirm, Layout, Dropdown, Modal, Input, message } from 'antd'
import { HistoryOutlined, PlusOutlined, DeleteOutlined, RobotOutlined, FolderOpenOutlined, MoreOutlined, EditOutlined, FolderOutlined, DesktopOutlined, FileTextOutlined, FileOutlined, SwapOutlined, CopyOutlined } from '@ant-design/icons'
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

/** 会话标题 fallback：从 sessionId（格式 session-{timestamp}-{random}）提取时间戳生成可读名称 */
function formatSessionFallback(sid) {
  if (!sid) return '未命名'
  const match = sid.match(/^session-(\d+)-/)
  if (match) {
    const ts = parseInt(match[1], 10)
    if (!isNaN(ts)) {
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      return `对话 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  }
  return '未命名'
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
  const [renameModal, setRenameModal] = useState({ open: false, sessionId: null, value: '' })
  const [workspaceRenameModal, setWorkspaceRenameModal] = useState({ open: false, path: null, basename: '', value: '' })
  // 工作区文件树视图：{ [path]: { showFiles: bool, files: [], loading: bool } }
  const [wsFileView, setWsFileView] = useState({})
  // 工作区会话折叠：{ [path]: true } 表示展开；缺省/false 表示折叠（默认只显示前 3 条）
  const [expandedWs, setExpandedWs] = useState({})
  const SESSION_COLLAPSE_LIMIT = 3

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

  // 切换工作区视图：文件树 / 会话列表
  const toggleWsFileView = async (wsPath) => {
    const current = wsFileView[wsPath] || { showFiles: false, files: [], loading: false }
    const newShowFiles = !current.showFiles
    if (newShowFiles && current.files.length === 0) {
      // 首次切到文件树，加载文件列表
      setWsFileView(prev => ({ ...prev, [wsPath]: { ...current, showFiles: true, loading: true } }))
      try {
        const result = await window.electronAPI.workspace.listFiles('root', { workspacePath: wsPath })
        setWsFileView(prev => ({ ...prev, [wsPath]: { showFiles: true, files: result?.files || [], loading: false } }))
      } catch (err) {
        console.warn('[MemorySidebar] 加载文件树失败:', err)
        setWsFileView(prev => ({ ...prev, [wsPath]: { showFiles: true, files: [], loading: false } }))
      }
    } else {
      setWsFileView(prev => ({ ...prev, [wsPath]: { ...current, showFiles: newShowFiles } }))
    }
  }

  // 初始加载 + sessions 列表变化时刷新
  useEffect(() => {
    fetchGroupedSessions()
  }, [sessions.length])

  // 监听后端会话标题更新事件，刷新分组列表
  useEffect(() => {
    if (!window.electronAPI?.on) return
    const listenerId = window.electronAPI.on('agent:sessionUpdated', () => {
      fetchGroupedSessions()
    })
    return () => {
      if (window.electronAPI?.removeListener && listenerId) {
        window.electronAPI.removeListener(listenerId)
      }
    }
  }, [])

  const handleNewSession = () => {
    createSession({ dispatch })
    // v9.0.0 补充21：从侧栏新建会话后回到欢迎页（欢迎页可看到新建的会话卡片浮现）
    dispatch({ type: 'SET_WELCOME_VISIBLE', payload: true })
  }

  const handleLoadSession = async (sessionId, sessionWorkspacePath) => {
    try {
      // 如果目标会话属于不同工作区，先切换工作区
      if (sessionWorkspacePath) {
        const current = await window.electronAPI.workspace.current()
        if (current?.path && current.path !== sessionWorkspacePath) {
          await window.electronAPI.workspace.open(sessionWorkspacePath)
        }
      }
      await switchSession({ dispatch, sessionId, state })
    } catch (err) {
      message.error('切换会话失败: ' + err.message)
    }
  }

  const handleDeleteSession = (sessionId) => {
    Modal.confirm({
      title: '确认删除会话？',
      content: '删除后无法恢复，该会话下的所有消息也将被清除。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await window.electronAPI.invoke('agent:deleteSession', { sessionId })
        await loadSessionList({ dispatch })
        if (sessionId === currentSessionId) {
          handleNewSession()
        }
      }
    })
  }

  const handleDuplicateSession = async (sessionId) => {
    try {
      const result = await window.electronAPI.invoke('agent:duplicateSession', { sessionId })
      if (result.success) {
        message.success('会话已复制')
        await loadSessionList({ dispatch })
        await switchSession({ dispatch, sessionId: result.sessionId, state })
      }
    } catch (err) {
      message.error('复制会话失败: ' + err.message)
    }
  }

  const openRenameModal = (sessionId, currentName) => {
    setRenameModal({ open: true, sessionId, value: currentName || '' })
  }

  const closeRenameModal = () => {
    setRenameModal({ open: false, sessionId: null, value: '' })
  }

  const submitRename = async () => {
    const trimmedName = renameModal.value.trim()
    if (!trimmedName) {
      message.warning('会话名称不能为空')
      return false
    }
    try {
      await window.electronAPI.invoke('agent:renameSession', {
        sessionId: renameModal.sessionId,
        sessionName: trimmedName
      })
      closeRenameModal()
      await loadSessionList({ dispatch })
      await fetchGroupedSessions()
      message.success('重命名成功')
      return true
    } catch (err) {
      console.error('重命名失败:', err)
      message.error('重命名失败: ' + err.message)
      return false
    }
  }

  const openWorkspaceRenameModal = (wsPath, basename) => {
    setWorkspaceRenameModal({ open: true, path: wsPath, basename, value: basename || '' })
  }

  const closeWorkspaceRenameModal = () => {
    setWorkspaceRenameModal({ open: false, path: null, basename: '', value: '' })
  }

  const submitWorkspaceRename = async () => {
    const trimmedName = workspaceRenameModal.value.trim()
    if (!trimmedName) {
      message.warning('工作区名称不能为空')
      return false
    }
    try {
      const result = await window.electronAPI.invoke('workspace:rename', {
        oldPath: workspaceRenameModal.path,
        newName: trimmedName
      })
      closeWorkspaceRenameModal()
      await fetchGroupedSessions()
      if (result?.success && result?.newPath) {
        message.success('工作区重命名成功')
      }
      return true
    } catch (err) {
      console.error('工作区重命名失败:', err)
      message.error('工作区重命名失败: ' + err.message)
      return false
    }
  }

  const { workspaces, unclassified } = groupedData

  return (
    <Sider width={260} style={{
      background: 'var(--bg-primary, #fff)',
      borderRight: '1px solid var(--border-color)',
      overflow: 'auto',
      padding: '12px 8px'
    }}>
      <div className="v9-sidebar-header">
        <span className="v9-sidebar-title">历史会话</span>
        <Space size={0}>
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
                {/* 项目标题 */}
                <div className="v9-conv-group-label">
                  项目
                </div>

                {/* 按工作区分组渲染 */}
                {workspaces.map(ws => {
                  const fileView = wsFileView[ws.path] || { showFiles: false, files: [], loading: false }
                  return (
                  <div key={ws.path} className="v9-conv-group">
                    {/* 工作区组头 — 含会话数量徽章 + 三个点菜单 */}
                    <div className="v9-conv-group-header">
                      <FolderOpenOutlined style={{ marginRight: 6, color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      <Text ellipsis style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{ws.basename}</Text>
                      <span className="v9-conv-group-count">{fileView.showFiles ? (fileView.files.length) : (ws.sessions.length)}</span>
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'toggle-view',
                              label: fileView.showFiles ? '显示会话' : '显示文件树',
                              icon: <SwapOutlined />,
                              onClick: () => toggleWsFileView(ws.path)
                            },
                            {
                              key: 'open-explorer',
                              label: '在资源管理器中打开',
                              icon: <DesktopOutlined />,
                              onClick: async () => {
                                if (!ws.path) return
                                try {
                                  const result = await window.electronAPI.workspace.openInExplorer(ws.path)
                                  if (!result?.success) {
                                    message.error('打开失败：' + (result?.error || '未知错误'))
                                  }
                                } catch (err) {
                                  message.error('打开失败：' + err.message)
                                }
                              }
                            },
                            {
                              key: 'rename-ws',
                              label: '重命名工作区',
                              icon: <EditOutlined />,
                              onClick: () => openWorkspaceRenameModal(ws.path, ws.basename)
                            },
                            { type: 'divider' },
                            {
                              key: 'remove-ws',
                              label: '移除工作区',
                              icon: <DeleteOutlined />,
                              danger: true,
                              onClick: async () => {
                                try {
                                  await window.electronAPI.invoke('workspace:remove', { path: ws.path })
                                  await fetchGroupedSessions()
                                  message.success('已移除工作区')
                                } catch (err) {
                                  message.error('移除失败: ' + err.message)
                                }
                              }
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
                          className="v9-ws-more"
                        />
                      </Dropdown>
                    </div>

                    {/* 文件树视图 或 会话列表 */}
                    {fileView.showFiles ? (
                      <div className="v9-file-tree">
                        {fileView.loading ? (
                          <div style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>加载中...</div>
                        ) : fileView.files.length === 0 ? (
                          <div style={{ padding: '8px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>暂无文件</div>
                        ) : (
                          fileView.files.map((f, idx) => (
                            <div key={idx} className="v9-file-tree-item">
                              {f.isDir ? <FolderOutlined /> : <FileOutlined />}
                              <span className="v9-file-tree-name">{f.name}</span>
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                    <>
                    {/* 该工作区下的会话列表（默认只显示前 3 条，其余折叠） */}
                    {(expandedWs[ws.path] ? ws.sessions : ws.sessions.slice(0, SESSION_COLLAPSE_LIMIT)).map(s => (
                      <List.Item
                        key={s.sessionId || `${ws.path}-${Math.random()}`}
                        className={`v9-conv-item ${s.sessionId === currentSessionId ? 'active' : ''}`}
                        style={{
                          cursor: 'pointer',
                          padding: '8px 10px 8px 24px',
                          border: 'none'
                        }}
                        onClick={() => handleLoadSession(s.sessionId, ws.path)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <Space size={6}>
                            <RobotOutlined style={{ fontSize: 11, color: 'var(--text-tertiary)' }} />
                            <Text style={{ fontSize: 12, maxWidth: 140 }} ellipsis={{ tooltip: s.sessionName || formatSessionFallback(s.sessionId) }}>
                              {s.sessionName || formatSessionFallback(s.sessionId)}
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
                                    onClick: () => openRenameModal(s.sessionId, s.sessionName)
                                  },
                                  {
                                    key: 'duplicate',
                                    label: '复制会话',
                                    icon: <CopyOutlined />,
                                    onClick: () => handleDuplicateSession(s.sessionId)
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
                    {ws.sessions.length > SESSION_COLLAPSE_LIMIT && (
                      <div
                        className="v9-conv-collapse-toggle"
                        style={{
                          cursor: 'pointer',
                          padding: '4px 10px 4px 24px',
                          fontSize: 12,
                          color: 'var(--text-tertiary)'
                        }}
                        onClick={() => setExpandedWs(prev => ({ ...prev, [ws.path]: !prev[ws.path] }))}
                      >
                        {expandedWs[ws.path]
                          ? '收起 ▴'
                          : `展开剩余 ${ws.sessions.length - SESSION_COLLAPSE_LIMIT} 条 ▾`}
                      </div>
                    )}
                    </>
                    )}
                  </div>
                  )
                })}

                {/* v4.10.0.1 (fix): 渲染 unclassified — workspacePath=null 的旧 session（v4.9.x 时代） */}
                {unclassified.length > 0 && (
                  <div key="__unclassified" className="v9-conv-group">
                    <div className="v9-conv-group-header">
                      <FolderOpenOutlined style={{ marginRight: 6, color: 'var(--text-tertiary)' }} />
                      <Text ellipsis style={{ fontSize: 13, fontWeight: 600 }}>未分类（v4.9.x 旧数据）</Text>
                    </div>
                    {unclassified.map(s => (
                      <List.Item
                        key={s.sessionId || `unclassified-${Math.random()}`}
                        className={`v9-conv-item ${s.sessionId === currentSessionId ? 'active' : ''}`}
                        style={{
                          cursor: 'pointer',
                          padding: '8px 10px 8px 24px',
                          border: 'none'
                        }}
                        onClick={() => handleLoadSession(s.sessionId, null)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <Space size={6}>
                            <RobotOutlined style={{ fontSize: 11, color: 'var(--color-text-secondary)' }} />
                            <Text style={{ fontSize: 12, maxWidth: 160 }} ellipsis={{ tooltip: s.sessionName || formatSessionFallback(s.sessionId) }}>
                              {s.sessionName || formatSessionFallback(s.sessionId)}
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
                                    onClick: () => openRenameModal(s.sessionId, s.sessionName)
                                  },
                                  {
                                    key: 'duplicate',
                                    label: '复制会话',
                                    icon: <CopyOutlined />,
                                    onClick: () => handleDuplicateSession(s.sessionId)
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

      {/* 重命名对话框 */}
      <Modal
        title="重命名会话"
        open={renameModal.open}
        onOk={submitRename}
        onCancel={closeRenameModal}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <p>请输入新的会话名称：</p>
        <Input
          value={renameModal.value}
          onChange={e => setRenameModal(prev => ({ ...prev, value: e.target.value }))}
          onPressEnter={submitRename}
          placeholder="输入会话名称"
          autoFocus
          maxLength={50}
        />
      </Modal>

      {/* 重命名工作区对话框 */}
      <Modal
        title="重命名工作区"
        open={workspaceRenameModal.open}
        onOk={submitWorkspaceRename}
        onCancel={closeWorkspaceRenameModal}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <p>请输入新的工作区名称：</p>
        <Input
          value={workspaceRenameModal.value}
          onChange={e => setWorkspaceRenameModal(prev => ({ ...prev, value: e.target.value }))}
          onPressEnter={submitWorkspaceRename}
          placeholder="输入工作区名称"
          autoFocus
          maxLength={100}
        />
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
          原路径：{workspaceRenameModal.path}
        </p>
      </Modal>
    </Sider>
  )
}

export default MemorySidebar

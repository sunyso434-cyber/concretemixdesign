import React, { useState } from 'react'
import { Button, List, Typography, Space, Tabs, Popconfirm, Layout } from 'antd'
import { HistoryOutlined, PlusOutlined, DeleteOutlined, RobotOutlined } from '@ant-design/icons'
import { useAgentStore } from './AgentStore'
import { createSession, switchSession, loadSessionList } from './agentActions'

const { Text } = Typography
const { Sider } = Layout

/**
 * MemorySidebar - 记忆管理侧栏（精简版）
 * - state 全部从 useAgentStore() 读取
 * - 新建/切换/刷新会话通过 agentActions
 * - 仅保留"对话历史" Tab（偏好/修正由 agent.md 取代）
 *
 * Props:
 * - onToggle: 关闭侧栏按钮的回调
 */
const MemorySidebar = ({ onToggle }) => {
  const { state, dispatch } = useAgentStore()
  const sessions = state.session.list
  const currentSessionId = state.session.currentId

  const [sidebarTab, setSidebarTab] = useState('history')

  const handleNewSession = () => {
    // agentActions.createSession 内部已 dispatch CLEAR_MESSAGES + SET_SESSION_ID + RESET_AGENT
    createSession({ dispatch })
  }

  const handleLoadSession = (sessionId) => {
    switchSession({ dispatch, sessionId })
  }

  const handleDeleteSession = async (sessionId) => {
    await window.electronAPI.invoke('agent:deleteSession', { sessionId })
    await loadSessionList({ dispatch })
    // 如果删的是当前会话，自动开新会话（避免 messages 还停留在已删除会话上）
    if (sessionId === currentSessionId) {
      handleNewSession()
    }
  }

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
            children: sessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Text type="secondary">暂无对话记录</Text>
              </div>
            ) : (
              <List size="small" dataSource={sessions}
                renderItem={s => (
                  <List.Item style={{
                    cursor: 'pointer',
                    background: s.sessionId === currentSessionId ? 'var(--color-border)' : 'transparent',
                    padding: '4px 8px', borderRadius: 4
                  }}
                    onClick={() => handleLoadSession(s.sessionId)}
                    actions={[
                      <Popconfirm key="del" title="删除此对话？" onConfirm={async (e) => {
                        e?.stopPropagation?.()
                        await handleDeleteSession(s.sessionId)
                      }}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                      </Popconfirm>
                    ]}
                  >
                    <Space>
                      <RobotOutlined style={{ fontSize: 12, color: 'var(--color-text-secondary)' }} />
                      <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: s.sessionName || new Date(s.lastActivity).toLocaleString('zh-CN') }}>
                        {s.sessionName || `未命名对话 ${new Date(s.lastActivity).toLocaleString('zh-CN')}`}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
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

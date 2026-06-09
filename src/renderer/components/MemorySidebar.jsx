import React, { useState } from 'react'
import { Button, List, Typography, Space, Tabs, Descriptions, Popconfirm, Layout } from 'antd'
import { HistoryOutlined, PlusOutlined, DeleteOutlined, RobotOutlined } from '@ant-design/icons'
import { useAgentStore } from './AgentStore'
import { createSession, switchSession, loadSessionList } from './agentActions'

const { Text } = Typography
const { Sider } = Layout

/**
 * MemorySidebar - 记忆管理侧栏
 * - state 全部从 useAgentStore() 读取（不再 props 透传）
 * - 新建/切换/刷新会话通过 agentActions
 * - 保留所有原有功能: 3 Tabs(对话/偏好/修正) + 删除会话 + 清空全部记忆
 *
 * Props:
 * - onToggle: 关闭侧栏按钮的回调（折叠到 IconButton）
 */
const MemorySidebar = ({ onToggle }) => {
  const { state, dispatch } = useAgentStore()
  const sessions = state.session.list
  const currentSessionId = state.session.currentId

  const [sidebarTab, setSidebarTab] = useState('history')
  const [preferences, setPreferences] = useState({})
  const [corrections, setCorrections] = useState([])

  const loadPreferences = () => {
    window.electronAPI.invoke('agent:getPreferences')
      .then(r => { if (r?.preferences) setPreferences(r.preferences) })
      .catch(() => {})
  }

  const loadCorrections = () => {
    window.electronAPI.invoke('agent:getCorrections')
      .then(r => { if (r?.corrections) setCorrections(r.corrections) })
      .catch(() => {})
  }

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
        onChange={key => { setSidebarTab(key); if (key === 'prefs') loadPreferences(); if (key === 'corrections') loadCorrections() }}
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
                      <Text style={{ fontSize: 12 }}>{new Date(s.lastActivity).toLocaleDateString()}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            )
          },
          {
            key: 'prefs',
            label: '偏好',
            children: Object.keys(preferences).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Text type="secondary">暂无偏好记录</Text>
                <br /><Text type="secondary" style={{ fontSize: 11 }}>AI 会根据你的使用习惯自动学习</Text>
              </div>
            ) : (
              <Descriptions size="small" column={1}>
                {Object.entries(preferences).map(([k, v]) => (
                  <Descriptions.Item key={k} label={k}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</Descriptions.Item>
                ))}
              </Descriptions>
            )
          },
          {
            key: 'corrections',
            label: '修正',
            children: corrections.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Text type="secondary">暂无修正记录</Text>
                <br /><Text type="secondary" style={{ fontSize: 11 }}>你修改 AI 建议后会自动记录</Text>
              </div>
            ) : (
              <List size="small" dataSource={corrections}
                renderItem={c => (
                  <List.Item
                    actions={[
                      <Popconfirm key="del" title="删除此修正？" onConfirm={async () => {
                        await window.electronAPI.invoke('agent:deleteCorrection', { id: c.id })
                        loadCorrections()
                      }}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    ]}
                  >
                    <div style={{ fontSize: 11 }}>
                      <Text type="secondary">原: {JSON.stringify(c.originalSuggestion).slice(0, 60)}</Text><br />
                      <Text style={{ color: 'var(--color-primary)' }}>改: {JSON.stringify(c.userCorrection).slice(0, 60)}</Text>
                    </div>
                  </List.Item>
                )}
              />
            )
          }
        ]}
      />

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 8 }}>
        <Button size="small" danger block icon={<DeleteOutlined />} onClick={async () => {
          if (confirm('确定清空全部记忆？（对话历史 + 偏好 + 修正记录）')) {
            await window.electronAPI.invoke('agent:clearAllMemory')
            handleNewSession()
          }
        }}>清空全部记忆</Button>
      </div>
    </Sider>
  )
}

export default MemorySidebar

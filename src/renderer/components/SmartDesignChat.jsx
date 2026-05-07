import React, { useState, useEffect, useRef } from 'react'
import { Button, Input, Space, Avatar, List, Alert, message, Typography } from 'antd'
import { SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, BulbOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import ToolCallBubble from './ToolCallBubble'
import MixDesignResultCard from './MixDesignResultCard'
import OptimizationResultCard from './OptimizationResultCard'
import MaterialCompareCard from './MaterialCompareCard'
import MaterialPicker from './MaterialPicker'
import DiagnosisResultCard from './DiagnosisResultCard'

const { Text } = Typography

const QUICK_PROMPTS = [
  { label: '帮我设计C30配合比', message: '帮我设计C30配合比，坍落度180mm' },
  { label: '优化成本', message: '帮我优化配合比成本，找到最便宜的材料组合' },
  { label: '对比材料', message: '帮我对比不同水泥对配合比的影响' },
]

const SmartDesignChat = () => {
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSaveFromCard = async (cardData) => {
    try {
      const bestSol = cardData.bestSolution || {}
      const saveData = {
        strengthGrade: cardData.strength,
        slump: cardData.slump,
        waterBinderRatio: cardData.waterRatio || bestSol.waterRatio,
        sandRatio: cardData.sandRatio || bestSol.sandRatio,
        status: 'AI生成'
      }
      await window.electronAPI.invoke('createMixDesign', saveData)
      message.success('方案已保存')
    } catch (error) {
      message.error('保存失败: ' + error.message)
    }
  }

  const handleMaterialConfirm = (selectedMaterials) => {
    const grouped = {}
    for (const mat of selectedMaterials) {
      if (!grouped[mat.type]) grouped[mat.type] = []
      grouped[mat.type].push(mat.name)
    }
    const parts = Object.entries(grouped).map(([type, names]) => `${type}：${names.join('、')}`)
    const msg = `我选择以下材料：${parts.join('；')}`
    setChatInput(msg)
  }

  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return

    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)

    try {
      const result = await window.electronAPI.invoke('aiAnalysis:chat', {
        message: userMessage,
        context: {}
      })

      const chatMsg = { role: 'assistant', content: result.reply, toolCalls: null }

      if (result.messages) {
        const toolMsgs = result.messages.filter(m => m.role === 'tool')
        for (const toolMsg of toolMsgs) {
          try {
            const parsed = JSON.parse(toolMsg.content)
            if (parsed.success && parsed.materials && parsed.materials.length > 0) {
              const materialType = parsed.materials[0]?.type
              if (materialType) {
                chatMsg.materialPicker = { materials: parsed.materials }
              }
            }
          } catch (_) { /* ignore */ }
        }
        if (toolMsgs.length > 0) {
          const lastToolResult = toolMsgs[toolMsgs.length - 1]
          try {
            const parsed = JSON.parse(lastToolResult.content)
            if (parsed.type) {
              chatMsg.toolCall = {
                status: parsed.success ? 'done' : 'error',
                type: parsed.type,
                data: parsed.data || parsed
              }
            }
          } catch (_) { /* ignore */ }
        }
      }

      setChatMessages(prev => [...prev, chatMsg])
    } catch (error) {
      message.error('发送消息失败: ' + error.message)
      setChatMessages(prev => prev.slice(0, -1))
    } finally {
      setChatLoading(false)
    }
  }

  const handleClearChat = async () => {
    try {
      await window.electronAPI.invoke('aiAnalysis:clearHistory')
      setChatMessages([])
      message.success('对话已清空')
    } catch (error) {
      console.error('清空对话失败:', error)
    }
  }

  const handleQuickPrompt = (msg) => {
    setChatInput(msg)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 500, height: 'calc(100vh - 240px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <RobotOutlined style={{ fontSize: 18, color: 'var(--color-primary)' }} />
          <Text strong style={{ fontSize: 16 }}>智能设计助手</Text>
        </Space>
        <Button
          icon={<ClearOutlined />}
          onClick={handleClearChat}
          disabled={chatMessages.length === 0}
          size="small"
        >
          清空对话
        </Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', marginBottom: 16 }}>
        {chatMessages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <BulbOutlined style={{ fontSize: 48, color: '#faad14', marginBottom: 16 }} />
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--color-text)' }}>智能设计助手</div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
              用自然语言描述你的需求，AI 将帮你完成配合比设计和优化
            </Text>
            <Space wrap>
              {QUICK_PROMPTS.map((item, i) => (
                <Button key={i} onClick={() => handleQuickPrompt(item.message)}>{item.label}</Button>
              ))}
            </Space>
          </div>
        ) : (
          <List
            dataSource={chatMessages}
            renderItem={(item) => (
              <List.Item className={item.role === 'user' ? 'chat-item-user' : 'chat-item-assistant'}>
                <Space align="start">
                  {item.role === 'assistant' && <Avatar icon={<RobotOutlined />} className="chat-avatar" />}
                  <div className={`chat-message ${item.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}>
                    {item.role === 'assistant' ? (
                      <>
                        {item.toolCall && item.toolCall.status === 'done' && (
                          <>
                            {item.toolCall.type === 'mix_design' && (
                              <MixDesignResultCard data={item.toolCall.data} onSave={handleSaveFromCard} />
                            )}
                            {item.toolCall.type === 'optimization' && (
                              <OptimizationResultCard data={item.toolCall.data} onSave={handleSaveFromCard} />
                            )}
                            {item.toolCall.type === 'material_compare' && (
                              <MaterialCompareCard data={item.toolCall.data} />
                            )}
                            {item.toolCall.type === 'parameter_diagnosis' && (
                              <DiagnosisResultCard data={item.toolCall.data} />
                            )}
                          </>
                        )}
                        {item.materialPicker && (
                          <MaterialPicker
                            materials={item.materialPicker.materials}
                            onConfirm={handleMaterialConfirm}
                          />
                        )}
                        {item.toolCall?.status === 'loading' && (
                          <ToolCallBubble status="loading" toolName={item.toolCall.type} />
                        )}
                        <div className="chat-markdown-body">
                          <ReactMarkdown>{item.content}</ReactMarkdown>
                        </div>
                      </>
                    ) : (
                      item.content
                    )}
                  </div>
                  {item.role === 'user' && <Avatar icon={<UserOutlined />} className="chat-avatar-user" />}
                </Space>
              </List.Item>
            )}
          />
        )}
        <div ref={chatEndRef} />
      </div>

      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder="输入你的需求，如：帮我设计C50泵送混凝土..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onPressEnter={handleSendChat}
          disabled={chatLoading}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSendChat}
          loading={chatLoading}
          disabled={!chatInput.trim()}
        >
          发送
        </Button>
      </Space.Compact>
    </div>
  )
}

export default SmartDesignChat

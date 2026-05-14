import React, { useState, useEffect, useRef } from 'react'
import { Button, Input, Space, Avatar, List, Alert, message, Typography, Upload, Tag } from 'antd'
import { SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, BulbOutlined, PaperClipOutlined, DeleteOutlined, FileTextOutlined, FileExcelOutlined, BarChartOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolCallBubble from './ToolCallBubble'
import MixDesignResultCard from './MixDesignResultCard'
import OptimizationResultCard from './OptimizationResultCard'
import MaterialCompareCard from './MaterialCompareCard'
import MaterialPicker from './MaterialPicker'
import DiagnosisResultCard from './DiagnosisResultCard'
import ComplianceResultCard from './ComplianceResultCard'
import { detectMixDesignDataInText, getAttachmentType, detectAnalysisModeIntent, processExcelAttachment, processMarkdownAttachment } from '../utils/attachmentHelper'
import { getAllMaterials } from '../services/MaterialService'
import { buildAnalysisData } from '../pages/AIAnalysisPage_Upload'

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
  const [pendingMaterialSelection, setPendingMaterialSelection] = useState(null)
  const [attachment, setAttachment] = useState(null)          // { file, type, name }
  const [analysisMode, setAnalysisMode] = useState(false)    // 是否处于分析模式
  const [analysisData, setAnalysisData] = useState(null)     // 分析模式的数据
  const [pendingMaterialPicker, setPendingMaterialPicker] = useState(null)  // 待选择的材料
  const [analysisResult, setAnalysisResult] = useState(null)  // 分析结果
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
    // 标记材料选择已完成，后续不再弹出选择器
    setPendingMaterialSelection(true)
  }

  // 进入分析模式
  const handleEnterAnalysisMode = async (attachment, userMessage) => {
    setAnalysisMode(true)
    setChatLoading(true)

    try {
      let mixDesigns = []
      let materialMapping = {}

      if (attachment) {
        // 处理附件
        if (attachment.type === 'xlsx') {
          const result = await processExcelAttachment(attachment.file)
          mixDesigns = result.mixDesigns
          materialMapping = result.materialMapping

          // 如果有未匹配的材料，提示用户
          if (result.unmatchedMaterials && result.unmatchedMaterials.size > 0) {
            setChatMessages(prev => [...prev, {
              role: 'assistant',
              content: `检测到 ${result.unmatchedMaterials.size} 种材料未能自动匹配，是否需要手动选择？`,
              options: ['手动选择材料', '继续分析']
            }])
            setPendingMaterialPicker({ mixDesigns, materialMapping })
            return
          }
        } else if (attachment.type === 'md') {
          const content = await processMarkdownAttachment(attachment.file)
          // 尝试从MD内容中解析配合比数据（简化处理）
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `已上传Markdown文件，内容长度${content.length}字符。需要进一步解析处理。`
          }])
          setChatLoading(false)
          return
        }
      } else if (userMessage) {
        // 从文本中检测配合比数据（需要后端解析）
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: '正在分析文本中的配合比数据...'
        }])
      }

      // 执行分析
      await executeAnalysis(mixDesigns, materialMapping)
    } catch (error) {
      message.error('进入分析模式失败: ' + error.message)
      setAnalysisMode(false)
      setChatLoading(false)
    }
  }

  // 执行AI分析
  const executeAnalysis = async (mixDesigns, materialMapping) => {
    try {
      const analysisReq = {
        mixDesigns,
        materialMapping,
        userMessage: chatInput
      }

      const result = await window.electronAPI.invoke('aiAnalysis:analyze', analysisReq)

      // 构建分析结果
      const analysisDataBuilt = buildAnalysisData(mixDesigns, materialMapping)
      setAnalysisData(analysisDataBuilt)

      // 解析AI返回结果
      let report = null
      try {
        if (result.reply) {
          // 尝试解析JSON格式的分析报告
          const jsonMatch = result.reply.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            report = JSON.parse(jsonMatch[0])
          }
        }
      } catch (e) {
        console.warn('解析分析报告失败:', e)
      }

      const chatMsg = {
        role: 'assistant',
        content: result.reply || '分析完成',
        analysisReport: report || { summary: '分析完成，请查看详细结果' }
      }

      setChatMessages(prev => [...prev, chatMsg])
      setAnalysisResult(report)
    } catch (error) {
      message.error('分析执行失败: ' + error.message)
    } finally {
      setChatLoading(false)
    }
  }

  // 分析模式后续追问
  const handleAnalysisFollowUp = async (userMessage) => {
    setChatLoading(true)

    try {
      // 将用户消息和问题一起发送给AI
      const context = {
        analysisData,
        analysisResult,
        mode: 'follow_up'
      }

      const result = await window.electronAPI.invoke('aiAnalysis:chat', {
        message: userMessage,
        context
      })

      const chatMsg = {
        role: 'assistant',
        content: result.reply
      }

      setChatMessages(prev => [...prev, chatMsg])
    } catch (error) {
      message.error('追问失败: ' + error.message)
    } finally {
      setChatLoading(false)
    }
  }

  // 设计模式处理（原有些逻辑）
  const handleDesignMode = async (userMessage) => {
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

      // 如果AI返回了分析意图，也显示在消息中
      if (result.intent === 'analysis_mode') {
        chatMsg.analysisIntent = true
      }

      setChatMessages(prev => [...prev, chatMsg])
    } catch (error) {
      message.error('发送消息失败: ' + error.message)
      setChatMessages(prev => prev.slice(0, -1))
    } finally {
      setChatLoading(false)
    }
  }

  // 发送聊天消息（分发到不同模式）
  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return

    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage, attachment: attachment ? { name: attachment.name, type: attachment.type } : null }])

    // 情况1：有附件，直接进入分析模式
    if (attachment) {
      await handleEnterAnalysisMode(attachment, userMessage)
      setAttachment(null)
      return
    }

    // 情况2：已经在分析模式，继续追问
    if (analysisMode) {
      await handleAnalysisFollowUp(userMessage)
      return
    }

    // 情况3：文本中检测到配合比数据
    if (detectMixDesignDataInText(userMessage) || detectAnalysisModeIntent(userMessage)) {
      await handleEnterAnalysisMode(null, userMessage)
      return
    }

    // 情况4：普通设计模式
    setChatLoading(true)
    await handleDesignMode(userMessage)
  }

  const handleClearChat = async () => {
    try {
      await window.electronAPI.invoke('aiAnalysis:clearHistory')
      setChatMessages([])
      setPendingMaterialSelection(null)
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
                            {item.toolCall.type === 'compliance_check' && (
                              <ComplianceResultCard data={item.toolCall.data} />
                            )}
                          </>
                        )}
                        {item.materialPicker && !pendingMaterialSelection && (
                          <MaterialPicker
                            materials={item.materialPicker.materials}
                            onConfirm={handleMaterialConfirm}
                          />
                        )}
                        {item.toolCall?.status === 'loading' && (
                          <ToolCallBubble status="loading" toolName={item.toolCall.type} />
                        )}
                        {item.analysisReport && (
                          <div className="analysis-report-wrapper">
                            <Alert type="info" showIcon icon={<BarChartOutlined />} message="分析报告已生成" style={{ marginBottom: 8 }} />
                            {item.analysisReport.materialInfluenceAnalysis && (
                              <div style={{ marginBottom: 8 }}>
                                <Text strong>材料影响分析：</Text>
                                <div style={{ fontSize: 12, color: '#666' }}>
                                  {item.analysisReport.materialInfluenceAnalysis.summary || '已完成'}
                                </div>
                              </div>
                            )}
                            {item.analysisReport.mixDesignInfluenceAnalysis && (
                              <div style={{ marginBottom: 8 }}>
                                <Text strong>配合比影响分析：</Text>
                                <div style={{ fontSize: 12, color: '#666' }}>
                                  {item.analysisReport.mixDesignInfluenceAnalysis.summary || '已完成'}
                                </div>
                              </div>
                            )}
                            {item.analysisReport.optimalMixDesignRecommendation && (
                              <div style={{ marginBottom: 8 }}>
                                <Text strong>最优配合比推荐：</Text>
                                <div style={{ fontSize: 12, color: '#666' }}>
                                  {Object.keys(item.analysisReport.optimalMixDesignRecommendation).length} 个推荐方案
                                </div>
                              </div>
                            )}
                            {item.analysisReport.adjustmentSuggestions && (
                              <div style={{ marginBottom: 8 }}>
                                <Text strong>调整建议：</Text>
                                <div style={{ fontSize: 12, color: '#666' }}>
                                  {item.analysisReport.adjustmentSuggestions.length || 0} 条建议
                                </div>
                              </div>
                            )}
                            {item.analysisReport.furtherTestSuggestions && (
                              <div style={{ fontSize: 12, color: '#888' }}>
                                <Text type="secondary">进一步测试建议：</Text>
                                {item.analysisReport.furtherTestSuggestions.summary || item.analysisReport.furtherTestSuggestions}
                              </div>
                            )}
                          </div>
                        )}
                        {item.options && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                            {item.options.map((opt, idx) => (
                              <Button key={idx} size="small" type="primary" onClick={() => {
                                if (opt === '手动选择材料' && pendingMaterialPicker) {
                                  setPendingMaterialSelection({ ...pendingMaterialPicker })
                                } else if (opt === '继续分析' && pendingMaterialPicker) {
                                  executeAnalysis(pendingMaterialPicker.mixDesigns, pendingMaterialPicker.materialMapping)
                                  setPendingMaterialPicker(null)
                                }
                              }}>
                                {opt}
                              </Button>
                            ))}
                          </div>
                        )}
                        <div className="chat-markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                        </div>
                      </>
                    ) : (
                      <>
                        {item.attachment && (
                          <Tag icon={item.attachment.type === 'xlsx' ? <FileExcelOutlined /> : <FileTextOutlined />} style={{ marginBottom: 8 }}>
                            {item.attachment.name}
                          </Tag>
                        )}
                        {item.content}
                      </>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Upload
          showUploadList={false}
          beforeUpload={(file) => {
            const type = getAttachmentType(file.name)
            if (type === 'unsupported') {
              message.error('仅支持Excel和Markdown文件')
              return false
            }
            setAttachment({ file, type, name: file.name })
            return false
          }}
        >
          <Button icon={<PaperClipOutlined />}>上传附件</Button>
        </Upload>
        {attachment && (
          <Tag
            icon={attachment.type === 'xlsx' ? <FileExcelOutlined /> : <FileTextOutlined />}
            closable
            onClose={() => setAttachment(null)}
            className="attachment-tag"
          >
            {attachment.name}
          </Tag>
        )}
        {analysisMode && (
          <Tag icon={<BarChartOutlined />} color="blue" className="analysis-mode-tag">
            分析模式
            <DeleteOutlined style={{ marginLeft: 4, cursor: 'pointer' }} onClick={() => {
              setAnalysisMode(false)
              setAnalysisData(null)
              setAnalysisResult(null)
              setPendingMaterialPicker(null)
            }} />
          </Tag>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          placeholder={analysisMode ? '输入你的追问，或继续对话...' : '输入你的需求，如：帮我设计C50泵送混凝土...'}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onPressEnter={handleSendChat}
          disabled={chatLoading}
          style={{ flex: 1 }}
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
      </div>
    </div>
  )
}

export default SmartDesignChat

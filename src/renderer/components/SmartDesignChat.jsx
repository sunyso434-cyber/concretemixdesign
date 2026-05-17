import React, { useState, useEffect, useRef } from 'react'
import { Button, Input, Space, Avatar, List, Alert, message, Typography, Upload, Tag, Checkbox } from 'antd'
import { SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, BulbOutlined, PlusOutlined, DeleteOutlined, FileTextOutlined, FileExcelOutlined, BarChartOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolCallBubble from './ToolCallBubble'
import MixDesignResultCard from './MixDesignResultCard'
import OptimizationResultCard from './OptimizationResultCard'
import MaterialCompareCard from './MaterialCompareCard'
import MaterialPicker from './MaterialPicker'
import DiagnosisResultCard from './DiagnosisResultCard'
import ComplianceResultCard from './ComplianceResultCard'
import { getAttachmentType, detectAnalysisModeIntent, processExcelAttachment, processMarkdownAttachment, filterMaterialsForUnmatched } from '../utils/attachmentHelper'
import { AnalysisReport } from '../pages/AIAnalysisPage_Results'
import { getAllMaterials } from '../services/MaterialService'
import { buildAnalysisData, MATERIAL_TYPE_MAP } from '../pages/AIAnalysisPage_Upload'

const { Text } = Typography

const ANALYSIS_RESULT_KEYS = [
  'materialInfluenceAnalysis',
  'mixDesignInfluenceAnalysis',
  'optimalMixDesignRecommendation',
  'adjustmentSuggestions',
  'furtherTestSuggestions',
  'comprehensiveEvaluation',
  'parameterDiagnosis',
]

/** 主进程 analyze 返回的是 parse 后的报告对象；兼容带 reply 字符串的旧形态 */
function extractAnalysisPayload(raw) {
  if (!raw || typeof raw !== 'object') return { report: null, textualReply: null }
  if (typeof raw.reply === 'string') {
    const reply = raw.reply.trim()
    try {
      const code = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = code ? code[1].trim() : (reply.match(/\{[\s\S]*\}/)?.[0] || reply)
      const report = JSON.parse(jsonStr)
      return { report, textualReply: reply }
    } catch {
      return { report: null, textualReply: reply }
    }
  }
  if (ANALYSIS_RESULT_KEYS.some(k => raw[k] != null)) {
    return { report: raw, textualReply: null }
  }
  return { report: null, textualReply: null }
}

const QUICK_PROMPTS = [
  { label: '帮我设计C30配合比', message: '帮我设计C30配合比，坍落度180mm' },
  { label: '优化成本', message: '帮我优化配合比成本，找到最便宜的材料组合' },
  { label: '对比材料', message: '帮我对比不同水泥对配合比的影响' },
]

/** Excel 槽位上的类型与材料库 type 对齐（减水剂在库中常为「减水剂」） */
function materialMatchesSlotType(mat, slotType) {
  if (!mat?.type || !slotType) return false
  if (slotType === '外加剂') {
    return mat.type === '外加剂' || mat.type === '减水剂'
  }
  return mat.type === slotType
}

/** 某条配合比中仍为空的材料槽（需用户从库中选择） */
function getUnfilledMaterialSlotsForMix(mix, row) {
  const slots = []
  const mapRow = row || {}
  for (const [key, excelName] of Object.entries(mix.materials || {})) {
    if (!excelName || typeof excelName !== 'string') continue
    const slotType = MATERIAL_TYPE_MAP[key]
    if (!slotType) continue
    const cur = mapRow[key]
    if (cur != null && typeof cur === 'object') continue
    slots.push({ mixId: mix.id, key, type: slotType, token: `${excelName}(${slotType})` })
  }
  return slots
}

/** 按 Excel 行顺序，列出仍缺材料的配合比（用于逐条补充） */
function buildPerMixMaterialQueue(mixDesigns, materialMapping) {
  if (!mixDesigns?.length) return []
  return mixDesigns
    .map(mix => ({
      mix,
      mixId: mix.id,
      strengthGrade: mix.strengthGrade,
      slots: getUnfilledMaterialSlotsForMix(mix, materialMapping[mix.id])
    }))
    .filter(entry => entry.slots.length > 0)
}

const SmartDesignChat = () => {
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [materialSelectionDone, setMaterialSelectionDone] = useState(false)
  const [attachment, setAttachment] = useState(null)          // { file, type, name }
  const [analysisMode, setAnalysisMode] = useState(false)    // 是否处于分析模式
  const [analysisData, setAnalysisData] = useState(null)     // 分析模式的数据
  const [pendingMaterialPicker, setPendingMaterialPicker] = useState(null)  // 待选择的材料
  const [analysisResult, setAnalysisResult] = useState(null)  // 分析结果
  const [contrastPickerSelected, setContrastPickerSelected] = useState([])
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, pendingMaterialPicker?.pickerKey])

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

  const handleMaterialConfirm = async (selectedMaterials) => {
    // 设计模式：pendingMaterialPicker 为空，材料来自聊天消息中的 materialPicker
    if (!pendingMaterialPicker) {
      const grouped = {}
      for (const mat of selectedMaterials) {
        if (!grouped[mat.type]) grouped[mat.type] = []
        grouped[mat.type].push(mat.name)
      }
      const parts = Object.entries(grouped).map(([type, names]) => `${type}：${names.join('、')}`)
      const summary = `我选择以下材料：${parts.join('；')}。请根据这些材料设计配合比。`
      setMaterialSelectionDone(true)
      setChatMessages(prev => [...prev, { role: 'user', content: summary }])
      setChatLoading(true)
      await handleDesignMode(summary, { selectedMaterials })
      return
    }

    const queue = buildPerMixMaterialQueue(
      pendingMaterialPicker.mixDesigns,
      pendingMaterialPicker.materialMapping
    )
    const current = queue[0]
    if (!current) {
      message.warning('当前没有待补充的材料')
      return
    }

    const newMapping = {}
    for (const mixId of Object.keys(pendingMaterialPicker.materialMapping)) {
      newMapping[mixId] = { ...pendingMaterialPicker.materialMapping[mixId] }
    }

    const slots = current.slots
    const pool = [...selectedMaterials]
    for (const slot of slots) {
      const idx = pool.findIndex(m => materialMatchesSlotType(m, slot.type))
      if (idx < 0) continue
      const [mat] = pool.splice(idx, 1)
      const row = { ...newMapping[slot.mixId] }
      row[slot.key] = mat
      newMapping[slot.mixId] = row
    }

    if (slots.length > 0 && pool.length === selectedMaterials.length) {
      message.warning('未能将所选材料对应到本配合比的缺失槽位，请确认类型与 Excel 一致后重试')
      return
    }

    const stillMissing = getUnfilledMaterialSlotsForMix(current.mix, newMapping[current.mixId])
    if (stillMissing.length > 0) {
      message.warning(`编号 ${current.mixId} 仍有 ${stillMissing.length} 项材料未选择，请选齐后确认`)
      return
    }

    const grouped = {}
    for (const mat of selectedMaterials) {
      if (!grouped[mat.type]) grouped[mat.type] = []
      grouped[mat.type].push(mat.name)
    }
    const parts = Object.entries(grouped).map(([type, names]) => `${type}：${names.join('、')}`)
    const msg = `编号 ${current.mixId}：${parts.join('；')}`

    const summary = [...(pendingMaterialPicker.materialPickSummary || []), msg]
    const nextQueue = buildPerMixMaterialQueue(pendingMaterialPicker.mixDesigns, newMapping)

    if (nextQueue.length === 0) {
      const customPrompt = [pendingMaterialPicker.initialUserPrompt, ...summary].filter(Boolean).join('\n')
      setMaterialSelectionDone(true)
      setChatInput(summary.join('；'))
      executeAnalysis(pendingMaterialPicker.mixDesigns, newMapping, { customPrompt })
      setPendingMaterialPicker(null)
      setChatLoading(true)
      return
    }

    const next = nextQueue[0]
    setChatMessages(prev => [...prev, {
      role: 'assistant',
      content: `编号 **${current.mixId}** 已补充完成。请继续为 **编号 ${next.mixId}**（${next.strengthGrade || '—'}）选择材料：`
    }])
    setPendingMaterialPicker({
      ...pendingMaterialPicker,
      materialMapping: newMapping,
      materialPickSummary: summary,
      pickerKey: `${Date.now()}-${next.mixId}-${next.slots.length}`
    })
    setChatInput(msg)
    message.success(`编号 ${current.mixId} 材料已保存`)
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

          // 如果有未匹配的材料，自动弹出材料选择器
          if (result.unmatchedMaterials && result.unmatchedMaterials.size > 0) {
            const allMaterials = await getAllMaterials()
            setMaterialSelectionDone(false)
            const perMixQueue = buildPerMixMaterialQueue(mixDesigns, materialMapping)
            if (perMixQueue.length === 0) {
              message.warning('存在未匹配材料但无法逐条定位，将按当前映射尝试分析')
              await executeAnalysis(mixDesigns, materialMapping, { customPrompt: userMessage })
              setChatLoading(false)
              return
            }
            const first = perMixQueue[0]
            const mixCount = perMixQueue.length
            setChatMessages(prev => [...prev, {
              role: 'assistant',
              content: mixCount > 1
                ? `有 **${mixCount}** 条配合比存在材料未自动匹配（共 ${result.unmatchedMaterials.size} 类名称未对上库），将**按表格顺序逐条**补充。\n\n请先为 **编号 ${first.mixId}**（${first.strengthGrade || '—'}）选择材料：`
                : `检测到 **${result.unmatchedMaterials.size}** 类材料未能自动匹配。\n\n请为 **编号 ${first.mixId}**（${first.strengthGrade || '—'}）选择材料：`
            }])
            setPendingMaterialPicker({
              mixDesigns,
              materialMapping,
              allMaterials: allMaterials || [],
              unmatchedMaterials: result.unmatchedMaterials,
              initialUserPrompt: userMessage || '',
              materialPickSummary: [],
              pickerKey: `${Date.now()}-${first.mixId}-${first.slots.length}`
            })
            setChatLoading(false)
            return
          }
        } else if (attachment.type === 'md') {
          const content = await processMarkdownAttachment(attachment.file)
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `已上传Markdown文件，内容长度${content.length}字符。需要进一步解析处理。`
          }])
          setChatLoading(false)
          return
        }
      } else if (userMessage) {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: '正在分析文本中的配合比数据...'
        }])
      }

      // 执行分析（使用用户发送时的文案作为试验目的等补充说明）
      await executeAnalysis(mixDesigns, materialMapping, { customPrompt: userMessage })
    } catch (error) {
      message.error('进入分析模式失败: ' + error.message)
      setAnalysisMode(false)
      setChatLoading(false)
    }
  }

  // 使用已确定的模式执行分析（跳过 prepare 步骤，避免重复检测）
  const executeAnalysisWithModes = async (mixDesigns, materialMapping, effectivePrompt, { modes, preprocessedData }) => {
    try {
      const analysisDataBuilt = buildAnalysisData(mixDesigns, materialMapping)
      setAnalysisData(analysisDataBuilt)

      const result = await window.electronAPI.invoke('aiAnalysis:analyze', {
        data: analysisDataBuilt,
        customPrompt: (typeof effectivePrompt === 'string' ? effectivePrompt : '') || '',
        analysisModes: modes,
        preprocessedData
      })

      const { report, textualReply } = extractAnalysisPayload(result)

      if (report && modes.length > 0) {
        report.analysisModes = modes
        report.preprocessedData = preprocessedData
      }

      const intro = '## 分析报告\n\n已根据当前配合比数据生成结构化报告，请查看下方卡片。'
      let content = '分析完成'
      if (report && textualReply) {
        content = intro
      } else if (textualReply) {
        content = textualReply
      } else if (report) {
        content = intro
      }

      setChatMessages(prev => [...prev, { role: 'assistant', content, analysisReport: report }])
      setAnalysisResult(report)
    } catch (error) {
      message.error('分析执行失败: ' + error.message)
      setAnalysisMode(false)
    } finally {
      setChatLoading(false)
    }
  }

  // 执行AI分析
  const executeAnalysis = async (mixDesigns, materialMapping, opts = {}) => {
    try {
      const effectivePrompt = opts.customPrompt !== undefined && opts.customPrompt !== null ? opts.customPrompt : chatInput

      // 先构建完整的分析数据（包含 analysisRequirements）
      const analysisDataBuilt = buildAnalysisData(mixDesigns, materialMapping)
      setAnalysisData(analysisDataBuilt)

      // ========== NEW: 调用 analysis:prepare 进行模式识别和数值预处理 ==========
      let analysisModes = []
      let preprocessedData = null
      let prepareResult = null
      try {
        prepareResult = await window.electronAPI.invoke('analysis:prepare', {
          data: analysisDataBuilt,
          customPrompt: (typeof effectivePrompt === 'string' ? effectivePrompt : '') || ''
        })
        if (prepareResult.modes?.length > 0) {
          analysisModes = prepareResult.modes
          preprocessedData = prepareResult.preprocessedData
        }
      } catch (e) {
        console.warn('分析预处理失败，将使用通用分析模式:', e)
      }

      // ========== Task 7: 多材料变化边界处理 ==========
      if (!opts.selectedContrastMaterials
          && prepareResult?.material_contrast?.changed_materials?.length > 1
          && prepareResult.material_contrast?.source === 'auto_detected') {
        // 多类材料同时变化，询问用户
        const changedMats = prepareResult.material_contrast.changed_materials
        const matTypeLabels = {
          cement: '水泥', flyAsh: '粉煤灰', slag: '矿渣粉',
          lithiumSlag: '锂渣', compositePowder: '复合粉',
          fineAggregate1: '细骨料1', fineAggregate2: '细骨料2',
          coarseAggregate: '粗骨料', superplasticizer: '减水剂'
        }

        const chatMsg = {
          role: 'assistant',
          content: `检测到${changedMats.map(m => matTypeLabels[m] || m).join('、')}与之前不一致，请问需要对比哪种材料？`,
          materialPicker: {
            type: 'contrast_selection',
            options: changedMats.map(mat => ({
              label: matTypeLabels[mat] || mat,
              value: mat
            })),
            multipleSelect: true,
            onSelect: (selected) => {
              setChatLoading(true)
              if (selected.length === 0) {
                // 不进行材料对比，仅做参数趋势
                executeAnalysisWithModes(mixDesigns, materialMapping, effectivePrompt, {
                  modes: prepareResult.modes.filter(m => m !== 'material_contrast'),
                  preprocessedData: prepareResult.preprocessedData
                })
              } else {
                // 用户选择了对比材料
                executeAnalysis(mixDesigns, materialMapping, {
                  customPrompt: effectivePrompt,
                  selectedContrastMaterials: selected
                })
              }
            }
          }
        }

        setChatMessages(prev => [...prev, chatMsg])
        setContrastPickerSelected([])
        setChatLoading(false)
        return
      }
      // ========== END Task 7 ==========

      const result = await window.electronAPI.invoke('aiAnalysis:analyze', {
        data: analysisDataBuilt,
        customPrompt: (typeof effectivePrompt === 'string' ? effectivePrompt : '') || '',
        analysisModes,      // NEW
        preprocessedData    // NEW
      })

      const { report, textualReply } = extractAnalysisPayload(result)

      // ========== NEW: Attach modes and preprocessedData to report ==========
      if (report && analysisModes.length > 0) {
        report.analysisModes = analysisModes
        report.preprocessedData = preprocessedData
      }

      const intro = '## 分析报告\n\n已根据当前配合比数据生成结构化报告，请查看下方卡片。'
      let content = '分析完成'
      if (report && textualReply) {
        content = intro
      } else if (textualReply) {
        content = textualReply
      } else if (report) {
        content = intro
      }

      const chatMsg = {
        role: 'assistant',
        content,
        analysisReport: report
      }

      setChatMessages(prev => [...prev, chatMsg])
      setAnalysisResult(report)
    } catch (error) {
      message.error('分析执行失败: ' + error.message)
      setAnalysisMode(false)
    } finally {
      setChatLoading(false)
    }
  }

  // 分析模式后续追问
  const handleAnalysisFollowUp = async (userMessage) => {
    setChatLoading(true)

    try {
      // 将用户消息和分析数据一起发送给AI
      const context = {
        analysisData,
        analysisResult,
        mixDesigns: analysisData?.mixDesigns || [],
        materialMapping: {},  // 从 analysisData 中提取
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
  const handleDesignMode = async (userMessage, extraContext = {}) => {
    try {
      const result = await window.electronAPI.invoke('aiAnalysis:chat', {
        message: userMessage,
        context: { ...extraContext }
      })

      const chatMsg = { role: 'assistant', content: result.reply, toolCalls: null }

      if (result.messages) {
        const toolMsgs = result.messages.filter(m => m.role === 'tool')
        // 合并所有工具调用返回的材料，去重（按id），避免只保留最后一次结果
        const allMaterialsMap = new Map()
        for (const toolMsg of toolMsgs) {
          try {
            const parsed = JSON.parse(toolMsg.content)
            if (parsed.success && parsed.materials && parsed.materials.length > 0) {
              for (const mat of parsed.materials) {
                if (mat.id) {
                  allMaterialsMap.set(mat.id, mat)
                }
              }
            }
          } catch (_) { /* ignore */ }
        }
        const allMaterials = [...allMaterialsMap.values()]
        if (allMaterials.length > 0) {
          chatMsg.materialPicker = { materials: allMaterials }
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
      setChatLoading(false)
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

    // 情况3：用户明确要求进入分析模式
    if (detectAnalysisModeIntent(userMessage)) {
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
      setMaterialSelectionDone(false)
      setAttachment(null)
      setAnalysisMode(false)
      setAnalysisData(null)
      setAnalysisResult(null)
      setPendingMaterialPicker(null)
      message.success('对话已清空')
    } catch (error) {
      console.error('清空对话失败:', error)
    }
  }

  const handleQuickPrompt = (msg) => {
    setChatInput(msg)
  }

  return (
    <div className="smart-design-chat">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <RobotOutlined style={{ fontSize: 18, color: 'var(--color-primary)' }} />
          <Text strong style={{ fontSize: 16 }}>智能设计助手</Text>
        </Space>
      </div>

      <div className="smart-chat-list">
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
              <List.Item className={item.role === 'user' ? 'smart-chat-item-user' : 'smart-chat-item-assistant'}>
                <Space align="start" style={{ width: item.role === 'user' ? 'auto' : '100%' }}>
                  {item.role === 'assistant' && <Avatar icon={<RobotOutlined />} className="chat-avatar" />}
                  {item.role === 'assistant' ? (
                    <div className="smart-chat-body-assistant" style={{ flex: 1, minWidth: 0 }}>
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
                      {item.materialPicker?.type === 'contrast_selection' && (
                        <div style={{
                          border: '1px solid #d9d9d9', borderRadius: 8, padding: 12,
                          marginBottom: 8, background: '#fafafa'
                        }}>
                          <Text strong style={{ display: 'block', marginBottom: 8 }}>请选择要对比的材料（可多选）：</Text>
                          <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {item.materialPicker.options.map(opt => (
                              <Checkbox
                                key={opt.value}
                                checked={contrastPickerSelected.includes(opt.value)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setContrastPickerSelected(prev => [...prev, opt.value])
                                  } else {
                                    setContrastPickerSelected(prev => prev.filter(v => v !== opt.value))
                                  }
                                }}
                              >
                                {opt.label}
                              </Checkbox>
                            ))}
                          </div>
                          <Button
                            type="primary"
                            size="small"
                            onClick={() => {
                              item.materialPicker.onSelect([...contrastPickerSelected])
                              setContrastPickerSelected([])
                            }}
                          >
                            确认对比
                          </Button>
                        </div>
                      )}
                      {item.materialPicker && !materialSelectionDone && item.materialPicker.type !== 'contrast_selection' && (
                        <MaterialPicker
                          materials={item.materialPicker.materials || pendingMaterialPicker?.allMaterials}
                          onConfirm={handleMaterialConfirm}
                        />
                      )}
                      {item.toolCall?.status === 'loading' && (
                        <ToolCallBubble status="loading" toolName={item.toolCall.type} />
                      )}
                      {item.analysisReport && (
                        <div className="analysis-report-wrapper" style={{ marginBottom: 12, maxWidth: '100%' }}>
                          <Alert type="info" showIcon icon={<BarChartOutlined />} message="分析报告已生成" style={{ marginBottom: 8 }} />
                          {item.analysisReport.parameterDiagnosis && (
                            <DiagnosisResultCard data={item.analysisReport.parameterDiagnosis} />
                          )}
                          <AnalysisReport result={item.analysisReport} />
                        </div>
                      )}
                      {item.options && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                          {item.options.map((opt, idx) => (
                            <Button key={idx} size="small" type="primary" onClick={() => {
                              if (opt === '手动选择材料' && pendingMaterialPicker) {
                                setMaterialSelectionDone(true)
                              } else if (opt === '继续分析' && pendingMaterialPicker) {
                                executeAnalysis(pendingMaterialPicker.mixDesigns, pendingMaterialPicker.materialMapping, { customPrompt: chatInput })
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
                    </div>
                  ) : (
                    <div className="smart-chat-bubble-user">
                      {item.attachment && (
                        <Tag icon={item.attachment.type === 'xlsx' ? <FileExcelOutlined /> : <FileTextOutlined />} style={{ marginBottom: 8, color: 'inherit' }}>
                          {item.attachment.name}
                        </Tag>
                      )}
                      {item.content}
                    </div>
                  )}
                  {item.role === 'user' && <Avatar icon={<UserOutlined />} className="chat-avatar-user" />}
                </Space>
              </List.Item>
            )}
          />
        )}
        {pendingMaterialPicker && !materialSelectionDone && (() => {
          const q = buildPerMixMaterialQueue(
            pendingMaterialPicker.mixDesigns,
            pendingMaterialPicker.materialMapping
          )
          const active = q[0]
          const activeTokens = active
            ? new Set(active.slots.map(s => s.token))
            : new Set(pendingMaterialPicker.unmatchedMaterials || [])
          return (
            <div style={{ paddingLeft: 40, paddingRight: 16, paddingBottom: 12 }}>
              {active && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message={`当前：编号 ${active.mixId}（${active.strengthGrade || '—'}）`}
                  description={q.length > 1 ? `共 ${q.length} 条待补充，完成本条后自动进入下一条。` : '请为本条配合比选择缺失的材料。'}
                />
              )}
              <MaterialPicker
                key={pendingMaterialPicker.pickerKey || 'analysis-material-picker'}
                materials={filterMaterialsForUnmatched(
                  pendingMaterialPicker.allMaterials || [],
                  activeTokens
                )}
                onConfirm={handleMaterialConfirm}
              />
            </div>
          )
        })()}
        <div ref={chatEndRef} />
      </div>

      <div className="smart-chat-tags-row">
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
              setMaterialSelectionDone(false)
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
          <Button icon={<PlusOutlined />} title="上传附件" aria-label="上传附件" />
        </Upload>
        <Button
          icon={<ClearOutlined />}
          onClick={handleClearChat}
          disabled={chatMessages.length === 0}
          title="清空对话"
          aria-label="清空对话"
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

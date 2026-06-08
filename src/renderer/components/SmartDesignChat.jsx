import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Input, Space, Avatar, List, Alert, message, Typography, Upload, Tag, Checkbox, Segmented, Layout } from 'antd'
import { SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, BulbOutlined, PlusOutlined, DeleteOutlined, FileTextOutlined, FileExcelOutlined, BarChartOutlined, HistoryOutlined, ThunderboltOutlined, TeamOutlined, AppstoreOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolCallBubble from './ToolCallBubble'
import MixDesignResultCard from './MixDesignResultCard'
import OptimizationResultCard from './OptimizationResultCard'
import MaterialCompareCard from './MaterialCompareCard'
import MaterialPicker from './MaterialPicker'
import DiagnosisResultCard from './DiagnosisResultCard'
import ComplianceResultCard from './ComplianceResultCard'
import SalesQuoteResultCard from './SalesQuoteResultCard'
import SaveBasicMixModal from './SaveBasicMixModal'
import AgentProgressCard from './AgentProgressCard'
import DecisionGate from './DecisionGate'
import MemorySidebar from './MemorySidebar'
import SlashCommandMenu from './SlashCommandMenu'
import useChatState from '../hooks/useChatState'
import useAgentMode from './AgentMode'
import { getAttachmentType, detectAnalysisModeIntent, processExcelAttachment, processMarkdownAttachment, filterMaterialsForUnmatched } from '../utils/attachmentHelper'
import { AnalysisReport } from '../pages/AIAnalysisPage_Results'
import { getAllMaterials } from '../services/MaterialService'
import { buildAnalysisData, MATERIAL_TYPE_MAP } from '../pages/AIAnalysisPage_Upload'

const { Text } = Typography
const { Content } = Layout

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
  { label: '/ 查看技能', message: '/', isSlash: true },
]

const CONTRAST_MATERIAL_LABELS = {
  cement: '水泥',
  flyAsh: '粉煤灰',
  slag: '矿渣粉',
  lithiumSlag: '锂渣',
  compositePowder: '复合粉',
  fineAggregate1: '细骨料1',
  fineAggregate2: '细骨料2',
  coarseAggregate: '粗骨料',
  superplasticizer: '减水剂'
}

function removeContrastData(preprocessedData) {
  if (!preprocessedData) return preprocessedData
  const { contrast, ...rest } = preprocessedData
  return rest
}

const CHAT_STREAM_EVENT = 'aiAnalysis:chatStream:event'

// 从错误对象中提取消息字符串（共享工具函数）
import extractErrorMessage from '../utils/extractErrorMessage'

function createToolSummary(toolName, args = {}) {
  if (toolName === 'list_available_materials') {
    return args.type ? `材料类型：${args.type}` : '全部材料'
  }
  if (toolName === 'calculate_mix_design') {
    return [args.strength, args.slump ? `坍落度 ${args.slump}mm` : null].filter(Boolean).join('|')
  }
  if (toolName === 'optimize_mix_cost') {
    return [args.strength, args.slump ? `坍落度 ${args.slump}mm` : null, args.gridStep ? `步长 ${args.gridStep}` : null].filter(Boolean).join('|')
  }
  if (toolName === 'compare_materials') {
    return [args.compareType, args.candidateIds?.length ? `${args.candidateIds.length} 个候选` : null].filter(Boolean).join('|')
  }
  if (toolName === 'run_parameter_diagnosis') {
    return '分析上传数据'
  }
  if (toolName === 'check_compliance') {
    return args.mixDesign?.strengthGrade || args.mixDesign?.strength || '规范条文检索'
  }
  if (toolName === 'predict_performance') {
    return '预测强度、坍落度和容重'
  }
  return ''
}

function mergeToolEvent(toolEvents = [], nextEvent) {
  const id = nextEvent.id || `${nextEvent.toolName}-${toolEvents.length}`
  const index = toolEvents.findIndex(item => item.id === id)
  const next = { ...nextEvent, id }
  if (index < 0) {
    return [...toolEvents, next]
  }
  return toolEvents.map((item, i) => i === index ? { ...item, ...next } : item)
}

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
  // ===== Hooks =====
  const chatState = useChatState()
  const agent = useAgentMode(chatState)

  const streamSeqRef = useState(() => ({ current: 0 }))[0]

  // Agent 状态重置辅助
  const resetAgentState = () => {
    agent.setAgentSteps([])
    agent.setAgentStatus(null)
    agent.setPendingConfirmation(null)
  }

  // 仅在消息条数变化时刷新会话列表（避免流式输出时频繁刷新）
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    const count = chatState.chatMessages?.length || 0
    if (count !== prevMsgCountRef.current && count > 0) {
      prevMsgCountRef.current = count
      agent.loadSessions()
    }
  }, [chatState.chatMessages?.length])

  // ===== 斜杠命令状态 =====
  const [slashMenuVisible, setSlashMenuVisible] = useState(false)
  const [availableSkills, setAvailableSkills] = useState([])

  // 加载可用技能
  const loadSkills = useCallback(async () => {
    try {
      console.log('[SlashCommand] 加载技能列表...')
      const result = await window.electronAPI?.skill?.listAll()
      console.log('[SlashCommand] 技能列表结果:', result)
      if (result?.success) {
        setAvailableSkills(result.skills || [])
        console.log('[SlashCommand] 已加载', result.skills?.length || 0, '个技能')
      }
    } catch (error) {
      console.warn('[SlashCommand] 加载技能列表失败:', error)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // 当菜单打开时重新加载（确保最新）
  useEffect(() => {
    if (slashMenuVisible && availableSkills.length === 0) {
      loadSkills()
    }
  }, [slashMenuVisible, availableSkills.length, loadSkills])

  // 监听输入变化，检测斜杠命令
  const handleInputChange = useCallback((e) => {
    const value = e.target.value
    chatState.setChatInput(value)

    // 检测是否输入了 "/" 开头
    if (value.startsWith('/')) {
      setSlashMenuVisible(true)
      console.log('[SlashCommand] 显示菜单, 当前技能数:', availableSkills.length)
    } else {
      setSlashMenuVisible(false)
    }
  }, [chatState, availableSkills.length])

  // 选择技能
  const handleSkillSelect = useCallback((skill) => {
    chatState.setChatInput(`/${skill.name} `)
    setSlashMenuVisible(false)
    // 聚焦到输入框
    setTimeout(() => {
      const input = document.querySelector('.smart-chat-input-area input')
      if (input) input.focus()
    }, 100)
  }, [chatState])

  // 关闭菜单
  const handleSlashMenuClose = useCallback(() => {
    setSlashMenuVisible(false)
  }, [])

  // ===== 流式聊天辅助函数 =====
  const createStreamRequestId = () => {
    streamSeqRef.current += 1
    return `smart-chat-stream-${Date.now()}-${streamSeqRef.current}`
  }

  const updateStreamMessage = (streamId, updater) => {
    chatState.setChatMessages(prev => prev.map(item => (
      item.streamId === streamId ? updater(item) : item
    )))
  }

  const buildAssistantMessageFromResult = (result) => {
    const chatMsg = { role: 'assistant', content: result?.reply || '', toolCalls: null }

    if (result?.messages) {
      const toolMsgs = result.messages.filter(m => m.role === 'tool')
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
        chatMsg.materialPicker.pickerId = chatState.createMaterialPickerId()
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

    if (result?.intent === 'analysis_mode') {
      chatMsg.analysisIntent = true
    }

    return chatMsg
  }

  const applyFinalChatResult = (streamId, result) => {
    const finalMsg = buildAssistantMessageFromResult(result)
    updateStreamMessage(streamId, item => ({
      ...item,
      ...finalMsg,
      // 流式事件中已设置 toolCall 时，不被 finalMsg 的 null 覆盖
      toolCall: item.toolCall || finalMsg.toolCall,
      content: item.content?.trim() ? item.content : finalMsg.content,
      streaming: false,
      toolEvents: (item.toolEvents || []).map(tool => (
        tool.status === 'loading' ? { ...tool, status: 'done' } : tool
      ))
    }))
  }

  const handleChatStreamEvent = (streamId, payload) => {
    if (payload.type === 'reasoning_delta') {
      updateStreamMessage(streamId, item => ({
        ...item,
        reasoning: `${item.reasoning || ''}${payload.content || ''}`
      }))
      return
    }

    if (payload.type === 'text_delta') {
      updateStreamMessage(streamId, item => ({
        ...item,
        content: `${item.content || ''}${payload.content || ''}`
      }))
      return
    }

    if (payload.type === 'tool_start') {
      updateStreamMessage(streamId, item => ({
        ...item,
        toolEvents: mergeToolEvent(item.toolEvents, {
          id: payload.toolCallId,
          toolName: payload.toolName,
          status: 'loading',
          summary: createToolSummary(payload.toolName, payload.args)
        })
      }))
      return
    }

    if (payload.type === 'tool_done' || payload.type === 'tool_error') {
      const toolResult = payload.result
      updateStreamMessage(streamId, item => {
        const next = {
          ...item,
          toolEvents: mergeToolEvent(item.toolEvents, {
            id: payload.toolCallId,
            toolName: payload.toolName,
            status: payload.type === 'tool_error' ? 'error' : 'done',
            summary: createToolSummary(payload.toolName, payload.args),
            error: extractErrorMessage(payload.error) || extractErrorMessage(toolResult?.error)
          })
        }
        // tool_done 携带了可视化结果，直接构建 toolCall 以渲染结果卡片（含保存按钮）
        if (payload.type === 'tool_done' && toolResult?.type && toolResult?.data) {
          next.toolCall = {
            status: 'done',
            type: toolResult.type,
            data: toolResult.data
          }
        }
        return next
      })
      return
    }

    if (payload.type === 'error') {
      updateStreamMessage(streamId, item => ({
        ...item,
        content: item.content || `AI 回复失败：${extractErrorMessage(payload.error) || '未知错误'}`,
        streaming: false,
        toolEvents: (item.toolEvents || []).map(tool => (
          tool.status === 'loading' ? { ...tool, status: 'error', error: extractErrorMessage(payload.error) } : tool
        ))
      }))
    }
  }

  const runStreamingChat = async (userMessage, context = {}) => {
    const requestId = createStreamRequestId()
    const streamId = requestId
    let listenerId = null

    chatState.setChatMessages(prev => [...prev, {
      role: 'assistant',
      content: '',
      streamId,
      streaming: true,
      toolEvents: []
    }])

    try {
      listenerId = window.electronAPI.on(CHAT_STREAM_EVENT, (payload) => {
        if (!payload || payload.requestId !== requestId) return
        handleChatStreamEvent(streamId, payload)
      })

      const result = await window.electronAPI.invoke('aiAnalysis:chatStream', {
        requestId,
        message: userMessage,
        context
      })
      applyFinalChatResult(streamId, result)
      return result
    } catch (error) {
      updateStreamMessage(streamId, item => ({
        ...item,
        content: item.content || `AI 回复失败：${error.message}`,
        streaming: false,
        toolEvents: (item.toolEvents || []).map(tool => (
          tool.status === 'loading' ? { ...tool, status: 'error', error: error.message } : tool
        ))
      }))
      throw error
    } finally {
      if (listenerId) {
        window.electronAPI.removeListener(listenerId)
      }
    }
  }

  const handleSaveFromCard = async (cardData) => {
    try {
      const bestSol = cardData.bestSolution || {}
      const source = cardData.bestSolution ? bestSol : cardData
      const strength = cardData.strength || source.strength
      const slump = cardData.slump || source.slump
      const now = new Date()
      const timestamp = now.toLocaleString('zh-CN', { hour12: false })
      const saveData = {
        name: `${strength || 'AI'}${cardData.bestSolution ? '成本优化方案' : '智能设计方案'} - ${timestamp}`,
        projectName: 'AI智能设计',
        strength,
        slump,
        waterRatio: source.waterRatio || cardData.waterRatio || bestSol.waterRatio,
        sandRatio: source.sandRatio || cardData.sandRatio || bestSol.sandRatio,
        density: source.density || cardData.density || bestSol.density,
        materials: source.materials || cardData.materials || bestSol.materials,
        materialCosts: source.materialCosts || cardData.materialCosts || bestSol.materialCosts,
        totalCost: source.totalCost || cardData.totalCost || bestSol.totalCost,
        materialDetails: source.selectedMaterials || cardData.selectedMaterials || bestSol.selectedMaterials,
        fineAggregateBreakdown: source.fineAggregateBreakdown || cardData.fineAggregateBreakdown || bestSol.fineAggregateBreakdown,
        coarseAggregateBreakdown: source.coarseAggregateBreakdown || cardData.coarseAggregateBreakdown || bestSol.coarseAggregateBreakdown,
        status: 'AI生成'
      }
      const result = await window.electronAPI.invoke('createMixDesign', saveData)
      if (!result?.success) {
        throw new Error(extractErrorMessage(result?.error) || '保存失败')
      }
      message.success('方案已保存')
    } catch (error) {
      message.error('保存失败: ' + error.message)
    }
  }

  const handleMaterialConfirm = async (selectedMaterials, pickerId = null) => {
    // 设计模式：pendingMaterialPicker 为空，材料来自聊天消息中的 materialPicker
    if (!chatState.pendingMaterialPicker) {
      const grouped = {}
      for (const mat of selectedMaterials) {
        if (!grouped[mat.type]) grouped[mat.type] = []
        grouped[mat.type].push(mat.name)
      }
      const parts = Object.entries(grouped).map(([type, names]) => `${type}：${names.join('、')}`)
      const summary = `我选择以下材料：${parts.join('；')}。请根据这些材料设计配合比。`
      chatState.markMaterialPickerDone(pickerId)
      chatState.setChatMessages(prev => [...prev, { role: 'user', content: summary }])
      chatState.setChatLoading(true)
      await handleDesignMode(summary, { selectedMaterials })
      return
    }

    const queue = buildPerMixMaterialQueue(
      chatState.pendingMaterialPicker.mixDesigns,
      chatState.pendingMaterialPicker.materialMapping
    )
    const current = queue[0]
    if (!current) {
      message.warning('当前没有待补充的材料')
      return
    }

    const newMapping = {}
    for (const mixId of Object.keys(chatState.pendingMaterialPicker.materialMapping)) {
      newMapping[mixId] = { ...chatState.pendingMaterialPicker.materialMapping[mixId] }
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

    const summary = [...(chatState.pendingMaterialPicker.materialPickSummary || []), msg]
    const nextQueue = buildPerMixMaterialQueue(chatState.pendingMaterialPicker.mixDesigns, newMapping)

    if (nextQueue.length === 0) {
      const customPrompt = [chatState.pendingMaterialPicker.initialUserPrompt, ...summary].filter(Boolean).join('\n')
      chatState.setChatInput(summary.join('；'))
      executeAnalysis(chatState.pendingMaterialPicker.mixDesigns, newMapping, { customPrompt })
      chatState.setPendingMaterialPicker(null)
      chatState.setChatLoading(true)
      return
    }

    const next = nextQueue[0]
    chatState.setChatMessages(prev => [...prev, {
      role: 'assistant',
      content: `编号 **${current.mixId}** 已补充完成。请继续为 **编号 ${next.mixId}**（${next.strengthGrade || '—'}）选择材料：`
    }])
    chatState.setPendingMaterialPicker({
      ...chatState.pendingMaterialPicker,
      materialMapping: newMapping,
      materialPickSummary: summary,
      pickerKey: `${Date.now()}-${next.mixId}-${next.slots.length}`
    })
    chatState.setChatInput(msg)
    message.success(`编号 ${current.mixId} 材料已保存`)
  }

  // 进入分析模式
  const handleEnterAnalysisMode = async (attachment, userMessage) => {
    chatState.setAnalysisMode(true)
    chatState.setChatLoading(true)

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
            const perMixQueue = buildPerMixMaterialQueue(mixDesigns, materialMapping)
            if (perMixQueue.length === 0) {
              message.warning('存在未匹配材料但无法逐条定位，将按当前映射尝试分析')
              await executeAnalysis(mixDesigns, materialMapping, { customPrompt: userMessage })
              chatState.setChatLoading(false)
              return
            }
            const first = perMixQueue[0]
            const mixCount = perMixQueue.length
            chatState.setChatMessages(prev => [...prev, {
              role: 'assistant',
              content: mixCount > 1
                ? `有 **${mixCount}** 条配合比存在材料未自动匹配（共 ${result.unmatchedMaterials.size} 类名称未对上库），将**按表格顺序逐条**补充。\n\n请先为 **编号 ${first.mixId}**（${first.strengthGrade || '—'}）选择材料：`
                : `检测到 **${result.unmatchedMaterials.size}** 类材料未能自动匹配。\n\n请为 **编号 ${first.mixId}**（${first.strengthGrade || '—'}）选择材料：`
            }])
            chatState.setPendingMaterialPicker({
              mixDesigns,
              materialMapping,
              allMaterials: allMaterials || [],
              unmatchedMaterials: result.unmatchedMaterials,
              initialUserPrompt: userMessage || '',
              materialPickSummary: [],
              pickerKey: `${Date.now()}-${first.mixId}-${first.slots.length}`
            })
            chatState.setChatLoading(false)
            return
          }
        } else if (attachment.type === 'md') {
          const content = await processMarkdownAttachment(attachment.file)
          // 将 Markdown 内容发送给 AI 分析
          const mdMessage = `请分析以下 Markdown 文档内容：\n\n${content}`
          chatState.setChatMessages(prev => [...prev, { role: 'user', content: mdMessage }])
          await runStreamingChat(mdMessage)
          return
        }
      } else if (userMessage) {
        chatState.setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: '正在分析文本中的配合比数据...'
        }])
      }

      // 执行分析（使用用户发送时的文案作为试验目的等补充说明）
      await executeAnalysis(mixDesigns, materialMapping, { customPrompt: userMessage })
    } catch (error) {
      message.error('进入分析模式失败: ' + error.message)
      chatState.setAnalysisMode(false)
      chatState.setChatLoading(false)
    }
  }

  // 使用已确定的模式执行分析（跳过 prepare 步骤，避免重复检测）
  const executeAnalysisWithModes = async (mixDesigns, materialMapping, effectivePrompt, { modes, preprocessedData }) => {
    try {
      const analysisDataBuilt = buildAnalysisData(mixDesigns, materialMapping)
      chatState.setAnalysisData(analysisDataBuilt)

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

      chatState.setChatMessages(prev => [...prev, { role: 'assistant', content, analysisReport: report }])
      chatState.setAnalysisResult(report)
    } catch (error) {
      message.error('分析执行失败: ' + error.message)
      chatState.setAnalysisMode(false)
    } finally {
      chatState.setChatLoading(false)
    }
  }

  // 执行AI分析
  const executeAnalysis = async (mixDesigns, materialMapping, opts = {}) => {
    try {
      const effectivePrompt = opts.customPrompt !== undefined && opts.customPrompt !== null ? opts.customPrompt : chatState.chatInput

      // 先构建完整的分析数据（包含 analysisRequirements）
      const analysisDataBuilt = buildAnalysisData(mixDesigns, materialMapping)
      chatState.setAnalysisData(analysisDataBuilt)

      // ========== NEW: 调用 analysis:prepare 进行模式识别和数值预处理 ==========
      let analysisModes = []
      let preprocessedData = null
      let prepareResult = null
      try {
        prepareResult = await window.electronAPI.invoke('analysis:prepare', {
          data: analysisDataBuilt,
          customPrompt: (typeof effectivePrompt === 'string' ? effectivePrompt : '') || '',
          selectedContrastMaterials: opts.selectedContrastMaterials || null
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

        const chatMsg = {
          role: 'assistant',
          content: `检测到${changedMats.map(m => CONTRAST_MATERIAL_LABELS[m] || m).join('、')}与之前不一致，请问需要对比哪种材料？`,
          materialPicker: {
            type: 'contrast_selection',
            options: changedMats.map(mat => ({
              label: CONTRAST_MATERIAL_LABELS[mat] || mat,
              value: mat
            })),
            multipleSelect: true,
            onSelect: (selected) => {
              chatState.setChatLoading(true)
              if (selected.length === 0) {
                // 不进行材料对比，仅做参数趋势
                executeAnalysisWithModes(mixDesigns, materialMapping, effectivePrompt, {
                  modes: prepareResult.modes.filter(m => m !== 'material_contrast'),
                  preprocessedData: removeContrastData(prepareResult.preprocessedData)
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

        chatState.setChatMessages(prev => [...prev, chatMsg])
        chatState.setContrastPickerSelected([])
        chatState.setChatLoading(false)
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

      chatState.setChatMessages(prev => [...prev, chatMsg])
      chatState.setAnalysisResult(report)
    } catch (error) {
      message.error('分析执行失败: ' + error.message)
      chatState.setAnalysisMode(false)
    } finally {
      chatState.setChatLoading(false)
    }
  }

  // 分析模式后续追问
  const handleAnalysisFollowUp = async (userMessage) => {
    chatState.setChatLoading(true)

    try {
      // 将用户消息和分析数据一起发送给AI
      const context = {
        analysisData: chatState.analysisData,
        analysisResult: chatState.analysisResult,
        mixDesigns: chatState.analysisData?.mixDesigns || [],
        materialMapping: {},  // 从 analysisData 中提取
        mode: 'follow_up'
      }

      await runStreamingChat(userMessage, context)
    } catch (error) {
      message.error('追问失败: ' + error.message)
    } finally {
      chatState.setChatLoading(false)
    }
  }

  // 设计模式处理（原有些逻辑）
  const handleDesignMode = async (userMessage, extraContext = {}) => {
    try {
      await runStreamingChat(userMessage, { ...extraContext })
    } catch (error) {
      message.error('发送消息失败: ' + error.message)
      chatState.setChatLoading(false)
    } finally {
      chatState.setChatLoading(false)
    }
  }

  // 发送聊天消息（分发到不同模式）
  const handleSendChat = async () => {
    if (!chatState.chatInput.trim() || chatState.chatLoading) return

    const userMessage = chatState.chatInput.trim()
    chatState.setChatInput('')
    chatState.setChatMessages(prev => [...prev, { role: 'user', content: userMessage, attachment: chatState.attachment ? { name: chatState.attachment.name, type: chatState.attachment.type } : null }])

    // 统一使用 Agent 模式
    chatState.setChatLoading(true)
    agent.setAgentSteps([])
    agent.setAgentStatus('running')
    agent.agentRequestIdRef.current = 'agent-' + Date.now()
    try {
      const res = await window.electronAPI.invoke('agent:run', {
        requestId: agent.agentRequestIdRef.current,
        sessionId: agent.currentSessionId,
        message: userMessage,
        mode: agent.agentRunMode
      })
      if (res && res.success === false) {
        chatState.setChatLoading(false)
        agent.setAgentStatus('error')
        chatState.setChatMessages(prev => [...prev, { role: 'assistant', content: '执行出错: ' + (extractErrorMessage(res.error) || '未知错误'), isError: true }])
      } else if (res && res.success !== false) {
        // 成功：如果 agent:progress 事件还没处理过，这里兜底处理
        chatState.setChatLoading(false)
        agent.setAgentStatus('done')
        const replyContent = res.result?.content
        if (replyContent) {
          chatState.setChatMessages(prev => {
            // 防止 agent:progress 事件已经添加了消息导致重复
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant' && last?.content === replyContent) return prev
            return [...prev, { role: 'assistant', content: replyContent }]
          })
        }
      }
    } catch (e) {
      chatState.setChatLoading(false)
      agent.setAgentStatus('error')
      chatState.setChatMessages(prev => [...prev, { role: 'assistant', content: '执行出错: ' + (extractErrorMessage(e.message) || '未知错误'), isError: true }])
    }
    chatState.setAttachment(null)
  }

  // 清空对话（先中止运行中的 Agent，再重置状态）
  const handleClearChat = async () => {
    if (agent.agentRequestIdRef.current) {
      window.electronAPI.invoke('agent:abort', { requestId: agent.agentRequestIdRef.current }).catch(() => {})
    }
    await chatState.handleClearChat()
    resetAgentState()
  }

  const handleQuickPrompt = (msg) => {
    if (msg === '/') {
      // 显示斜杠命令菜单
      chatState.setChatInput('/')
      setSlashMenuVisible(true)
    } else {
      chatState.setChatInput(msg)
    }
  }

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      {/* 记忆侧栏 */}
      <MemorySidebar
        collapsed={agent.sidebarCollapsed}
        sessions={agent.sessions}
        currentSessionId={agent.currentSessionId}
        onLoadSession={agent.loadSessionMessages}
        onDeleteSession={async (sessionId) => {
          await window.electronAPI.invoke('agent:deleteSession', { sessionId })
          if (agent.currentSessionId === sessionId) {
            chatState.setChatMessages([])
            agent.setCurrentSessionId('session-' + Date.now())
          }
          agent.loadSessions()
        }}
        onNewSession={() => {
          agent.setCurrentSessionId('session-' + Date.now())
          chatState.setChatMessages([])
          resetAgentState()
          agent.loadSessions()
        }}
      />

      <Content style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 var(--space-md)' }}>
        <div className="smart-design-chat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Space>
              <Button
                size="small"
                type="text"
                icon={<HistoryOutlined />}
                onClick={() => agent.setSidebarCollapsed(!agent.sidebarCollapsed)}
                title={agent.sidebarCollapsed ? '打开对话历史' : '关闭对话历史'}
              />
              <RobotOutlined style={{ fontSize: 18, color: 'var(--color-primary)' }} />
              <Text strong style={{ fontSize: 16 }}>智能设计助手</Text>
            </Space>
            <Space size={8}>
              <Segmented
                size="small"
                value={agent.agentRunMode}
                onChange={val => agent.setAgentRunMode(val)}
                options={[
                  { label: '协作', value: 'collaborative', icon: <TeamOutlined /> },
                  { label: '全自动', value: 'auto', icon: <ThunderboltOutlined /> }
                ]}
              />
            </Space>
          </div>

          <div className="smart-chat-list">
        {chatState.chatMessages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <BulbOutlined style={{ fontSize: 48, color: '#faad14', marginBottom: 16 }} />
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--color-text)' }}>智能设计助手</div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
              用自然语言描述你的需求，AI 将帮你完成配合比设计和优化
            </Text>
            <Space wrap>
              {QUICK_PROMPTS.map((item, i) => (
                <Button
                  key={i}
                  onClick={() => handleQuickPrompt(item.message)}
                  className={item.isSlash ? 'slash-quick-btn' : ''}
                  icon={item.isSlash ? <AppstoreOutlined /> : null}
                >
                  {item.label}
                </Button>
              ))}
            </Space>
          </div>
        ) : (
          <List
            dataSource={chatState.chatMessages}
            renderItem={(item) => {
              // Agent 进度消息——内嵌在消息流中，位于用户消息之后、AI回复之前
              if (item._agentProgress) {
                return (
                  <List.Item style={{ border: 'none', padding: '4px 0 4px 48px' }}>
                    <div style={{ width: '100%' }}>
                      <AgentProgressCard
                        steps={item.steps || []}
                        status={item.status}
                        isPaused={item.isPaused}
                        showControls={item.status === 'running'}
                        latestReasoning={item.latestReasoning}
                        onPause={() => { agent.setAgentPaused(true); window.electronAPI.invoke('agent:pause', { requestId: agent.agentRequestIdRef.current }) }}
                        onResume={() => { agent.setAgentPaused(false); window.electronAPI.invoke('agent:resume', { requestId: agent.agentRequestIdRef.current }) }}
                        onAbort={() => { window.electronAPI.invoke('agent:abort', { requestId: agent.agentRequestIdRef.current }); chatState.setChatLoading(false); agent.setAgentStatus(null) }}
                      />
                      {agent.pendingConfirmation && (
                        <DecisionGate
                          toolName={agent.pendingConfirmation.toolName}
                          args={agent.pendingConfirmation.args}
                          onConfirm={(args) => { window.electronAPI.invoke('agent:confirm', { confirmed: true, args }); agent.setPendingConfirmation(null) }}
                          onReject={() => { window.electronAPI.invoke('agent:confirm', { confirmed: false }); agent.setPendingConfirmation(null) }}
                        />
                      )}
                    </div>
                  </List.Item>
                )
              }
              return (
              <List.Item className={item.role === 'user' ? 'smart-chat-item-user' : 'smart-chat-item-assistant'}>
                <Space align="start" style={{ width: item.role === 'user' ? 'auto' : '100%' }}>
                  {item.role === 'assistant' && <Avatar icon={<RobotOutlined />} className="chat-avatar" />}
                  {item.role === 'assistant' ? (
                    <div className="smart-chat-body-assistant" style={{ flex: 1, minWidth: 0 }}>
                      {item.toolCall && item.toolCall.status === 'done' && (
                        <>
                          {item.toolCall.type === 'mix_design' && (
                            <MixDesignResultCard data={item.toolCall.data} onSave={handleSaveFromCard} onSaveBasicMix={chatState.setBasicMixModalData} />
                          )}
                          {item.toolCall.type === 'optimization' && (
                            <OptimizationResultCard data={item.toolCall.data} onSave={handleSaveFromCard} />
                          )}
                          {item.toolCall.type === 'sales_quote' && (
                            <SalesQuoteResultCard data={item.toolCall.data} pumpingFeeItems={chatState.pumpingFeeItems} />
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
                                checked={chatState.contrastPickerSelected.includes(opt.value)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    chatState.setContrastPickerSelected(prev => [...prev, opt.value])
                                  } else {
                                    chatState.setContrastPickerSelected(prev => prev.filter(v => v !== opt.value))
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
                              item.materialPicker.onSelect([...chatState.contrastPickerSelected])
                              chatState.setContrastPickerSelected([])
                            }}
                          >
                            确认对比
                          </Button>
                        </div>
                      )}
                      {item.toolEvents?.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          {item.toolEvents.map(tool => (
                            <ToolCallBubble
                              key={tool.id}
                              status={tool.status}
                              toolName={tool.toolName}
                              summary={tool.summary}
                              error={tool.error}
                            />
                          ))}
                        </div>
                      )}
                      {!item.toolEvents?.length && item.toolCall?.status === 'loading' && (
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
                              if (opt === '手动选择材料' && chatState.pendingMaterialPicker) {
                                chatState.setPendingMaterialPicker(null)
                              } else if (opt === '继续分析' && chatState.pendingMaterialPicker) {
                                executeAnalysis(chatState.pendingMaterialPicker.mixDesigns, chatState.pendingMaterialPicker.materialMapping, { customPrompt: chatState.chatInput })
                                chatState.setPendingMaterialPicker(null)
                              }
                            }}>
                              {opt}
                            </Button>
                          ))}
                        </div>
                      )}
                      {item.reasoning && (
                        <div style={{ marginBottom: 8, padding: '8px 12px', background: '#f6f8fa', borderRadius: 6, fontSize: 13, color: '#666', lineHeight: 1.6, maxHeight: 200, overflowY: 'auto' }}>
                          <div style={{ fontWeight: 500, marginBottom: 4, color: '#333' }}>思考过程</div>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>{item.reasoning}</pre>
                        </div>
                      )}
                      <div className="chat-markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content || (item.streaming ? 'AI 正在生成...' : '')}</ReactMarkdown>
                      </div>
                      {item.materialPicker && !chatState.isMaterialPickerDone(item.materialPicker.pickerId) && item.materialPicker.type !== 'contrast_selection' && (
                        <MaterialPicker
                          materials={item.materialPicker.materials || chatState.pendingMaterialPicker?.allMaterials}
                          onConfirm={(selectedMaterials) => handleMaterialConfirm(selectedMaterials, item.materialPicker.pickerId)}
                        />
                      )}
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
            )
          }}
          />
        )}
        {chatState.pendingMaterialPicker && (() => {
          const q = buildPerMixMaterialQueue(
            chatState.pendingMaterialPicker.mixDesigns,
            chatState.pendingMaterialPicker.materialMapping
          )
          const active = q[0]
          const activeTokens = active
            ? new Set(active.slots.map(s => s.token))
            : new Set(chatState.pendingMaterialPicker.unmatchedMaterials || [])
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
                key={chatState.pendingMaterialPicker.pickerKey || 'analysis-material-picker'}
                materials={filterMaterialsForUnmatched(
                  chatState.pendingMaterialPicker.allMaterials || [],
                  activeTokens
                )}
                onConfirm={(selectedMaterials) => handleMaterialConfirm(selectedMaterials)}
              />
            </div>
          )
        })()}
        <div ref={chatState.chatEndRef} />
      </div>

      <div className="smart-chat-tags-row">
        {chatState.attachment && (
          <Tag
            icon={chatState.attachment.type === 'xlsx' ? <FileExcelOutlined /> : <FileTextOutlined />}
            closable
            onClose={() => chatState.setAttachment(null)}
            className="attachment-tag"
          >
            {chatState.attachment.name}
          </Tag>
        )}
        {chatState.analysisMode && (
          <Tag icon={<BarChartOutlined />} color="blue" className="analysis-mode-tag">
            分析模式
            <DeleteOutlined style={{ marginLeft: 4, cursor: 'pointer' }} onClick={() => {
              chatState.setAnalysisMode(false)
              chatState.setAnalysisData(null)
              chatState.setAnalysisResult(null)
              chatState.setPendingMaterialPicker(null)
            }} />
          </Tag>
        )}
      </div>
      <div className="smart-chat-input-area" style={{ position: 'relative' }}>
        <SlashCommandMenu
          visible={slashMenuVisible}
          skills={availableSkills}
          onSelect={handleSkillSelect}
          onClose={handleSlashMenuClose}
        />
        <Input
          placeholder={chatState.analysisMode ? '输入你的追问，或继续对话...' : '输入 "/" 查看可用技能，或直接输入需求...'}
          value={chatState.chatInput}
          onChange={handleInputChange}
          onPressEnter={handleSendChat}
          disabled={chatState.chatLoading}
          prefix={<AppstoreOutlined style={{ color: '#bfbfbf', marginRight: 4 }} />}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <Space size={0}>
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                const type = getAttachmentType(file.name)
                if (type === 'unsupported') {
                  message.error('仅支持Excel和Markdown文件')
                  return false
                }
                chatState.setAttachment({ file, type, name: file.name })
                return false
              }}
            >
              <Button type="text" size="small" icon={<PlusOutlined />} title="上传附件" />
            </Upload>
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClearChat}
              disabled={chatState.chatMessages.length === 0}
              title="清空对话"
            />
          </Space>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSendChat}
            loading={chatState.chatLoading}
            disabled={!chatState.chatInput.trim()}
          />
        </div>
      </div>
      <SaveBasicMixModal
        open={!!chatState.basicMixModalData}
        data={chatState.basicMixModalData}
        onCancel={() => chatState.setBasicMixModalData(null)}
        onSaved={() => chatState.setBasicMixModalData(null)}
      />
    </div>
    </Content>
    </Layout>
  )
}

export default SmartDesignChat

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Input, Space, Avatar, List, Alert, message, Modal, Typography, Upload, Tag, Checkbox, Segmented, Layout, Tooltip } from 'antd'
import { SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, BulbOutlined, PlusOutlined, DeleteOutlined, FileTextOutlined, FileExcelOutlined, BarChartOutlined, HistoryOutlined, ThunderboltOutlined, TeamOutlined, AppstoreOutlined, SettingOutlined, FolderOpenOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolCallBubble from './ToolCallBubble'
import ToolMessageBubble from './ToolMessageBubble'
import StreamingAgentCard from './StreamingAgentCard'
import MixDesignResultCard from './MixDesignResultCard'
import OptimizationResultCard from './OptimizationResultCard'
import MaterialCompareCard from './MaterialCompareCard'
import MaterialPicker from './MaterialPicker'
import DiagnosisResultCard from './DiagnosisResultCard'
import ComplianceResultCard from './ComplianceResultCard'
import SalesQuoteResultCard from './SalesQuoteResultCard'
import SaveBasicMixModal from './SaveBasicMixModal'
import AgentRulesModal from './AgentRulesModal'
import DecisionGate from './DecisionGate'
import MemorySidebar from './MemorySidebar'
import SlashCommandMenu from './SlashCommandMenu'
import useChatState from '../hooks/useChatState'
import { AgentStoreProvider, useAgentStore } from './AgentStore'
import useAgentMode from './AgentMode'
import { sendMessage, abortAgent, loadSessionList, switchSession, useAssistantPersistence } from './agentActions'
import { getAttachmentType, processExcelAttachment, processMarkdownAttachment, filterMaterialsForUnmatched } from '../utils/attachmentHelper'
import { AnalysisReport } from '../pages/AIAnalysisPage_Results'
import { getAllMaterials } from '../services/MaterialService'
import { buildAnalysisData, MATERIAL_TYPE_MAP } from '../pages/AIAnalysisPage_Upload'
import { parseMixedMessage, isInCommandMode, tabComplete, buildAllCommandNames } from '../utils/slashCommandParser'

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

/**
 * MessageContent (spec 6.1)
 * 统一渲染消息文本部分，处理 4 个分支：
 * 1. user  → 直接渲染
 * 2. assistant streaming → 流式内容 + 光标
 * 3. assistant thinking → "AI 正在思考" 占位
 * 4. assistant aborted → 文本 + [已停止] 标签
 *
 * 注意：toolCall 卡片 / materialPicker / analysisReport 等复杂业务渲染不在本组件内，
 * 由 SmartDesignChat 主体保留处理（不在 Task 9 重构范围）。
 */
function MessageContent({ item, agentStatus, agentReplyText }) {
  if (item.role !== 'assistant') {
    return <ReactMarkdown>{item.content}</ReactMarkdown>
  }
  if (agentStatus === 'thinking' && item._streaming) {
    return <div className="ai-thinking">AI 正在思考<span className="ai-thinking-text"></span></div>
  }
  if (agentStatus === 'streaming' && item._streaming) {
    return (
      <div className="chat-markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentReplyText || item.content}</ReactMarkdown>
        <span className="streaming-cursor">|</span>
      </div>
    )
  }
  if ((item.stopReason === 'aborted' || item.stopReason === 'error')) {
    return (
      <div className="chat-markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
        <span className="aborted-tag">[已停止]</span>
      </div>
    )
  }
  return (
    <div className="chat-markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
    </div>
  )
}

const SmartDesignChat = () => {
  // ===== Hooks =====
  const chatState = useChatState()
  const { state, dispatch } = useAgentStore()
  const { agentRequestIdRef } = useAgentMode() // 纯事件监听器
  useAssistantPersistence() // 副作用 hook（done/aborted 时自动持久化）

  const streamSeqRef = useRef({ current: 0 })
  const inputRef = useRef(null)
  const slashMenuApiRef = useRef({ moveSelection: () => {}, getSelectedIndex: () => 0 })

  // 派生：Agent 是否在工作中（流式/思考/工具调用）
  const isAgentBusy = ['streaming', 'thinking', 'tool_calling'].includes(state.agent.status)

  // 仅在消息条数变化时刷新会话列表（避免流式输出时频繁刷新）
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    const count = state.messages?.length || 0
    if (count !== prevMsgCountRef.current && count > 0) {
      prevMsgCountRef.current = count
      loadSessionList({ dispatch })
    }
  }, [state.messages?.length, dispatch])

  // ===== 斜杠命令状态 =====
  const [slashMenuVisible, setSlashMenuVisible] = useState(false)
  const [availableSkills, setAvailableSkills] = useState([])
  const [cursorPos, setCursorPos] = useState(0)

  // 由光标位置和输入内容决定是否显示斜杠菜单
  const showSlashMenu = isInCommandMode(state.input, cursorPos)

  // ===== 智能助手规则 Modal =====
  const [rulesModalOpen, setRulesModalOpen] = useState(false)

  // ===== 工作区抽屉 =====
  const [workspacePath, setWorkspacePath] = useState(null)

  // 加载当前工作区状态
  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const current = await window.electronAPI.workspace.current()
        if (current && current.path) {
          setWorkspacePath(current.path)
        }
      } catch (err) {
        console.warn('[WorkspaceIndicator] 加载工作区状态失败:', err)
      }
    }
    loadWorkspace()
  }, [])

  const handleWorkspaceClick = async () => {
    try {
      const result = await window.electronAPI.workspace.pickFolder()
      if (result.canceled) return
      setWorkspacePath(result.path)
    } catch (err) {
      console.error('[WorkspaceIndicator] 选择工作区失败:', err)
    }
  }

  // 提取文件夹名（basename）
  const workspaceBasename = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop()
    : null

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
    // 初始化加载会话列表并恢复上次的会话
    const initSessions = async () => {
      try {
        const sessions = await loadSessionList({ dispatch })
        if (sessions && sessions.length > 0) {
          // 恢复最近的会话
          const latestSession = sessions[0]
          await switchSession({ dispatch, sessionId: latestSession.sessionId })
        }
      } catch (error) {
        console.warn('[SmartDesignChat] 初始化加载会话失败:', error)
      }
    }
    initSessions()
  }, [loadSkills, dispatch])

  // 当菜单打开时重新加载（确保最新）
  useEffect(() => {
    if (showSlashMenu && availableSkills.length === 0) {
      loadSkills()
    }
  }, [showSlashMenu, availableSkills.length, loadSkills])

  // 监听输入变化，同步光标位置
  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value
    dispatch({ type: 'SET_INPUT', payload: newValue })
    setTimeout(() => {
      if (inputRef.current) {
        setCursorPos(inputRef.current.selectionStart)
      }
    }, 0)
  }, [dispatch])

  // 选择技能
  const handleSkillSelect = useCallback((skill) => {
    dispatch({ type: 'SET_INPUT', payload: `/${skill.name} ` })
    setSlashMenuVisible(false)
    // 聚焦到输入框
    setTimeout(() => {
      const input = document.querySelector('.smart-chat-input-area input')
      if (input) input.focus()
    }, 100)
  }, [dispatch])

  // 关闭菜单
  const handleSlashMenuClose = useCallback(() => {
    setSlashMenuVisible(false)
  }, [])

  // 光标选择事件
  const handleInputSelect = useCallback((e) => {
    setCursorPos(e.target.selectionStart)
  }, [])

  // 添加系统消息
  const appendSystemMessage = useCallback((content) => {
    dispatch({
      type: 'ADD_MESSAGE',
      payload: { id: `sys-${Date.now()}`, role: 'system', content, timestamp: Date.now() }
    })
  }, [dispatch])

  // 添加技能结果消息
  const appendSkillResult = useCallback((result) => {
    dispatch({
      type: 'ADD_MESSAGE',
      payload: {
        id: `skill-${Date.now()}`,
        role: 'assistant',
        content: result.message || '技能执行完成',
        timestamp: Date.now(),
        toolCall: result.data ? { status: 'done', type: result.type, data: result.data } : null
      }
    })
  }, [dispatch])

  // 清空对话（先中止运行中的 Agent，再重置状态）
  // 前置声明原因：handleClearCommand / handleSend 的 useCallback 依赖数组引用了它，
  // 若在它之前声明则触发 TDZ（暂时性死区），生产构建 minify 后会报
  // "Cannot access 'X' before initialization" 并导致白屏。
  const handleClearChat = async () => {
    if (state.agent.requestId) {
      abortAgent({ dispatch, requestId: state.agent.requestId })
    }
    await chatState.handleClearChat()
    dispatch({ type: 'CLEAR_MESSAGES' })
    dispatch({ type: 'RESET_AGENT' })
  }

  // 键盘事件 handler (spec 7.1)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && isAgentBusy) {
      e.preventDefault()
      abortAgent({ dispatch, requestId: state.agent.requestId })
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isAgentBusy && !state.input.trim()) {
        e.preventDefault()
        abortAgent({ dispatch, requestId: state.agent.requestId })
      }
    }
  }

  // /clear 命令确认
  const handleClearCommand = useCallback(() => {
    Modal.confirm({
      title: '清空当前对话',
      content: '确定要清空当前对话吗？此操作不可恢复。',
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => { handleClearChat(); message.success('对话已清空') }
    })
  }, [handleClearChat])

  // 执行剩余命令和文本
  const executeRemainingCommands = useCallback(async (commandParts, textParts) => {
    // 用可变数组（const 但元素可 push）收集所有要发给 LLM 的文本段
    const messagesToSend = [...textParts]
    for (const part of commandParts) {
      const result = await window.electronAPI.invoke('slash:execute', { command: part.command, param: part.param })
      if (result.success) {
        if (result.action === 'list' || result.action === 'help') {
          appendSystemMessage(result.message)
        } else if (result.action === 'skill_prompt') {
          // 调技能语义：告诉 LLM 我要用这个技能来做这个事情。
          // 加一条 system 消息提示 LLM 用户的明确意图
          appendSystemMessage(`[用户希望使用 ${result.skillName} 技能]`)
          // 把 prompt（或 skillName）拼到文本段，最后作为 user message 发给 LLM
          // 真正的结构化参数（cementId/sandIds 等）由 LLM 工具调用机制自然处理
          if (result.prompt) {
            messagesToSend.push(result.prompt)
          } else {
            messagesToSend.push(`请使用 ${result.skillName} 技能`)
          }
        } else if (result.action === 'skill') {
          appendSkillResult(result)
        } else {
          message.success(result.message)
        }
      } else {
        message.error(result.error)
        dispatch({ type: 'SET_INPUT', payload: '' })
        return
      }
    }
    if (messagesToSend.length > 0) {
      await sendMessage({
        dispatch,
        sessionId: state.session.currentId,
        message: messagesToSend.join(' '),
        runMode: state.agent.runMode
      })
    }
    dispatch({ type: 'SET_INPUT', payload: '' })
  }, [dispatch, state.session.currentId, state.agent.runMode, appendSystemMessage, appendSkillResult])

  // 统一发送处理（支持混合命令+文本）
  // 发送聊天消息（统一使用 Agent 模式）
  // 注意：user 消息的 dispatch 由 sendMessage 内部统一处理，避免重复添加
  const handleSendChat = async () => {
    if (!state.input.trim() || isAgentBusy) return

    const userMessage = state.input.trim()
    dispatch({ type: 'SET_INPUT', payload: '' })
    chatState.setAttachment(null)

    await sendMessage({
      dispatch,
      sessionId: state.session.currentId,
      message: userMessage,
      runMode: state.agent.runMode
    })
  }
  const handleSend = useCallback(async () => {
    const input = state.input
    if (!input.trim()) return

    if (input.trim() === '/clear') {
      handleClearCommand()
      dispatch({ type: 'SET_INPUT', payload: '' })
      return
    }

    const parts = parseMixedMessage(input)
    const textParts = parts.filter(p => p.type === 'text').map(p => p.content)
    const commandParts = parts.filter(p => p.type === 'command')

    // 无命令时走原有发送逻辑
    if (commandParts.length === 0) {
      await handleSendChat()
      return
    }

    const realCommandParts = commandParts.filter(p => p.command !== 'clear')
    const hasClearInParts = commandParts.some(p => p.command === 'clear')

    if (hasClearInParts) {
      Modal.confirm({
        title: '清空当前对话',
        content: '消息中包含 /clear 命令，确定要清空当前对话吗？',
        okText: '清空',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => { handleClearChat(); executeRemainingCommands(realCommandParts, textParts) },
        onCancel: () => { dispatch({ type: 'SET_INPUT', payload: '' }) }
      })
      return
    }

    await executeRemainingCommands(commandParts, textParts)
  }, [state.input, state.session.currentId, state.agent.runMode, handleClearCommand, handleClearChat, handleSendChat, executeRemainingCommands, dispatch])

  // 输入框键盘事件（斜杠菜单导航 + Tab 补全 + Enter 发送）
  const handleInputKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown' && showSlashMenu) {
      e.preventDefault()
      slashMenuApiRef.current.moveSelection(1)
      return
    }
    if (e.key === 'ArrowUp' && showSlashMenu) {
      e.preventDefault()
      slashMenuApiRef.current.moveSelection(-1)
      return
    }
    if (e.key === 'Tab') {
      if (isInCommandMode(state.input, cursorPos)) {
        e.preventDefault()
        const allCmds = buildAllCommandNames(availableSkills)
        const result = tabComplete(state.input, cursorPos, allCmds)
        dispatch({ type: 'SET_INPUT', payload: result.newInput })
        setCursorPos(result.newCursor)
        setTimeout(() => {
          if (inputRef.current) inputRef.current.setSelectionRange(result.newCursor, result.newCursor)
        }, 0)
      }
      return
    }
    if (e.key === 'Escape' && isAgentBusy) {
      e.preventDefault()
      abortAgent({ dispatch, requestId: state.agent.requestId })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isAgentBusy && !state.input.trim()) {
        abortAgent({ dispatch, requestId: state.agent.requestId })
      } else {
        handleSend()
      }
    }
  }, [showSlashMenu, state.input, state.agent.requestId, cursorPos, availableSkills, isAgentBusy, dispatch, handleSend])

  // ===== 流式聊天辅助函数 =====
  const createStreamRequestId = () => {
    streamSeqRef.current += 1
    return `smart-chat-stream-${Date.now()}-${streamSeqRef.current}`
  }

  const updateStreamMessage = (streamId, updater) => {
    dispatch({ type: 'SET_MESSAGES', payload: state.messages.map(item => (
      item.streamId === streamId ? updater(item) : item
    )) })
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

    dispatch({ type: 'ADD_MESSAGE', payload: {
      role: 'assistant',
      content: '',
      streamId,
      streaming: true,
      toolEvents: []
    } })

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
      dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: summary } })
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
      dispatch({ type: 'SET_INPUT', payload: summary.join('；') })
      executeAnalysis(chatState.pendingMaterialPicker.mixDesigns, newMapping, { customPrompt })
      chatState.setPendingMaterialPicker(null)
      return
    }

    const next = nextQueue[0]
    dispatch({ type: 'ADD_MESSAGE', payload: {
      role: 'assistant',
      content: `编号 **${current.mixId}** 已补充完成。请继续为 **编号 ${next.mixId}**（${next.strengthGrade || '—'}）选择材料：`
    } })
    chatState.setPendingMaterialPicker({
      ...chatState.pendingMaterialPicker,
      materialMapping: newMapping,
      materialPickSummary: summary,
      pickerKey: `${Date.now()}-${next.mixId}-${next.slots.length}`
    })
    dispatch({ type: 'SET_INPUT', payload: msg })
    message.success(`编号 ${current.mixId} 材料已保存`)
  }

  // 进入分析模式
  const handleEnterAnalysisMode = async (attachment, userMessage) => {
    chatState.setAnalysisMode(true)

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
              return
            }
            const first = perMixQueue[0]
            const mixCount = perMixQueue.length
            dispatch({ type: 'ADD_MESSAGE', payload: {
              role: 'assistant',
              content: mixCount > 1
                ? `有 **${mixCount}** 条配合比存在材料未自动匹配（共 ${result.unmatchedMaterials.size} 类名称未对上库），将**按表格顺序逐条**补充。\n\n请先为 **编号 ${first.mixId}**（${first.strengthGrade || '—'}）选择材料：`
                : `检测到 **${result.unmatchedMaterials.size}** 类材料未能自动匹配。\n\n请为 **编号 ${first.mixId}**（${first.strengthGrade || '—'}）选择材料：`
            } })
            chatState.setPendingMaterialPicker({
              mixDesigns,
              materialMapping,
              allMaterials: allMaterials || [],
              unmatchedMaterials: result.unmatchedMaterials,
              initialUserPrompt: userMessage || '',
              materialPickSummary: [],
              pickerKey: `${Date.now()}-${first.mixId}-${first.slots.length}`
            })
            return
          }
        } else if (attachment.type === 'md') {
          const content = await processMarkdownAttachment(attachment.file)
          // 将 Markdown 内容发送给 AI 分析
          const mdMessage = `请分析以下 Markdown 文档内容：\n\n${content}`
          dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: mdMessage } })
          await runStreamingChat(mdMessage)
          return
        }
      } else if (userMessage) {
        dispatch({ type: 'ADD_MESSAGE', payload: {
          role: 'assistant',
          content: '正在分析文本中的配合比数据...'
        } })
      }

      // 执行分析（使用用户发送时的文案作为试验目的等补充说明）
      await executeAnalysis(mixDesigns, materialMapping, { customPrompt: userMessage })
    } catch (error) {
      message.error('进入分析模式失败: ' + error.message)
      chatState.setAnalysisMode(false)
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

      dispatch({ type: 'ADD_MESSAGE', payload: { role: 'assistant', content, analysisReport: report } })
      chatState.setAnalysisResult(report)
    } catch (error) {
      message.error('分析执行失败: ' + error.message)
      chatState.setAnalysisMode(false)
    }
  }

  // 执行AI分析
  const executeAnalysis = async (mixDesigns, materialMapping, opts = {}) => {
    try {
      const effectivePrompt = opts.customPrompt !== undefined && opts.customPrompt !== null ? opts.customPrompt : state.input

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

        dispatch({ type: 'ADD_MESSAGE', payload: chatMsg })
        chatState.setContrastPickerSelected([])
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

      dispatch({ type: 'ADD_MESSAGE', payload: chatMsg })
      chatState.setAnalysisResult(report)
    } catch (error) {
      message.error('分析执行失败: ' + error.message)
      chatState.setAnalysisMode(false)
    }
  }

  // 分析模式后续追问
  const handleAnalysisFollowUp = async (userMessage) => {
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
    }
  }

  // 设计模式处理（原有些逻辑）
  const handleDesignMode = async (userMessage, extraContext = {}) => {
    try {
      await runStreamingChat(userMessage, { ...extraContext })
    } catch (error) {
      message.error('发送消息失败: ' + error.message)
    }
  }


  const handleQuickPrompt = (msg) => {
    if (msg === '/') {
      // 显示斜杠命令菜单
      dispatch({ type: 'SET_INPUT', payload: '/' })
      setSlashMenuVisible(true)
    } else {
      dispatch({ type: 'SET_INPUT', payload: msg })
    }
  }

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      {/* 记忆侧栏 — 折叠时不渲染；state 由 MemorySidebar 内部从 AgentStore 读 */}
      {!state.session.sidebarCollapsed && (
        <MemorySidebar
          onToggle={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: true })}
        />
      )}

      <Content style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 var(--space-md)' }}>
        <div className="smart-design-chat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Space>
              <Button
                size="small"
                type="text"
                icon={<HistoryOutlined />}
                onClick={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: !state.session.sidebarCollapsed })}
                title={state.session.sidebarCollapsed ? '打开对话历史' : '关闭对话历史'}
              />
              <RobotOutlined style={{ fontSize: 18, color: 'var(--color-primary)' }} />
              <Text strong style={{ fontSize: 16 }}>智能设计助手</Text>
            </Space>
            <Space size={8}>
              <Segmented
                size="small"
                value={state.agent.runMode}
                onChange={val => dispatch({ type: 'SET_RUN_MODE', payload: val })}
                options={[
                  { label: '协作', value: 'collaborative', icon: <TeamOutlined /> },
                  { label: '全自动', value: 'auto', icon: <ThunderboltOutlined /> }
                ]}
              />
              <Tooltip title="智能助手规则">
                <Button
                  type="text"
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={() => setRulesModalOpen(true)}
                />
              </Tooltip>
            </Space>
          </div>

          <div className="smart-chat-list">
        {state.messages.length === 0 ? (
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
            dataSource={state.messages}
            renderItem={(item) => {
              if (item.role === 'system') {
                return (
                  <List.Item className="smart-chat-item-system" style={{ padding: 0, border: 'none' }}>
                    <div style={{ background: '#f5f5f5', padding: '12px', borderRadius: 8, margin: '8px 0', width: '100%' }}>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{item.content}</pre>
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
                      {/* Agent 流式时间线（思考过程 + 工具调用，嵌入 AI 输出内部）— spec 7: pause/resume 由 Esc/Enter 替代 */}
                      {state.confirmation && (
                        <DecisionGate
                          toolName={state.confirmation.toolName}
                          args={state.confirmation.args}
                          onConfirm={(args) => { window.electronAPI.invoke('agent:confirm', { confirmed: true, args }); dispatch({ type: 'SET_CONFIRMATION', payload: null }) }}
                          onReject={() => { window.electronAPI.invoke('agent:confirm', { confirmed: false }); dispatch({ type: 'SET_CONFIRMATION', payload: null }) }}
                        />
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
                                executeAnalysis(chatState.pendingMaterialPicker.mixDesigns, chatState.pendingMaterialPicker.materialMapping, { customPrompt: state.input })
                                chatState.setPendingMaterialPicker(null)
                              }
                            }}>
                              {opt}
                            </Button>
                          ))}
                        </div>
                      )}
                      {item.timeline && item.timeline.length > 0 && (
                        <StreamingAgentCard
                          timeline={item.timeline}
                          status="done"
                        />
                      )}
                      <MessageContent
                        item={item}
                        agentStatus={state.agent.status}
                        agentReplyText={state.agent.replyText}
                      />
                      {item.materialPicker && !chatState.isMaterialPickerDone(item.materialPicker.pickerId) && item.materialPicker.type !== 'contrast_selection' && (
                        <MaterialPicker
                          materials={item.materialPicker.materials || chatState.pendingMaterialPicker?.allMaterials}
                          onConfirm={(selectedMaterials) => handleMaterialConfirm(selectedMaterials, item.materialPicker.pickerId)}
                        />
                      )}
                    </div>
                  ) : (
                    item.role === 'tool' ? (
                      <ToolMessageBubble content={item.content} />
                    ) : (
                      <div className="smart-chat-bubble-user">
                        {item.attachment && (
                          <Tag icon={item.attachment.type === 'xlsx' ? <FileExcelOutlined /> : <FileTextOutlined />} style={{ marginBottom: 8, color: 'inherit' }}>
                            {item.attachment.name}
                          </Tag>
                        )}
                        {item.content}
                      </div>
                    )
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
          visible={showSlashMenu}
          input={state.input}
          cursorPos={cursorPos}
          allCommandNames={buildAllCommandNames(availableSkills)}
          menuApiRef={slashMenuApiRef}
          onSelect={(name) => {
            const beforeCursor = state.input.slice(0, cursorPos)
            const lastSpaceIdx = beforeCursor.lastIndexOf(' ')
            const cmdSegment = lastSpaceIdx === -1 ? beforeCursor : beforeCursor.slice(lastSpaceIdx + 1)
            const newBefore = beforeCursor.slice(0, beforeCursor.length - cmdSegment.length) + `/${name}`
            dispatch({ type: 'SET_INPUT', payload: newBefore + state.input.slice(cursorPos) })
            setCursorPos(newBefore.length)
            setTimeout(() => {
              if (inputRef.current) {
                inputRef.current.setSelectionRange(newBefore.length, newBefore.length)
                inputRef.current.focus()
              }
            }, 0)
          }}
          onClose={() => {
            dispatch({ type: 'SET_INPUT', payload: state.input + ' ' })
            setCursorPos(state.input.length + 1)
          }}
          position={{ bottom: 80, left: 16, right: 16 }}
        />
        {/* Stop hint (spec 7.3): 工作态时提示 Esc/Enter 停止 */}
        {['streaming', 'thinking', 'tool_calling'].includes(state.agent.status) && (
          <div className="stop-hint">
            AI 正在输出中... 按 Esc 停止（输入框为空时也可按 Enter）
          </div>
        )}
        <Input
          ref={inputRef}
          placeholder={chatState.analysisMode ? '输入你的追问，或继续对话...' : '输入 "/" 查看可用技能，或直接输入需求...'}
          value={state.input}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onSelect={handleInputSelect}
          disabled={isAgentBusy}
          prefix={<AppstoreOutlined style={{ color: '#bfbfbf', marginRight: 4 }} />}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <Space size={0}>
            {/* 工作区指示器（左侧） */}
            <Button
              type="text"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={handleWorkspaceClick}
              style={{ color: workspacePath ? 'var(--color-primary)' : undefined }}
              title={workspacePath || '点击选择工作区'}
            >
              {workspaceBasename ? `📁 ${workspaceBasename}` : '📁 打开工作区'}
            </Button>
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
              disabled={state.messages.length === 0}
              title="清空对话"
            />
          </Space>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSendChat}
            loading={isAgentBusy}
            disabled={!state.input.trim()}
          />
        </div>
      </div>
      <SaveBasicMixModal
        open={!!chatState.basicMixModalData}
        data={chatState.basicMixModalData}
        onCancel={() => chatState.setBasicMixModalData(null)}
        onSaved={() => chatState.setBasicMixModalData(null)}
      />
      <AgentRulesModal
        visible={rulesModalOpen}
        onClose={() => setRulesModalOpen(false)}
      />
    </div>
    </Content>
    </Layout>
  )
}

export default function SmartDesignChatWrapper(props) {
  return (
    <AgentStoreProvider>
      <SmartDesignChat {...props} />
    </AgentStoreProvider>
  )
}

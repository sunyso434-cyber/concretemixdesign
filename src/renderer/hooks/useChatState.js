import { useState, useEffect, useRef } from 'react'
import { message } from 'antd'

/**
 * useChatState - 聊天公共状态 Hook
 *
 * 集中管理 SmartDesignChat 中各模式组件共享的状态：
 * - 聊天消息、输入框、加载状态
 * - 附件、分析模式相关状态
 * - 材料选择器状态（completedMaterialPickerIds, pendingMaterialPicker, contrastPickerSelected）
 * - 基础配合比弹窗数据
 * - 泵送费数据
 * - chatEndRef 自动滚动
 */
const useChatState = () => {
  // ===== 核心聊天状态 =====
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [attachment, setAttachment] = useState(null)

  // ===== 分析模式状态 =====
  const [analysisMode, setAnalysisMode] = useState(false)
  const [analysisData, setAnalysisData] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)

  // ===== 材料选择器状态 =====
  const [completedMaterialPickerIds, setCompletedMaterialPickerIds] = useState(() => new Set())
  const [pendingMaterialPicker, setPendingMaterialPicker] = useState(null)
  const [contrastPickerSelected, setContrastPickerSelected] = useState([])

  // ===== 其他共享状态 =====
  const [basicMixModalData, setBasicMixModalData] = useState(null)
  const [pumpingFeeItems, setPumpingFeeItems] = useState([])

  // ===== Refs =====
  const chatEndRef = useRef(null)
  const materialPickerSeqRef = useRef(0)

  // ===== 自动滚动到底部 =====
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, pendingMaterialPicker?.pickerKey])

  // ===== 初始化泵送费数据 =====
  useEffect(() => {
    window.electronAPI.invoke('salesQuote:listEnabledPumpingFeeItems')
      .then(r => { if (r.success) setPumpingFeeItems(r.data) })
      .catch(() => {})
  }, [])

  // ===== 材料选择器辅助函数 =====
  const createMaterialPickerId = () => {
    materialPickerSeqRef.current += 1
    return `material-picker-${Date.now()}-${materialPickerSeqRef.current}`
  }

  const markMaterialPickerDone = (pickerId) => {
    if (!pickerId) return
    setCompletedMaterialPickerIds(prev => {
      const next = new Set(prev)
      next.add(pickerId)
      return next
    })
  }

  const isMaterialPickerDone = (pickerId) => pickerId && completedMaterialPickerIds.has(pickerId)

  // ===== 清空对话 =====
  const handleClearChat = async () => {
    try {
      await window.electronAPI.invoke('aiAnalysis:clearHistory')
      setChatMessages([])
      setCompletedMaterialPickerIds(new Set())
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

  return {
    // 聊天核心
    chatMessages, setChatMessages,
    chatInput, setChatInput,
    chatLoading, setChatLoading,
    attachment, setAttachment,

    // 分析模式
    analysisMode, setAnalysisMode,
    analysisData, setAnalysisData,
    analysisResult, setAnalysisResult,

    // 材料选择器
    completedMaterialPickerIds, setCompletedMaterialPickerIds,
    pendingMaterialPicker, setPendingMaterialPicker,
    contrastPickerSelected, setContrastPickerSelected,

    // 其他
    basicMixModalData, setBasicMixModalData,
    pumpingFeeItems, setPumpingFeeItems,

    // Refs
    chatEndRef,
    materialPickerSeqRef,

    // 函数
    createMaterialPickerId,
    markMaterialPickerDone,
    isMaterialPickerDone,
    handleClearChat,
  }
}

export default useChatState

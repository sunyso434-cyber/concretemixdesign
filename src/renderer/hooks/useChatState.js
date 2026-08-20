import { useState, useEffect, useRef, useCallback } from 'react'
import { message } from 'antd'
import { useAgentStore } from '../components/AgentStore'
import { handleCompressContextImpl } from './useChatState.compress'

/**
 * useChatState - 聊天公共状态 Hook（非 Agent 状态）
 *
 * 集中管理 SmartDesignChat 中各模式组件共享的非 Agent 状态：
 * - 图片附件（attachments）
 * - chatEndRef 自动滚动
 *
 * 注：聊天消息（messages）、输入框（input）、加载状态（chatLoading）
 *      已迁到 AgentStore 的 reducer 中统一管理。
 */
const useChatState = () => {
  // ===== AgentStore（顶层调用，供压缩等回调使用） =====
  const { state, dispatch } = useAgentStore()

  // ===== 附件（图片） =====
  const [attachments, setAttachments] = useState([])

  // ===== Refs =====
  const chatEndRef = useRef(null)

  // ===== 清空对话（非 Agent 状态部分）=====
  // 注：messages 由 SmartDesignChat 显式 dispatch CLEAR_MESSAGES
  const handleClearChat = async () => {
    try {
      await window.electronAPI.invoke('aiAnalysis:clearHistory')
      setAttachments([])
      setPreviousSummary('')  // v8.4.2：清空对话时重置压缩摘要，避免新对话污染
      message.success('对话已清空')
    } catch (error) {
      console.error('清空对话失败:', error)
    }
  }

  // ===== 上下文压缩（v8.4.x 新增） =====
  const [isCompressing, setIsCompressing] = useState(false)
  const [previousSummary, setPreviousSummary] = useState('')

  // 调 IPC，dispatch COMPRESS_MESSAGES + SET_CONTEXT_STATS，更新 previousSummary
  // 实现拆到 useChatState.compress.js 的 handleCompressContextImpl 方便测试
  const handleCompressContext = useCallback(async () => {
    return handleCompressContextImpl({
      dispatch,
      setIsCompressing,
      setPreviousSummary,
      messages: state.messages,
      previousSummary,
      todos: state.todos  // 传入当前 todo，压缩后恢复未完成项
    })
  }, [dispatch, state.messages, previousSummary, state.todos])

  return {
    // 附件
    attachments, setAttachments,

    // Refs
    chatEndRef,

    // 函数
    handleClearChat,

    // ===== 上下文压缩（v8.4.x 新增） =====
    isCompressing,
    previousSummary, setPreviousSummary,
    handleCompressContext,
  }
}

export default useChatState

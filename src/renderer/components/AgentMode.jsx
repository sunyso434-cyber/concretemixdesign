import { useState, useEffect, useRef } from 'react'

/**
 * AgentMode hook - 从 SmartDesignChat 中提取的 Agent 模式状态和逻辑。
 *
 * @param {Object} opts
 * @param {Function} opts.setChatMessages - 更新聊天消息列表
 * @param {Function} opts.setChatLoading - 更新聊天加载状态
 */
export default function useAgentMode({ setChatMessages, setChatLoading }) {
  // ===== Agent 状态 =====
  const [agentEnabled, setAgentEnabled] = useState(true)  // 默认启用
  const [agentMode, setAgentMode] = useState('agent')     // 统一为agent模式
  const [agentRunMode, setAgentRunMode] = useState('collaborative') // 运行模式：collaborative | auto
  const [agentSteps, setAgentSteps] = useState([])
  const [agentStatus, setAgentStatus] = useState(null)
  const [agentPaused, setAgentPausedRaw] = useState(false)
  const setAgentPaused = (val) => {
    const resolved = typeof val === 'function' ? val(agentPausedRef.current) : val
    agentPausedRef.current = resolved
    setAgentPausedRaw(resolved)
  }
  const [pendingConfirmation, setPendingConfirmation] = useState(null)
  const [sessions, setSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(() => 'session-' + Date.now())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [sidebarTab, setSidebarTab] = useState('history')
  const [preferences, setPreferences] = useState({})
  const [corrections, setCorrections] = useState([])

  const agentRequestIdRef = useRef(null)
  const agentPausedRef = useRef(false)

  // 读取 Agent 设置（仅执行一次）
  useEffect(() => {
    window.electronAPI.invoke('get-param-by-name', 'agentDefaultMode')
      .then(defaultMode => {
        const runMode = defaultMode?.data?.value
        if (runMode === 'auto' || runMode === 'collaborative') {
          setAgentRunMode(runMode)
        }
      })
      .catch(() => {})
  }, [])

  // Agent进度监听
  useEffect(() => {
    const onProgress = (data) => {
      setAgentSteps(data.steps || [])
      setAgentStatus(data.status)
      // 更新/插入进度消息到消息列表（位于用户消息之后、AI回复之前）
      setChatMessages(prev => {
        const progressIdx = prev.findIndex(m => m._agentProgress && m._agentRequestId === agentRequestIdRef.current)
        const progressMsg = {
          _agentProgress: true,
          _agentRequestId: agentRequestIdRef.current,
          steps: data.steps,
          status: data.status,
          isPaused: agentPausedRef.current,
          latestReasoning: data.latestReasoning
        }
        if (progressIdx >= 0) {
          const next = [...prev]
          next[progressIdx] = progressMsg
          return next
        } else {
          // 找到最后一条用户消息，插入其后
          let insertAt = prev.length
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'user') { insertAt = i + 1; break }
          }
          const next = [...prev]
          next.splice(insertAt, 0, progressMsg)
          return next
        }
      })
      if (data.status === 'done') {
        setChatLoading(false)
        if (data.result?.reply) {
          setChatMessages(prev => {
            // 防止与 handleSendChat 成功处理重复添加
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant' && last?.content === data.result.reply) return prev
            return [...prev, { role: 'assistant', content: data.result.reply }]
          })
        }
      }
      if (data.status === 'error') {
        setChatLoading(false)
        if (data.error) {
          const errorMsg = typeof data.error === 'string' ? data.error
            : typeof data.error === 'object' ? (data.error.message || data.error.error || JSON.stringify(data.error))
            : String(data.error)
          setChatMessages(prev => [...prev, { role: 'assistant', content: errorMsg, isError: true }])
        }
      }
    }

    const onConfirmationRequest = (data) => {
      setPendingConfirmation(data)
    }

    try {
      window.electronAPI?.on?.('agent:progress', onProgress)
      window.electronAPI?.on?.('agent:confirmation-request', onConfirmationRequest)
    } catch (_) {}

    return () => {
      try {
        window.electronAPI?.removeListener?.('agent:progress', onProgress)
        window.electronAPI?.removeListener?.('agent:confirmation-request', onConfirmationRequest)
      } catch (_) {}
    }
  }, [])

  // 加载历史会话列表
  const loadSessions = () => {
    window.electronAPI.invoke('agent:listSessions')
      .then(r => {
        if (r?.sessions?.length > 0) {
          setSessions(r.sessions)
          if (sidebarCollapsed) setSidebarCollapsed(false)
        }
      })
      .catch(e => console.error('加载会话列表失败:', e))
  }

  useEffect(() => { loadSessions() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 加载指定会话的消息
  const loadSessionMessages = async (sessionId) => {
    try {
      const r = await window.electronAPI.invoke('agent:getSessionMessages', { sessionId })
      if (r?.messages) {
        setChatMessages(r.messages.map(m => ({
          role: m.role,
          content: m.content,
          agentSteps: m.metadata?.steps
        })))
        setCurrentSessionId(sessionId)
      }
    } catch (e) {
      console.error('加载会话消息失败:', e)
    }
  }

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

  // 发送消息到 Agent 模式
  const handleSend = async (userMessage) => {
    setChatLoading(true)
    setAgentSteps([])
    setAgentStatus('running')
    agentRequestIdRef.current = 'agent-' + Date.now()
    try {
      await window.electronAPI.invoke('agent:run', {
        requestId: agentRequestIdRef.current,
        sessionId: currentSessionId,
        message: userMessage,
        mode: agentRunMode
      })
    } catch (e) {
      setChatLoading(false)
      setAgentStatus('error')
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Agent执行出错: ' + (e.message || '未知错误'), isError: true }])
    }
  }

  return {
    // 状态
    agentEnabled,
    agentMode,
    agentRunMode,
    agentSteps,
    agentStatus,
    agentPaused,
    pendingConfirmation,
    sessions,
    currentSessionId,
    sidebarCollapsed,
    sidebarTab,
    preferences,
    corrections,
    // ref
    agentRequestIdRef,
    // setters
    setAgentEnabled,
    setAgentMode,
    setAgentRunMode,
    setAgentSteps,
    setAgentStatus,
    setAgentPaused,
    setPendingConfirmation,
    setSessions,
    setCurrentSessionId,
    setSidebarCollapsed,
    setSidebarTab,
    setPreferences,
    setCorrections,
    // 函数
    handleSend,
    loadSessions,
    loadSessionMessages,
    loadPreferences,
    loadCorrections,
  }
}

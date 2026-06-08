import { useState, useEffect, useRef, useCallback } from 'react'

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
  const [agentSteps, setAgentSteps] = useState([])        // 旧格式 steps（兼容）
  const [agentStatus, setAgentStatus] = useState(null)
  const [agentTimeline, setAgentTimeline] = useState([])   // 新格式：时间线数组
  const [agentReplyText, setAgentReplyText] = useState('') // 流式累积的最终回复文本
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
  const agentReplyTextRef = useRef('')

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

  // Agent进度监听（流式事件）
  useEffect(() => {
    const onProgress = (data) => {
      const eventType = data.type
      setAgentStatus(data.status || 'running')

      // 根据事件类型更新 timeline
      if (eventType === 'reasoning_start') {
        setAgentTimeline(prev => [...prev, {
          type: 'reasoning',
          content: '',
          roundIndex: data.roundIndex,
          status: 'running',
          collapsed: true
        }])
        return
      }

      if (eventType === 'reasoning_delta') {
        setAgentTimeline(prev => {
          const next = [...prev]
          // 找到最后一个 reasoning 块追加内容
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].type === 'reasoning' && next[i].status === 'running') {
              next[i] = { ...next[i], content: next[i].content + (data.content || '') }
              break
            }
          }
          return next
        })
        return
      }

      if (eventType === 'reasoning_done') {
        setAgentTimeline(prev => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].type === 'reasoning' && next[i].status === 'running') {
              next[i] = { ...next[i], status: 'done' }
              break
            }
          }
          return next
        })
        return
      }

      if (eventType === 'reasoning_error') {
        setAgentTimeline(prev => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].type === 'reasoning' && next[i].status === 'running') {
              next[i] = { ...next[i], status: 'error', error: data.error }
              break
            }
          }
          return next
        })
        return
      }

      if (eventType === 'tool_start') {
        setAgentTimeline(prev => [...prev, {
          type: 'tool',
          toolCallId: data.toolCallId,
          toolName: data.toolName,
          args: data.args || {},
          status: 'running',
          collapsed: true,
          roundIndex: data.roundIndex
        }])
        return
      }

      if (eventType === 'tool_done') {
        setAgentTimeline(prev => prev.map(item =>
          item.type === 'tool' && item.toolCallId === data.toolCallId
            ? { ...item, status: 'done', result: data.result }
            : item
        ))
        return
      }

      if (eventType === 'tool_error') {
        setAgentTimeline(prev => prev.map(item =>
          item.type === 'tool' && item.toolCallId === data.toolCallId
            ? { ...item, status: 'error', error: data.error }
            : item
        ))
        return
      }

      if (eventType === 'text_delta') {
        agentReplyTextRef.current = agentReplyTextRef.current + (data.content || '')
        setAgentReplyText(agentReplyTextRef.current)
        return
      }

      // ===== 旧格式兼容 =====
      setAgentSteps(data.steps || [])

      if (data.status === 'done' || eventType === 'done') {
        setChatLoading(false)
        const reply = data.result?.reply || agentReplyTextRef.current
        if (reply) {
          setChatMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant' && last?.content === reply) return prev
            return [...prev, { role: 'assistant', content: reply }]
          })
        }
        // 将所有还在 running 的项标记为 done
        setAgentTimeline(prev => prev.map(item =>
          item.status === 'running' ? { ...item, status: 'done' } : item
        ))
        return
      }

      if (data.status === 'error' || eventType === 'error') {
        setChatLoading(false)
        const errorMsg = data.error
          ? (typeof data.error === 'string' ? data.error
            : typeof data.error === 'object' ? (data.error.message || data.error.error || JSON.stringify(data.error))
            : String(data.error))
          : '未知错误'
        // 错误信息追加到聊天
        if (data.result?.reply) {
          setChatMessages(prev => [...prev, { role: 'assistant', content: data.result.reply, isError: true }])
        } else if (errorMsg && errorMsg !== 'aborted' && errorMsg !== 'wc_destroyed') {
          setChatMessages(prev => [...prev, { role: 'assistant', content: errorMsg, isError: true }])
        }
        setAgentTimeline(prev => prev.map(item =>
          item.status === 'running' ? { ...item, status: 'error' } : item
        ))
      }
    }

    const onConfirmationRequest = (data) => {
      setPendingConfirmation(data)
    }

    let progressId = null
    let confirmId = null
    try {
      progressId = window.electronAPI?.on?.('agent:progress', onProgress)
      confirmId = window.electronAPI?.on?.('agent:confirmation-request', onConfirmationRequest)
    } catch (_) {}

    return () => {
      try {
        if (progressId) window.electronAPI?.removeListener?.(progressId)
        if (confirmId) window.electronAPI?.removeListener?.(confirmId)
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
    setAgentTimeline([])
    setAgentReplyText('')
    agentReplyTextRef.current = ''
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
    agentTimeline,
    agentReplyText,
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
    setAgentTimeline,
    setAgentReplyText,
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

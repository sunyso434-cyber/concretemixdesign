import React, { useState, useEffect, useCallback, useRef, useDeferredValue } from 'react'
import { Button, Input, Space, Avatar, List, Alert, message, Modal, Typography, Upload, Tag, Layout, Tooltip, Dropdown, Image, Popover } from 'antd'
import { SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, BulbOutlined, PlusOutlined, HistoryOutlined, MessageOutlined, AppstoreOutlined, SettingOutlined, FolderOpenOutlined, HeartOutlined, DownOutlined, CheckOutlined, PauseCircleOutlined, PictureOutlined, ReloadOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolMessageBubble from './ToolMessageBubble'
import SystemErrorBubble from './SystemErrorBubble'
import StreamingAgentCard from './StreamingAgentCard'
import MessageActions from './MessageActions'
import ProducedFilesChips from './ProducedFilesChips'
import TrajectoryPanel from './TrajectoryPanel'
import TodoPanel from './TodoPanel'
import PlanApprovalModal from './PlanApprovalModal'
import FileMessageCard from './FileMessageCard'
import LintReportModal from './LintReportModal'
import DecisionGate from './DecisionGate'
import MemorySidebar from './MemorySidebar'
import SlashCommandMenu from './SlashCommandMenu'
import MdReaderPanel from './MdReaderPanel'
import { useMdReader } from './useMdReader'
import WelcomeScreen from './WelcomeScreen'
import useChatState from '../hooks/useChatState'
import { AgentStoreProvider, useAgentStore } from './AgentStore'
import useAgentMode from './AgentMode'
import { sendMessage, abortAgent, pauseAgent, resumeAgent, createSession, loadSessionList, switchSession, loadMoreSessionMessages, useAssistantPersistence, resumeFromCheckpoint, detectCrashWindow, rerunUnpairedTools, insertSteerMessage } from './agentActions'
import { getAttachmentType, processImageAttachment } from '../utils/attachmentHelper'

// 对话发图后同步保存到工作区 raw/images（老板 2026-08-02 决策：图片进原始素材区，AI 可索引）。
// best effort：保存失败仅告警，不影响对话流程。
// - 选文件/拖拽：file 有磁盘路径 → 保存原图（sourcePath 拷贝）
// - 剪贴板粘贴：file 无路径 → 保存压缩后的 dataUrl（base64 写入）
function saveChatImageToWorkspace(file, result) {
  try {
    if (file && file.path) {
      return window.electronAPI.vision.upload({ sourcePath: file.path, name: file.name })
    }
    if (result && result.base64) {
      return window.electronAPI.vision.upload({ dataUrl: result.base64, name: result.originalName })
    }
  } catch (err) {
    console.warn('[chat] 图片保存到工作区失败:', err && err.message)
  }
  return Promise.resolve()
}
import ContextIndicator from './ContextIndicator'
import ContextBreakdownPanel from './ContextBreakdownPanel'
import { estimateTokens, DEFAULT_CONTEXT_LIMIT } from '../utils/contextStats'
import { parseMixedMessage, isInCommandMode, tabComplete, buildAllCommandNames, normalizeCursorPos } from '../utils/slashCommandParser'

const { Text } = Typography
const { Content } = Layout
// [v8.3.9 fix] 用 new URL + import.meta.url 让 Vite 输出**相对路径**：
// 普通 `import xxx from '...png'` 在 Vite 下输出绝对路径 /assets/xxx.png，
// 在 Electron file:// 协议下会被解析为 file:///C:/assets/xxx.png（C盘根目录），
// 触发 AntD Avatar 反复 404 → 主进程内存暴涨 + 头像空白。
// 用 new URL(..., import.meta.url).href 强制 Vite 编译时插入相对路径 ./assets/xxx.png。
const ASSISTANT_AVATAR_SRC = new URL('../assets/assistant-avatar.png', import.meta.url).href

const QUICK_PROMPTS = [
  { label: '帮我设计C30配合比', message: '帮我设计C30配合比，坍落度180mm' },
  { label: '优化成本', message: '帮我优化配合比成本，找到最便宜的材料组合' },
  { label: '对比材料', message: '帮我对比不同水泥对配合比的影响' },
  { label: '/ 查看技能', message: '/', isSlash: true },
]

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

// md 阅读器：把文本中出现的 md 文件引用（如 reports/xxx.md、小砼-自我介绍.md）转成可点击链接
// 注意：react-markdown 的 text 节点不是独立元素、无法用 components 覆盖，故先转成特殊链接再拦截 a 组件
//
// v0.7.1 修复：反引号内的 .md 文件名也要能点击打开。
// 背景：AI 常用反引号包裹文件名/路径（如 `# 标题 xxx.md`），linkify 会把反引号内的 .md 也转成
// [xxx.md](#md-ref:...) 链接语法。react-markdown 把反引号内内容当 inlineCode 渲染，里面的链接
// 语法不再被解析。旧版 code 组件用 ^...$ 锚定，只处理"整个代码内容都是纯链接语法"的情况，
// 导致"前缀文字 + 链接"的混合情况露出原始 [xxx.md](#md-ref:...) 语法。
// 方案：linkify 保持处理反引号内内容（让 .md 转成链接语法），code 组件增强为支持
// "前缀 + 链接 + 后缀"的混合解析，把链接部分还原成可点击链接，其他文字保持代码样式。
const MD_REF_RE = /([\w一-龥][\w一-龥\-.()\/\\]*\.md)(?![A-Za-z0-9一-龥\-_./\\])/g
const MD_REF_PREFIX = '#md-ref:'
function linkifyMdRefs(content) {
  if (!content) return content
  MD_REF_RE.lastIndex = 0
  return String(content).replace(MD_REF_RE, (match) => `[${match}](${MD_REF_PREFIX}${encodeURIComponent(match)})`)
}

function makeMdComponents(onOpenMd) {
  return {
    a: ({ href, children }) => {
      if (href && href.startsWith(MD_REF_PREFIX)) {
        const mdPath = decodeURIComponent(href.slice(MD_REF_PREFIX.length))
        return (
          <a
            className="md-inline-link"
            title="点击在阅读器中打开"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenMd && onOpenMd(mdPath) }}
          >
            {children}
          </a>
        )
      }
      return <a href={href}>{children}</a>
    },
    // 反引号包裹的 md 路径：linkify 已转成链接语法，ReactMarkdown 会当行内代码渲染，
    // 这里识别（content 为 md-ref 链接语法）并还原为"代码样式的可点击链接"
    // 注意：react-markdown v10 的 code 组件不传 inline prop，故按内容格式判断
    //
    // v0.7.1 增强：支持"前缀文字 + 链接 + 后缀文字"的混合情况。
    // 旧版用 ^...$ 锚定只处理"纯链接语法"，导致 `# 标题 xxx.md` 这种混合内容露出原始语法。
    // 现在用全局正则扫描，把所有 [xxx.md](#md-ref:...) 片段还原成可点击链接，
    // 链接之间的普通文字保持代码样式。
    code: ({ className, children }) => {
      const text = String(children || '')
      // 全局匹配 [文本](#md-ref:编码路径)  注意：linkify 生成 #md-ref:（无空格）
      const LINK_RE = /\[([^\]]+\.md)\]\(#md-ref:([^)]+)\)/g
      if (!LINK_RE.test(text)) {
        return <code className={className}>{children}</code>
      }
      // 重新扫描并分段渲染
      LINK_RE.lastIndex = 0
      const parts = []
      let lastIdx = 0
      let m
      while ((m = LINK_RE.exec(text)) !== null) {
        // 链接前的普通文字
        if (m.index > lastIdx) {
          parts.push(text.slice(lastIdx, m.index))
        }
        const mdPath = decodeURIComponent(m[2])
        parts.push(
          <a
            key={`mdlink-${m.index}`}
            className="md-inline-link"
            title="点击在阅读器中打开"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenMd && onOpenMd(mdPath) }}
          >
            {m[1]}
          </a>
        )
        lastIdx = m.index + m[0].length
      }
      // 末尾普通文字
      if (lastIdx < text.length) {
        parts.push(text.slice(lastIdx))
      }
      return <code className={className}>{parts}</code>
    }
  }
}

function MessageContent({ item, agentStatus, agentReplyText, onOpenMd }) {
  // v10.10.12 修复：agent 流式输出时 ReactMarkdown 每条 IPC 都重新解析整个 markdown，
  // 大段输出（几万字）会卡死渲染进程 → 白屏。useDeferredValue 让 React 自动降速。
  const deferredReplyText = useDeferredValue(agentReplyText)
  const mdComponents = makeMdComponents(onOpenMd)
  if (item.role !== 'assistant') {
    return <ReactMarkdown components={mdComponents}>{linkifyMdRefs(item.content)}</ReactMarkdown>
  }
  if (agentStatus === 'thinking' && item._streaming) {
    return <div className="ai-thinking">AI 正在思考<span className="ai-thinking-text"></span></div>
  }
  if ((agentStatus === 'streaming' || agentStatus === 'tool_calling') && item._streaming) {
    return (
      <div className="chat-markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyMdRefs(deferredReplyText || item.content)}</ReactMarkdown>
        <span className="streaming-cursor">|</span>
      </div>
    )
  }
  if (item.stopReason === 'aborted') {
    return (
      <div className="chat-markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyMdRefs(item.content)}</ReactMarkdown>
        <span className="aborted-tag">[已停止]</span>
      </div>
    )
  }
  if (item.stopReason === 'error') {
    return (
      <div className="chat-markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyMdRefs(item.content)}</ReactMarkdown>
        <span className="aborted-tag">[生成中断]</span>
      </div>
    )
  }
  // v10.2.0 方案 9：检测内容是否含 <think>...</think> 块，是则折叠渲染
  const thinkMatch = typeof item.content === 'string' ? item.content.match(/<think>([\s\S]*?)(?:<\/think>|$)/) : null
  if (thinkMatch) {
    const thinkContent = thinkMatch[1].trim()
    const visibleContent = item.content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim()
    return (
      <div className="chat-markdown-body">
        {visibleContent && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyMdRefs(visibleContent)}</ReactMarkdown>
        )}
        <details style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
            💭 AI 思考过程（点击展开）
          </summary>
          <pre style={{
            marginTop: 6,
            padding: 8,
            background: 'var(--color-bg, #f5f5f7)',
            borderRadius: 4,
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
            fontFamily: 'inherit'
          }}>
            {thinkContent}
          </pre>
        </details>
      </div>
    )
  }

  return (
    <div className="chat-markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyMdRefs(item.content)}</ReactMarkdown>
    </div>
  )
}

const SmartDesignChat = () => {
  // ===== Hooks =====
  const chatState = useChatState()
  const { state, dispatch } = useAgentStore()
  // v0.9.x 轨迹功能：会话/轨迹并列视图切换（参考 DSH 布局，只能切换不可关闭）
  // + 跨视图跳转定位（工具调用 id）
  const [activeView, setActiveView] = useState('chat')
  const [trajectoryFocus, setTrajectoryFocus] = useState(null)
  const reader = useMdReader()
  const handleOpenMd = async (path) => {
    const p = String(path || '').trim()
    if (!p) return
    // 含分隔符的相对路径（如 reports/xxx.md）→ 直接拼工作区根
    // 绝对路径直接用
    const isAbsolutePath = /^([A-Za-z]:[\\/]|[\\/])/.test(p)
    const hasSeparator = /[\\/]/.test(p)
    if (isAbsolutePath) {
      reader.openFile(p)
      return
    }
    if (hasSeparator && workspacePath) {
      reader.openFile(`${workspacePath.replace(/[\\/]+$/, '')}/${p.replace(/^[\\/]+/, '')}`)
      return
    }
    // 纯文件名（无分隔符）：先拼工作区根尝试，找不到则调 md:resolve 后缀匹配查找
    // 场景：AI 反引号内只有文件名后缀（如 清水混凝土应用技术规程.md），
    // 但实际文件在子目录且名字更长（如 raw/md/# 标准 清水混凝土应用技术规程.md）
    if (workspacePath) {
      const directPath = `${workspacePath.replace(/[\\/]+$/, '')}/${p}`
      const res = await window.electronAPI.md.read(directPath)
      if (res && !res.error) {
        reader.openFile(directPath)
        return
      }
      // 回退：后缀匹配查找
      const resolved = await window.electronAPI.md.resolve(p)
      if (resolved && resolved.filePath) {
        reader.openFile(resolved.filePath)
        return
      }
      // 都找不到：报错
      alert(`文件不存在：${p}`)
      return
    }
    reader.openFile(p)
  }
  const { agentRequestIdRef } = useAgentMode() // 纯事件监听器
  useAssistantPersistence() // 副作用 hook（done/aborted 时自动持久化）

  const inputRef = useRef(null)
  // 获取 antd Input.TextArea 内的原生 textarea 节点
  // antd v5 的 TextArea ref 是包装对象，setSelectionRange/selectionStart 等原生 API 在 resizableTextArea.textArea 上
  const getNativeTextArea = useCallback(() => {
    if (inputRef.current && inputRef.current.resizableTextArea && inputRef.current.resizableTextArea.textArea) {
      return inputRef.current.resizableTextArea.textArea
    }
    return null
  }, [])
  const inputAreaRef = useRef(null)  // Ctrl+V 粘贴作用域控制
  const slashMenuApiRef = useRef({ moveSelection: () => {}, getSelectedIndex: () => 0 })
  const chatListRef = useRef(null)  // 消息滚动容器，用于检测滚动到顶自动加载历史

  // 跟踪当前 todo 状态，用于 agent 完成时拍快照存入消息
  const latestTodoRef = useRef({ todos: [], summary: { total: 0, completed: 0 } })

  // 阶段 3 任务 3.3：AI 计划审批弹窗状态（pendingApproval=true 时挂起）
  const [planApproval, setPlanApproval] = useState({ visible: false, steps: [] })

  // v0.9.4 轨迹 tab：AI 提问（ask_user）/计划审批弹出时若正在轨迹视图，自动切回会话视图让用户看到并作答
  useEffect(() => {
    if ((state.confirmation || planApproval.visible) && activeView === 'trajectory') {
      setActiveView('chat')
    }
  }, [state.confirmation, planApproval.visible, activeView])

  // v0.9.4 轨迹 tab：无消息（清空对话/切到空会话）时轨迹不可用，自动切回会话视图
  useEffect(() => {
    if (activeView === 'trajectory' && state.messages.length === 0) {
      setActiveView('chat')
    }
  }, [activeView, state.messages.length])

  // 派生：Agent 是否在工作中（流式/思考/工具调用）
  const isAgentBusy = ['streaming', 'thinking', 'tool_calling'].includes(state.agent.status)

  // 订阅 todo 更新，保持 ref 最新（用于 agent 完成时拍快照）
  // 阶段 3 任务 3.3：同时检测 pendingApproval → 挂起/关闭计划审批弹窗
  // 按当前会话过滤事件：多会话并行时，别的会话的 todo 事件不干扰本会话弹窗
  useEffect(() => {
    const sid = state.session.currentId
    if (!window.electronAPI?.todo) return
    const listenerId = window.electronAPI.todo.onUpdate((payload) => {
      if (!payload) return
      if (sid && payload.sessionId && payload.sessionId !== sid) return
      latestTodoRef.current = {
        todos: payload.todos || [],
        summary: { total: payload.total || 0, completed: payload.completed || 0 }
      }
      if (payload.pendingApproval) {
        // create_plan 完成 → 弹出计划审批窗，让用户确认/修改/取消
        setPlanApproval({ visible: true, steps: payload.todos || [] })
      } else {
        // 计划已确认 / 修改回传 / 取消清空 → 收起弹窗（防残留）
        setPlanApproval(prev => (prev.visible ? { ...prev, visible: false } : prev))
      }
    })
    return () => {
      try { window.electronAPI.todo.removeUpdateListener(listenerId) } catch (_) {}
    }
  }, [state.session.currentId])

  // 渲染进程刷新/切换会话后兜底恢复：拉一次 todo:list 检测是否有待审批计划
  useEffect(() => {
    const sid = state.session.currentId
    if (!sid || !window.electronAPI?.todo) return
    let cancelled = false
    window.electronAPI.todo.list(sid).then(res => {
      if (cancelled) return
      if (res?.pendingApproval && Array.isArray(res.todos) && res.todos.length > 0) {
        setPlanApproval({ visible: true, steps: res.todos })
      }
    }).catch(() => { /* 拉取失败静默忽略，订阅通道仍可用 */ })
    return () => { cancelled = true }
  }, [state.session.currentId])

  // 仅在消息条数变化时刷新会话列表（避免流式输出时频繁刷新）
  const prevMsgCountRef = useRef(0)
  useEffect(() => {
    const count = state.messages?.length || 0
    if (count !== prevMsgCountRef.current && count > 0) {
      prevMsgCountRef.current = count
      loadSessionList({ dispatch })
    }
  }, [state.messages?.length, dispatch])

  // ===== 自动滚动到底部 =====
  // 触发时机：消息新增、流式文本更新、确认框关闭
  const prevMsgLenRef = useRef(state.messages?.length || 0)
  const prevReplyLenRef = useRef(0)
  useEffect(() => {
    const msgLen = state.messages?.length || 0
    const replyLen = state.agent?.replyText?.length || 0
    const isNewMsg = msgLen > prevMsgLenRef.current
    const replyGrew = replyLen > prevReplyLenRef.current + 50 // 每增加 50 字符滚动一次
    const confirmClosed = prevConfirmationRef.current && !state.confirmation // 确认框刚关闭

    if (isNewMsg || replyGrew || confirmClosed) {
      // 只在用户没有主动上滚时自动滚动（用户上滚超过 150px 则跳过）
      const chatList = document.querySelector('.smart-chat-list')
      if (chatList) {
        const distToBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight
        if (distToBottom < 150 || isNewMsg) {
          chatState.chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
      }
    }
    prevMsgLenRef.current = msgLen
    prevReplyLenRef.current = replyLen
  }, [state.messages?.length, state.agent?.replyText?.length, state.confirmation])

  const prevConfirmationRef = useRef(state.confirmation)
  useEffect(() => {
    prevConfirmationRef.current = state.confirmation
  }, [state.confirmation])

  // ===== 历史消息分页状态 =====
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)

  // ===== 斜杠命令状态 =====
  const [slashMenuVisible, setSlashMenuVisible] = useState(false)
  const [availableSkills, setAvailableSkills] = useState([])
  const [cursorPos, setCursorPos] = useState(0)

  // 由光标位置和输入内容决定是否显示斜杠菜单
  const showSlashMenu = isInCommandMode(state.input, cursorPos)

  // ===== Wiki 健康检查 Modal（Task 6.3）=====
  const [lintModalOpen, setLintModalOpen] = useState(false)

  // ===== 工作区抽屉 =====
  const [workspacePath, setWorkspacePath] = useState(null)
  const [workspacesList, setWorkspacesList] = useState([])

  // v9.0.0 补充21：欢迎页显隐状态（从 store 读，让 MemorySidebar 也能控制）
  const welcomeVisible = state.session.welcomeVisible !== false  // 默认 true
  const setWelcomeVisible = (v) => dispatch({ type: 'SET_WELCOME_VISIBLE', payload: !!v })
  // 最近会话列表（欢迎页左侧显示）
  const [recentSessions, setRecentSessions] = useState([])

  // 加载最近会话列表（欢迎页 + 侧栏兜底）
  const loadRecentSessions = useCallback(async () => {
    try {
      const r = await window.electronAPI.invoke('agent:listRecentSessions', { limit: 10 })
      if (r && r.success && Array.isArray(r.sessions)) {
        // 过滤掉空消息会话（兜底：万一历史数据里有未清理的）
        setRecentSessions(r.sessions.filter(s => s.messageCount > 0))
      }
    } catch (err) {
      console.warn('[SmartDesignChat] 加载最近会话列表失败:', err)
    }
  }, [])

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

  // R8：远程（手机）切换工作区后，刷新当前工作区显示（双向 workspace:changed，只加监听不改交互）
  useEffect(() => {
    if (!window.electronAPI?.on) return
    const listenerId = window.electronAPI.on('workspace:changed', () => {
      window.electronAPI.workspace.current()
        .then((current) => {
          if (current && current.path) {
            setWorkspacePath(current.path)
          }
        })
        .catch(() => {})
    })
    return () => {
      if (window.electronAPI?.removeListener && listenerId) {
        window.electronAPI.removeListener(listenerId)
      }
    }
  }, [])

  // 加载所有已知工作区列表（用于下拉切换）
  const loadWorkspacesList = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('agent:listSessionsGrouped')
      if (result && result.workspaces) {
        setWorkspacesList(result.workspaces)
      }
    } catch (err) {
      console.warn('[SmartDesignChat] 加载工作区列表失败:', err)
    }
  }, [])

  useEffect(() => {
    loadWorkspacesList()
  }, [loadWorkspacesList, state.session.list])

  const handleAddWorkspace = async () => {
    try {
      const result = await window.electronAPI.workspace.pickFolder()
      if (result.canceled) return
      setWorkspacePath(result.path)
      // Task 2.15b：切工作区后自动新建会话（旧会话的 pending 在切之前由 WorkspaceManager.close 触发导出）
      createSession({ dispatch })
      // 刷新侧栏分组列表
      await loadSessionList({ dispatch })
      await loadWorkspacesList()
    } catch (err) {
      console.error('[WorkspaceIndicator] 选择工作区失败:', err)
      message.error('添加工作区失败: ' + err.message)
    }
  }

  const handleSwitchWorkspace = async (wsPath) => {
    reader.handleWorkspaceChanged(wsPath)
    if (wsPath === workspacePath) return
    try {
      await window.electronAPI.workspace.open(wsPath)
      setWorkspacePath(wsPath)
      // 切工作区后自动新建会话
      createSession({ dispatch })
      // 刷新侧栏分组列表
      await loadSessionList({ dispatch })
      await loadWorkspacesList()
    } catch (err) {
      console.error('[SmartDesignChat] 切换工作区失败:', err)
      message.error('切换工作区失败: ' + err.message)
    }
  }

  // 提取文件夹名（basename）
  const workspaceBasename = workspacePath
    ? workspacePath.split(/[\\/]/).filter(Boolean).pop()
    : null

  // 当前会话标题
  const currentSession = state.session.list.find(s => s.sessionId === state.session.currentId)
  // fallback：从 sessionId（格式 session-{timestamp}-{random}）提取时间戳生成可读名称
  const formatSessionFallback = (sid) => {
    if (!sid) return '新对话'
    const match = sid.match(/^session-(\d+)-/)
    if (match) {
      const ts = parseInt(match[1], 10)
      if (!isNaN(ts)) {
        const d = new Date(ts)
        const pad = (n) => String(n).padStart(2, '0')
        return `对话 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      }
    }
    return '未命名对话'
  }
  const currentSessionTitle = currentSession?.sessionName || formatSessionFallback(state.session.currentId)

  // 监听后端"会话标题已更新"事件：异步 AI 摘要晚于 loadSessionList 完成时，主动刷新列表
  useEffect(() => {
    if (!window.electronAPI?.on) return
    const listenerId = window.electronAPI.on('agent:sessionUpdated', ({ sessionId: updatedSid } = {}) => {
      // 仅刷新列表（标题来自最新 DB 状态），不强制切换会话
      if (updatedSid) {
        loadSessionList({ dispatch }).catch(() => {})
      }
    })
    return () => {
      if (window.electronAPI?.removeListener && listenerId) {
        window.electronAPI.removeListener(listenerId)
      }
    }
  }, [dispatch])

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
    // v9.0.0 补充21：启动时总是显示欢迎页，不再自动 switchSession 恢复最近会话
    // 但仍加载会话列表（侧栏分组显示 + 欢迎页左侧卡片）
    const initSessions = async () => {
      try {
        await loadSessionList({ dispatch })
        await loadRecentSessions()
        // 同步更新工作区状态（main.js 启动时可能已自动 open 了上次工作区）
        try {
          const current = await window.electronAPI.workspace.current()
          if (current && current.path) {
            setWorkspacePath(current.path)
          }
        } catch (err) {
          console.warn('[SmartDesignChat] 更新工作区状态失败:', err)
        }
      } catch (error) {
        console.warn('[SmartDesignChat] 初始化加载会话失败:', error)
      }
    }
    initSessions()
  }, [loadSkills, dispatch, loadRecentSessions])

  // 监听 agent:sessionUpdated 事件，刷新欢迎页会话列表
  useEffect(() => {
    if (!window.electronAPI?.on) return
    const handlerId = window.electronAPI.on('agent:sessionUpdated', () => {
      loadRecentSessions()
    })
    return () => {
      try { window.electronAPI.removeListener?.(handlerId) } catch (_) {}
    }
  }, [loadRecentSessions])

  // ===== Ctrl+V 粘贴图片处理 =====
  useEffect(() => {
    const handlePaste = async (e) => {
      // 作用域控制：仅在焦点在聊天输入区域时才处理图片粘贴
      if (!inputAreaRef.current) return
      const activeEl = document.activeElement
      if (!inputAreaRef.current.contains(activeEl)) return

      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()  // 阻止默认粘贴行为（避免粘贴到输入框）
          const file = item.getAsFile()
          if (!file) continue
          // 剪贴板图片可能没有文件名，给一个默认名
          if (!file.name || file.name === 'image.png') {
            Object.defineProperty(file, 'name', {
              value: `粘贴图片-${Date.now()}.png`,
              writable: false
            })
          }
          try {
            const result = await processImageAttachment(file)
            chatState.setAttachments(prev => [...prev, { type: 'image', key: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...result }])
            // 同步保存到工作区 raw/images（剪贴板图无磁盘路径，走 dataUrl）
            saveChatImageToWorkspace(file, result).then(r => {
              if (r && r.success) console.log('[chat] 粘贴图片已保存到 raw/images:', r.path)
              else console.warn('[chat] 粘贴图片保存失败:', r && r.error)
            }).catch(e => console.warn('[chat] 粘贴图片保存异常:', e && e.message))
            message.success(`已粘贴图片：${result.originalName}`)
          } catch (err) {
            message.error(err.message)
          }
        }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 当菜单打开时重新加载（确保最新）
  useEffect(() => {
    if (showSlashMenu && availableSkills.length === 0) {
      loadSkills()
    }
  }, [showSlashMenu, availableSkills.length, loadSkills])

  // 监听会话切换，更新工作区状态
  useEffect(() => {
    // 切换会话后重置历史分页状态
    setHasMoreHistory(true)
    setHistoryLoading(false)
    const updateWorkspaceState = async () => {
      try {
        const current = await window.electronAPI.workspace.current()
        if (current && current.path) {
          setWorkspacePath(current.path)
        } else {
          setWorkspacePath(null)
        }
      } catch (err) {
        console.warn('[SmartDesignChat] 更新工作区状态失败:', err)
      }
    }
    updateWorkspaceState()
  }, [state.session.currentId])

  // 监听输入变化，同步光标位置
  // 注意：必须用 e.target.selectionStart 而非 inputRef.current.selectionStart。
  // antd Input.TextArea 的 ref 指向组件实例（非原生 DOM），取 .selectionStart 会得到 undefined，
  // 导致 cursorPos 状态被污染，进而让 Tab 补全的 input.slice(cursorPos) 返回整个字符串（补全结果叠加原文）。
  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value
    dispatch({ type: 'SET_INPUT', payload: newValue })
    setTimeout(() => {
      if (inputRef.current && inputRef.current.resizableTextArea && inputRef.current.resizableTextArea.textArea) {
        setCursorPos(inputRef.current.resizableTextArea.textArea.selectionStart)
      } else if (e.target && typeof e.target.selectionStart === 'number') {
        setCursorPos(e.target.selectionStart)
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

  // 清空对话（先中止运行中的 Agent，再重置状态）
  // 前置声明原因：handleClearCommand / handleSend 的 useCallback 依赖数组引用了它，
  // 若在它之前声明则触发 TDZ（暂时性死区），生产构建 minify 后会报
  // "Cannot access 'X' before initialization" 并导致白屏。
  const handleClearChat = async () => {
    if (state.agent.requestId) {
      abortAgent({ dispatch, requestId: state.agent.requestId, sessionId: state.session.currentId })
    }
    await chatState.handleClearChat()
    dispatch({ type: 'CLEAR_MESSAGES' })
    dispatch({ type: 'RESET_AGENT' })
  }

  // 归档会话只读：当前会话若已归档则禁用输入，恢复后方可继续对话
  const isArchived = state.session.currentArchived

  // P0 断点续跑（Task 1.6）：续跑按钮处理（含崩溃窗口检测 + 弹窗）
  const handleResumeFromCheckpoint = useCallback(async () => {
    const sid = state.session.currentId
    if (!sid) return
    // 1. 检测崩溃窗口
    const { needAsk, unpairedToolCalls } = await detectCrashWindow(sid)
    // 2. 根据 needAsk 决定流程
    if (needAsk && unpairedToolCalls.length > 0) {
      const toolNames = unpairedToolCalls
        .map(tc => tc?.function?.name || '未知工具')
        .map((n, i) => `${i + 1}. ${n}`)
        .join('\n')
      Modal.confirm({
        title: '检测到上次任务异常中断',
        content: (
          <div>
            <p>以下工具在上次执行中未完成，可能产生了不完整的数据：</p>
            <pre style={{ background: '#f5f5f5', padding: 8, margin: '8px 0', whiteSpace: 'pre-wrap' }}>{toolNames}</pre>
            <p style={{ color: '#faad14' }}>
              ⚠️ 注意：重跑非幂等工具（如保存文件、写入数据）可能产生重复记录。
            </p>
            <p>选择"重跑"将重新执行上述工具；选择"跳过"则直接从断点继续。</p>
          </div>
        ),
        okText: '重跑工具并续跑',
        cancelText: '跳过重跑直接续跑',
        onOk: async () => {
          await rerunUnpairedTools(sid, unpairedToolCalls)
          await resumeFromCheckpoint({ dispatch, sessionId: sid })
        },
        onCancel: async () => {
          await resumeFromCheckpoint({ dispatch, sessionId: sid })
        }
      })
    } else {
      // 无崩溃窗口，直接续跑
      await resumeFromCheckpoint({ dispatch, sessionId: sid })
    }
  }, [state.session.currentId, dispatch])

  const handleRestoreArchived = async () => {
    const sid = state.session.currentId
    if (!sid) return
    try {
      await window.electronAPI.invoke('agent:archiveSession', { sessionIds: [sid], archived: false })
      dispatch({ type: 'SET_SESSION_ARCHIVED', payload: false })
      message.success('已恢复，可继续对话')
    } catch (err) {
      message.error('恢复失败: ' + (err?.message || err))
    }
  }

  // 键盘事件 handler (spec 7.1)
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && isAgentBusy) {
      e.preventDefault()
      abortAgent({ dispatch, requestId: state.agent.requestId, sessionId: state.session.currentId })
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      if (isAgentBusy && !state.input.trim()) {
        e.preventDefault()
        abortAgent({ dispatch, requestId: state.agent.requestId, sessionId: state.session.currentId })
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
        message: messagesToSend.join(' ')
      })
    }
    dispatch({ type: 'SET_INPUT', payload: '' })
  }, [dispatch, state.session.currentId, appendSystemMessage])

  // 统一发送处理（支持混合命令+文本）
  // 发送聊天消息（统一使用 Agent 模式）
  // 注意：user 消息的 dispatch 由 sendMessage 内部统一处理，避免重复添加
  const handleSendChat = async () => {
    if (!state.input.trim() || isAgentBusy) return

    const userMessage = state.input.trim()
    dispatch({ type: 'SET_INPUT', payload: '' })
    const currentAttachments = chatState.attachments
    chatState.setAttachments([])
    // v9.0.0 补充21：发送首条消息后隐藏欢迎页
    setWelcomeVisible(false)

    await sendMessage({
      dispatch,
      sessionId: state.session.currentId,
      message: userMessage,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined
    })
  }
  // 加载更早的历史消息（滚动到顶自动触发，同时保持滚动位置不跳）
  const handleLoadMoreHistory = useCallback(async () => {
    if (historyLoading || !hasMoreHistory || !state.session.currentId) return
    setHistoryLoading(true)
    // 记录加载前的 scrollHeight，用于加载后保持滚动位置
    const listEl = chatListRef.current
    const prevScrollHeight = listEl ? listEl.scrollHeight : 0
    try {
      const { loaded, hasMore } = await loadMoreSessionMessages({
        dispatch,
        sessionId: state.session.currentId,
        messages: state.messages
      })
      setHasMoreHistory(hasMore)
      if (loaded === 0) {
        setHasMoreHistory(false)
      }
      // 加载后用 RAF 调整 scrollTop，保持原视觉位置不跳
      if (listEl && loaded > 0) {
        requestAnimationFrame(() => {
          if (chatListRef.current) {
            chatListRef.current.scrollTop = chatListRef.current.scrollHeight - prevScrollHeight
          }
        })
      }
    } finally {
      setHistoryLoading(false)
    }
  }, [historyLoading, hasMoreHistory, state.session.currentId, state.messages, dispatch])

  // 滚动到顶部时自动加载更多历史消息
  useEffect(() => {
    const listEl = chatListRef.current
    if (!listEl) return
    const handleScroll = () => {
      // 滚动到顶部（留 30px 缓冲）且还有更多消息、不在加载中时自动触发
      if (listEl.scrollTop <= 30 && hasMoreHistory && !historyLoading && state.session.currentId) {
        handleLoadMoreHistory()
      }
    }
    listEl.addEventListener('scroll', handleScroll, { passive: true })
    return () => listEl.removeEventListener('scroll', handleScroll)
  }, [hasMoreHistory, historyLoading, state.session.currentId, handleLoadMoreHistory])

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
    const hasClearInParts = Array.isArray(commandParts) && commandParts.some(p => p.command === 'clear')

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
  }, [state.input, state.session.currentId, handleClearCommand, handleClearChat, handleSendChat, executeRemainingCommands, dispatch])

  // 批 B Task 1.10/1.11：steer 插话 + followUp 追加任务（agent 忙时入队，显示到消息流带标签）
  // steer：AI 正在干活时插入新指令，下一轮 LLM 看到（入 steeringQueue）
  // followUp：当前任务完成后自动接着干新任务（入 followUpQueue）
  // 修复 v0.6.1：agent 已结束时降级为普通发送，避免"显示了但 agent 没响应"
  const _doSteer = useCallback(async () => {
    const msg = state.input.trim()
    if (!msg || !state.session.currentId) return
    dispatch({ type: 'SET_INPUT', payload: '' })
    try {
      const r = await window.electronAPI.invoke('agent:steer', { sessionId: state.session.currentId, msg })
      if (r && r.success) {
        // v0.6.2：封存当前 AI 气泡 + 新开气泡，AI 对插话的回答显示在插话下方
        insertSteerMessage({ dispatch, msg, requestId: state.agent.requestId, flag: '_steer' })
        message.success('已插入指令，AI 下一轮将看到')
      } else {
        // agent 已结束 → 降级为普通发送（sendMessage 会自己加用户消息 + 启动新 run）
        message.info('AI 已结束，改为普通发送')
        await sendMessage({
          dispatch,
          sessionId: state.session.currentId,
          message: msg
        })
      }
    } catch (e) {
      console.error('[steer] 失败:', e)
      message.error('插话失败')
    }
  }, [state.input, state.session.currentId, dispatch])

  const _doFollowUp = useCallback(async () => {
    const msg = state.input.trim()
    if (!msg || !state.session.currentId) return
    dispatch({ type: 'SET_INPUT', payload: '' })
    try {
      const r = await window.electronAPI.invoke('agent:follow_up', { sessionId: state.session.currentId, msg })
      if (r && r.success) {
        // 入队成功：显示带"追加任务"标签的消息（agent 完成当前任务后 drain 看到）
        dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: msg, _followUp: true } })
        message.success('已追加任务，当前任务完成后自动执行')
      } else {
        // agent 已结束 → 降级为普通发送
        message.info('AI 已结束，改为普通发送')
        await sendMessage({
          dispatch,
          sessionId: state.session.currentId,
          message: msg
        })
      }
    } catch (e) {
      console.error('[followUp] 失败:', e)
      message.error('追加任务失败')
    }
  }, [state.input, state.session.currentId, dispatch])

  // Task 13（Alt+Enter 立即插话）：走 agent:steer_immediate（steer 入队 + 中断当前 LLM 循环 + 取消 ask_user）
  // - 成功：立即响应插话（前端带 _steerImmediate 标签显示用户消息）
  // - 失败/结束：降级为普通发送（sendMessage 会自己加用户消息 + 启动新 run）
  const _doSteerImmediate = useCallback(async () => {
    const msg = state.input.trim()
    if (!msg || !state.session.currentId) return
    dispatch({ type: 'SET_INPUT', payload: '' })
    try {
      const r = await window.electronAPI.invoke('agent:steer_immediate', { sessionId: state.session.currentId, msg })
      if (r && r.success) {
        // v0.6.2：封存当前 AI 气泡 + 新开气泡，AI 对插话的回答显示在插话下方
        insertSteerMessage({ dispatch, msg, requestId: state.agent.requestId, flag: '_steerImmediate' })
        message.success('已中断当前操作，AI 将立即响应插话')
      } else {
        message.info('AI 已结束或状态异常，改为普通发送')
        await sendMessage({ dispatch, sessionId: state.session.currentId, message: msg })
      }
    } catch (e) {
      console.error('[steer_immediate] 失败:', e)
      message.error('立即插话失败')
    }
  }, [state.input, state.session.currentId, dispatch])

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
          const ta = getNativeTextArea()
          if (ta) ta.setSelectionRange(result.newCursor, result.newCursor)
        }, 0)
      }
      return
    }
    if (e.key === 'Escape' && isAgentBusy) {
      e.preventDefault()
      abortAgent({ dispatch, requestId: state.agent.requestId, sessionId: state.session.currentId })
      return
    }
    // 批 B Task 1.10：Enter 按键重定义
    // - Enter（无 Shift/Alt）：闲→发送；忙+空→abort；忙+非空→steer 插话
    // - Alt+Enter：忙+非空→立即插话（steerImmediate）；闲或忙+空→换行（行为变化，release notes 标注）
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      // B1：中文输入法组词中按 Enter 是"确认候选词"，不应发送消息
      // 同时兼容 keyCode === 229（部分老浏览器/输入法的 isCompositionState 标志）
      if (e.nativeEvent && e.nativeEvent.isComposing) return
      if (e.keyCode === 229) return

      e.preventDefault()

      // B2：斜杠菜单打开时，Enter 选中当前候选项补全（不发送）
      // 仅当菜单确实可见且有候选时才拦截；selectCurrent 返回 false 表示无候选，放行到发送
      if (showSlashMenu && slashMenuApiRef.current && slashMenuApiRef.current.selectCurrent) {
        const selected = slashMenuApiRef.current.selectCurrent()
        if (selected) return
      }

      // B3：菜单关闭/无候选时
      if (isAgentBusy && !state.input.trim()) {
        abortAgent({ dispatch, requestId: state.agent.requestId, sessionId: state.session.currentId })
      } else if (isAgentBusy && state.input.trim()) {
        // 批 B：agent 忙 + 有内容 → steer 插话（不再走 handleSend）
        _doSteer()
      } else {
        handleSend()
      }
      return
    }
    // 批 B Task 1.10 ③：Alt+Enter 分支
    if (e.key === 'Enter' && e.altKey) {
      // 中文输入法组词中不处理
      if (e.nativeEvent && e.nativeEvent.isComposing) return
      if (e.keyCode === 229) return
      if (isAgentBusy && state.input.trim()) {
        e.preventDefault()
        _doSteerImmediate()
      }
      // 闲或忙+空：Alt+Enter 不 preventDefault，让默认换行（行为变化：原闲时 Alt+Enter=发送，现=换行）
      return
    }
  }, [showSlashMenu, state.input, state.agent.requestId, cursorPos, availableSkills, isAgentBusy, dispatch, handleSend, _doSteer, _doSteerImmediate])

  const handleQuickPrompt = (msg) => {
    if (msg === '/') {
      // 显示斜杠命令菜单
      dispatch({ type: 'SET_INPUT', payload: '/' })
      setSlashMenuVisible(true)
    } else {
      dispatch({ type: 'SET_INPUT', payload: msg })
    }
  }

  // v9.0.0 补充21：欢迎页回调
  // 新建会话：仅内存生成 ID，**不**调 IPC；保持欢迎页（输入框已聚焦）
  const handleWelcomeNewSession = () => {
    createSession({ dispatch })
    setWelcomeVisible(true)
  }
  // 打开已有会话：switchSession 后隐藏欢迎页
  const handleWelcomeOpenSession = async (sessionId) => {
    await switchSession({ dispatch, sessionId, state })
    setWelcomeVisible(false)
  }
  // 欢迎页"选择工作区"按钮：复用现有 handleAddWorkspace（pickFolder + open）
  const handleWelcomePickWorkspace = async () => {
    await handleAddWorkspace()
    setWelcomeVisible(true)  // 切工作区后仍在欢迎页，让用户看到变化
  }
  // 欢迎页"关闭工作区"按钮
  const handleWelcomeClearWorkspace = async () => {
    try {
      await window.electronAPI.workspace.close()
      setWorkspacePath(null)
      setWelcomeVisible(true)
    } catch (err) {
      console.error('[SmartDesignChat] 关闭工作区失败:', err)
      message.error('关闭工作区失败: ' + err.message)
    }
  }

  return (
    <Layout style={{ height: '100%', flex: 1, minWidth: 0, background: 'transparent' }}>
      {/* 记忆侧栏 — 折叠时不渲染；state 由 MemorySidebar 内部从 AgentStore 读 */}
      {!state.session.sidebarCollapsed && (
        <MemorySidebar
          onToggle={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: true })}
          onOpenMd={handleOpenMd}
        />
      )}

      <Content style={{ display: 'flex', flexDirection: 'row', height: '100%', minWidth: 0 }}>
        <div className="smart-design-chat">
          <div className="smart-chat-toolbar v9-chat-header">
            <div className="v9-chat-header-left">
              {/* 工作区选择器 */}
              <Dropdown
                menu={{
                  items: [
                    ...workspacesList.map((ws) => ({
                      key: ws.path,
                      label: (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '2px 0',
                            opacity: ws.path === workspacePath ? 1 : 0.9
                          }}
                        >
                          {ws.path === workspacePath && (
                            <CheckOutlined style={{ fontSize: 12, color: 'var(--primary-color)' }} />
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                            <span style={{ fontWeight: ws.path === workspacePath ? 600 : 400 }}>
                              {ws.basename}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{ws.path}</span>
                          </div>
                        </div>
                      ),
                      onClick: () => handleSwitchWorkspace(ws.path)
                    })),
                    { type: 'divider' },
                    {
                      key: 'add',
                      label: (
                        <span style={{ color: 'var(--primary-color)' }}>
                          <PlusOutlined style={{ marginRight: 6 }} />
                          添加工作区
                        </span>
                      ),
                      onClick: handleAddWorkspace
                    }
                  ]
                }}
                trigger={['click']}
                placement="bottomLeft"
              >
                <button
                  className="v9-ws-selector"
                  title={workspacePath || '点击选择工作区'}
                >
                  <FolderOpenOutlined className="v9-ws-selector-icon" />
                  <span className="v9-ws-selector-name">{workspaceBasename || '打开工作区'}</span>
                  <DownOutlined style={{ fontSize: 10, marginLeft: 6, opacity: 0.7 }} />
                </button>
              </Dropdown>
              {/* 会话标题 */}
              <span className="v9-chat-title">{currentSessionTitle}</span>
            </div>
            {/* v0.9.4 会话/轨迹并列视图 tab（参考 DSH 布局：只能切换，不可关闭） */}
            <div className="v9-chat-header-tabs">
              <button
                className={`v9-header-tab${activeView === 'chat' ? ' active' : ''}`}
                onClick={() => setActiveView('chat')}
              >
                <MessageOutlined style={{ fontSize: 12 }} />
                会话
              </button>
              <button
                className={`v9-header-tab${activeView === 'trajectory' ? ' active' : ''}`}
                onClick={() => { setActiveView('trajectory'); setTrajectoryFocus(null) }}
                disabled={state.messages.length === 0}
                title={state.messages.length === 0 ? '暂无轨迹数据' : '查看本次会话 AI 操作全过程'}
              >
                <HistoryOutlined style={{ fontSize: 12 }} />
                轨迹
              </button>
            </div>
            <div className="v9-chat-header-right">
              <Tooltip title="🩺 Wiki 健康检查">
                <Button
                  type="text"
                  size="small"
                  icon={<HeartOutlined />}
                  onClick={() => setLintModalOpen(true)}
                />
              </Tooltip>
              {/* v11.7.7: 显示当前路由到的 LLM 模型，用户可感知路由状态 */}
              {state.agent.currentModel && (
                <Tooltip title={`当前模型：${state.agent.currentProvider} · ${state.agent.currentModel}`}>
                  <Tag color="blue" style={{ marginRight: 0, cursor: 'default' }}>
                    {state.agent.currentModel}
                  </Tag>
                </Tooltip>
              )}
              {(() => {
                // v0.9.x 圆环修复（随对话实时上涨）：
                // 1. 有真实值时——真实基数（model_info 的 usage.prompt_tokens，含全部历史+工具结果）
                //    + 真实值落点之后新增消息的估算（assistant 回复/用户新消息，见 contextRealTokensAt 快照），
                //    任务间隙发消息圆环立即上涨；下一轮任务后由真实值重新校准；
                // 2. 无真实值时（新会话未跑任务/网关不回传）——全量估算兜底（system+tools 用最近一次
                //    context_stats 的构成，消息用前端字符估算）；
                // 3. 清空/压缩会重置 contextRealTokens 与快照（见 agentStoreCore）。
                // 原 max(估算, 真实) 的缺陷：真实值含工具结果很大，纯文本估算永远追不上，
                // 圆环被冻结在旧真实值，任务间隙新增消息完全不反映。
                const sysToolsTokens = (state.contextBreakdown?.system || 0) + (state.contextBreakdown?.tools || 0)
                const real = typeof state.contextRealTokens === 'number' ? state.contextRealTokens : 0
                let total
                if (real > 0) {
                  const after = state.messages.slice(state.contextRealTokensAt || 0)
                  total = real + estimateTokens(after)
                } else {
                  total = sysToolsTokens + estimateTokens(state.messages)
                }
                const limit = state.contextLimit || DEFAULT_CONTEXT_LIMIT
                const percent = Math.min(1, Math.max(0, total / limit))
                // 细分面板数据：优先主进程 context_stats；无数据时用前端消息估算兜底（system/tools 不可知）
                const fallbackBreakdown = state.contextBreakdown || (
                  state.messages && state.messages.length > 0
                    ? { system: 0, tools: 0, messages: estimateTokens(state.messages) }
                    : null
                )
                return (
                  <>
                    <Popover
                      placement="bottomRight"
                      trigger="click"
                      title="上下文占用"
                      content={
                        <ContextBreakdownPanel
                          breakdown={fallbackBreakdown}
                          realTokens={state.contextRealTokens}
                          onCompress={chatState.handleCompressContext}
                          loading={chatState.isCompressing}
                        />
                      }
                    >
                      <span>
                        <ContextIndicator
                          percent={percent}
                          loading={chatState.isCompressing}
                          usedTokens={total}
                          limitTokens={limit}
                        />
                      </span>
                    </Popover>
                  </>
                )
              })()}
            </div>
          </div>

          {activeView === 'chat' ? (<>
          <div className="smart-chat-list" ref={chatListRef}>
        {welcomeVisible ? (
          // v9.0.0 补充21：欢迎页（左侧最近会话 + 右侧欢迎语 + 顶部工作区状态条）
          <WelcomeScreen
            workspacePath={workspacePath}
            recentSessions={recentSessions}
            onPickWorkspace={handleWelcomePickWorkspace}
            onClearWorkspace={handleWelcomeClearWorkspace}
            onNewSession={handleWelcomeNewSession}
            onOpenSession={handleWelcomeOpenSession}
            onQuickPrompt={handleQuickPrompt}
          />
        ) : (
          <List
            dataSource={state.messages}
            renderItem={(item) => {
              // P3 commit 2: SystemErrorBubble 渲染 type='error' 气泡（chat stream + Agent 错误路径共用）
              if (item.type === 'error') {
                const idx = state.messages.findIndex(m => m === item)
                const prev = state.messages.slice(0, idx).reverse().find(m => m.role === 'assistant')
                return (
                  <List.Item style={{ padding: 0, border: 'none' }}>
                    <SystemErrorBubble
                      errorPayload={item.classifiedError}
                      previousAssistantContent={prev?.content || ''}
                    />
                  </List.Item>
                )
              }
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
                  {item.role === 'assistant' && <Avatar src={ASSISTANT_AVATAR_SRC} className="chat-avatar smart-assistant-message-avatar" />}
                  {item.role === 'assistant' ? (
                    <div className="smart-chat-body-assistant" style={{ flex: 1, minWidth: 0 }}>
                      {((item._streaming && state.agent.timeline?.length > 0) ||
                        (item.timeline && item.timeline.length > 0)) && (
                        <StreamingAgentCard
                          timeline={item.timeline}
                          liveTimeline={state.agent.timeline}
                          live={!!item._streaming}
                          status={item._streaming ? state.agent.status : 'done'}
                          showControls={!!item._streaming}
                          agentReplyText={item._streaming ? state.agent.replyText : ''}
                          isPaused={item._streaming ? state.agent.status === 'paused' : false}
                          stats={item.stats}
                          onPause={() => pauseAgent({ dispatch, sessionId: state.session.currentId })}
                          onResume={() => resumeAgent({ dispatch, sessionId: state.session.currentId })}
                          onAbort={() => abortAgent({ dispatch, requestId: state.agent.requestId, sessionId: state.session.currentId })}
                          onInspectTool={(toolCallId) => {
                            // v0.9.x 轨迹阶段2：聊天工具块 → 轨迹视图定位
                            setTrajectoryFocus(toolCallId)
                            setActiveView('trajectory')
                          }}
                        />
                      )}
                      <MessageContent
                        item={item}
                        agentStatus={state.agent.status}
                        agentReplyText={state.agent.replyText}
                        onOpenMd={handleOpenMd}
                      />
                      {/* v0.9.x 输出优化：本轮产出文件 chips（从 timeline 提取） */}
                      {item.role === 'assistant' && !item._streaming && (
                        <ProducedFilesChips timeline={item.timeline} onOpenMd={handleOpenMd} />
                      )}
                      {/* v0.9.x 输出优化：assistant 消息操作条（复制/赞/踩） */}
                      {item.role === 'assistant' && !item._streaming && (
                        <MessageActions message={item} />
                      )}
                      {/* 历史 todo 快照（只读）：留在上一轮 agent 输出中 */}
                      {item.todoSnapshot && (
                        <TodoPanel readOnly snapshot={item.todoSnapshot} />
                      )}
                      {/* 附件文件卡片：bot 报告里携带的 docx/xlsx/md/pdf 文件 */}
                      {item.role === 'assistant' && Array.isArray(item.attachments) && item.attachments.length > 0 && (
                        <div className="file-message-card-list" style={{ marginTop: 8 }}>
                          {item.attachments.map((att, idx) => (
                            <FileMessageCard key={`${att.path || 'file'}-${idx}`} file={att} onOpenMd={handleOpenMd} />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    item.role === 'tool' ? (
                      <ToolMessageBubble content={item.content} />
                    ) : (
                      <div className="smart-chat-bubble-user">
                        {item.attachments && item.attachments.length > 0 && (
                          <div className="image-attachments" style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {item.attachments.map((att) => (
                              <Image
                                key={att.key}
                                src={att.base64}
                                alt={att.originalName}
                                width={200}
                                height={200}
                                style={{ objectFit: 'cover', borderRadius: 6, maxWidth: 200, maxHeight: 200 }}
                                preview={{ mask: `${att.originalName} (${att.sizeKB}KB)` }}
                              />
                            ))}
                          </div>
                        )}
                        {item._steer && <Tag color="orange" style={{ marginBottom: 4 }}>插话</Tag>}
                        {item._followUp && <Tag color="blue" style={{ marginBottom: 4 }}>追加任务</Tag>}
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
        {/* LLM 计划实时面板：独立于消息列表始终挂载，通过 todo:updated 事件保持同步 */}
        {!welcomeVisible && state.session.currentId && (
          <TodoPanel sessionId={state.session.currentId} />
        )}
        {/* 阶段 3 任务 3.3：AI 计划审批弹窗（LLM create_plan 后 pendingApproval=true 自动弹出） */}
        <PlanApprovalModal
          open={planApproval.visible}
          sessionId={state.session.currentId}
          steps={planApproval.steps}
          onClose={() => setPlanApproval(prev => ({ ...prev, visible: false }))}
        />
        {/* AI 提问弹窗：在消息列表末尾跟随 LLM 输出位置 */}
        {state.confirmation && (
          <DecisionGate
            confirmation={state.confirmation}
            onConfirm={(args) => {
              // v2026-08-03：回答带 confirmationId，主进程校验归属（旧弹窗残留回答不污染新提问）
              window.electronAPI.invoke('agent:confirm', { sessionId: state.session.currentId, confirmed: true, args: { ...args, confirmationId: state.confirmation?.confirmationId } })
              dispatch({ type: 'SET_CONFIRMATION', payload: null })
            }}
            onReject={() => {
              window.electronAPI.invoke('agent:confirm', { sessionId: state.session.currentId, confirmed: false, args: { confirmationId: state.confirmation?.confirmationId } })
              dispatch({ type: 'SET_CONFIRMATION', payload: null })
            }}
          />
        )}
        <div ref={chatState.chatEndRef} />
      </div>

      <div className="smart-chat-tags-row">
        {chatState.attachments.length > 0 && chatState.attachments.map((att) => (
          <Tag
            key={att.key}
            icon={<PictureOutlined />}
            closable
            onClose={() => chatState.setAttachments(prev => prev.filter(a => a.key !== att.key))}
            className="attachment-tag"
          >
            {att.originalName} ({att.sizeKB}KB)
          </Tag>
        ))}
      </div>
      <div className="smart-chat-input-area" style={{ position: 'relative' }} ref={inputAreaRef}>
        <SlashCommandMenu
          visible={showSlashMenu}
          input={state.input}
          cursorPos={cursorPos}
          allCommandNames={buildAllCommandNames(availableSkills)}
          menuApiRef={slashMenuApiRef}
          onSelect={(name) => {
            // cursorPos 归一化：防止 undefined/越界导致 slice 行为错乱
            const pos = normalizeCursorPos(state.input, cursorPos)
            const beforeCursor = state.input.slice(0, pos)
            const lastSpaceIdx = beforeCursor.lastIndexOf(' ')
            const cmdSegment = lastSpaceIdx === -1 ? beforeCursor : beforeCursor.slice(lastSpaceIdx + 1)
            const newBefore = beforeCursor.slice(0, beforeCursor.length - cmdSegment.length) + `/${name}`
            dispatch({ type: 'SET_INPUT', payload: newBefore + state.input.slice(pos) })
            setCursorPos(newBefore.length)
            setTimeout(() => {
              const ta = getNativeTextArea()
              if (ta) {
                ta.setSelectionRange(newBefore.length, newBefore.length)
                ta.focus()
              }
            }, 0)
          }}
          onClose={() => {
            dispatch({ type: 'SET_INPUT', payload: state.input + ' ' })
            setCursorPos(state.input.length + 1)
          }}
          position={{ bottom: 80, left: 16, right: 16 }}
        />
        {/* Stop hint (spec 7.3): 工作态时提示 Esc/Enter/停止按钮中断输出 */}
        {['streaming', 'thinking', 'tool_calling'].includes(state.agent.status) && (
          <div className="stop-hint">
            AI 正在输出中... 按 Esc 或点击停止按钮中断输出（输入框为空时也可按 Enter）
          </div>
        )}
        {isArchived && (
          <div className="archived-readonly-hint" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
            <span>此会话已归档，恢复后可继续对话</span>
            <Button size="small" type="link" onClick={handleRestoreArchived} style={{ padding: 0 }}>恢复对话</Button>
          </div>
        )}
        <div className="smart-chat-input-wrapper">
          <AppstoreOutlined className="smart-chat-input-prefix" />
          <Input.TextArea
            ref={inputRef}
            placeholder='输入 "/" 查看可用技能，或直接输入需求...'
            value={state.input}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onSelect={handleInputSelect}
            disabled={isArchived}
            autoSize={{ minRows: 1, maxRows: 6 }}
            variant="borderless"
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <Space size={0}>
            <Upload
              showUploadList={false}
              multiple
              accept=".jpg,.jpeg,.png,.webp"
              beforeUpload={async (file) => {
                const type = getAttachmentType(file.name)
                if (type === 'image') {
                  try {
                    const result = await processImageAttachment(file)
                    chatState.setAttachments(prev => [...prev, { type: 'image', key: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...result }])
                    // 同步保存到工作区 raw/images（选文件有磁盘路径 → 存原图）
                    saveChatImageToWorkspace(file, result).then(r => {
                      if (r && r.success) console.log('[chat] 图片已保存到 raw/images:', r.path)
                      else console.warn('[chat] 图片保存失败:', r && r.error)
                    }).catch(e => console.warn('[chat] 图片保存异常:', e && e.message))
                  } catch (err) {
                    message.error(err.message)
                  }
                } else {
                  message.error('仅支持图片（jpg/png/webp）文件')
                }
                return false
              }}
            >
              <Button type="text" size="small" icon={<PlusOutlined />} title="上传图片" />
            </Upload>
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClearChat}
              disabled={state.messages.length === 0}
              title="清空对话"
            />
            <Tooltip title="从上次中断处继续执行（断点续跑）">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleResumeFromCheckpoint}
                disabled={isAgentBusy || !state.session.currentId || state.messages.length === 0}
              />
            </Tooltip>
          </Space>
          {isAgentBusy ? (
            <Button
              type="primary"
              danger
              icon={<PauseCircleOutlined />}
              onClick={() => abortAgent({ dispatch, requestId: state.agent.requestId, sessionId: state.session.currentId })}
            >
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSendChat}
              disabled={!state.input.trim() || isArchived}
            >
              发送
            </Button>
          )}
        </div>
      </div>
      </>) : (
        /* v0.9.x 轨迹功能：会话 AI 操作全过程视图（含实时同步的运行中步骤） */
        <TrajectoryPanel
          messages={state.messages}
          liveTimeline={state.agent.timeline}
          agentStatus={state.agent.status}
          focusToolCallId={trajectoryFocus}
        />
      )}
      <LintReportModal
        visible={lintModalOpen}
        onClose={() => setLintModalOpen(false)}
      />
    </div>
      {reader.state.isOpen && (
        <MdReaderPanel
          state={reader.state}
          panelWidth={reader.panelWidth}
          onClose={reader.closeTab}
          onSelect={reader.selectTab}
          onCollapse={reader.collapse}
          onToggleEdit={reader.toggleEdit}
          onDraftChange={reader.setDraft}
          onConflictResolve={reader.resolveConflict}
          onResize={reader.setPanelWidth}
        />
      )}
    </Content>
    </Layout>
  )
}

// 命名导出：不带 Provider，供已提升 Provider 的父组件使用
export { SmartDesignChat }

export default function SmartDesignChatWrapper(props) {
  return (
    <AgentStoreProvider>
      <SmartDesignChat {...props} />
    </AgentStoreProvider>
  )
}

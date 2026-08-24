// 聊天消息 markdown 渲染（从 SmartDesignChat.jsx 拆分，行为不变）
// 零 store/IPC 依赖：仅接收 item 与 onOpenMd 回调。
import React, { useDeferredValue } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
export function linkifyMdRefs(content) {
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

export default function MessageContent({ item, agentStatus, agentReplyText, onOpenMd }) {
  // v10.10.12 修复：agent 流式输出时 ReactMarkdown 每条 IPC 都重新解析整个 markdown，
  // 大段输出（几万字）会卡死渲染进程 → 白屏。useDeferredValue 让 React 自动降速。
  const deferredReplyText = useDeferredValue(agentReplyText)
  const mdComponents = makeMdComponents(onOpenMd)
  if (item.role !== 'assistant') {
    return <ReactMarkdown components={mdComponents}>{linkifyMdRefs(item.content)}</ReactMarkdown>
  }
  if (agentStatus === 'thinking' && item._streaming) {
    // 2026-08-24 去重：thinking 占位与 StreamingAgentCard 顶部状态条（含暂停/取消）重复，保留状态条
    return null
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

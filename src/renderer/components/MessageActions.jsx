import React, { useState } from 'react'
import { Button, Space, Tooltip, App } from 'antd'
import {
  CopyOutlined,
  LikeOutlined,
  DislikeOutlined,
  LikeFilled,
  DislikeFilled,
} from '@ant-design/icons'

/**
 * v0.9.x 输出优化：assistant 消息操作条（复制 / 赞 / 踩）
 *
 * - 复制：navigator.clipboard 复制消息全文（Electron 渲染进程可用）
 * - 赞/踩：写 chat_history.metadata.feedback（agent:setMessageFeedback），
 *   可切换（赞→踩）与取消（再点一次）；反馈值持久化在 DB，刷新后仍保留
 * - 消息 id 来自 DB（历史消息加载即有；新消息在 useAssistantPersistence
 *   落库后经 UPDATE_MESSAGE_ID 回写）；无 id 时赞踩禁用并提示
 */
const MessageActions = ({ message }) => {
  const [feedback, setFeedback] = useState(message?.feedback || message?.metadata?.feedback || null)
  const [busy, setBusy] = useState(false)
  // antd 推荐：动态主题下用 App.useApp() 取 message，避免静态函数警告
  const { message: appMessage } = App.useApp()

  if (!message || message.role !== 'assistant') return null

  const onCopy = async () => {
    const text = message.content || ''
    if (!text.trim()) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
      appMessage.success('已复制')
    } catch (e) {
      appMessage.error('复制失败')
    }
  }

  const setFeedbackValue = async (value) => {
    if (!message.id) {
      appMessage.info('该消息尚未保存，暂不支持反馈')
      return
    }
    if (busy) return
    setBusy(true)
    try {
      const next = feedback === value ? null : value
      const r = await window.electronAPI.invoke('agent:setMessageFeedback', {
        messageId: message.id,
        feedback: next,
      })
      if (r && r.success) {
        setFeedback(next)
      } else {
        appMessage.error((r && r.error) || '反馈失败')
      }
    } catch (e) {
      appMessage.error('反馈失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Space size={2} style={{ marginTop: 4, opacity: 0.75 }}>
      <Tooltip title="复制回复内容">
        <Button type="text" size="small" icon={<CopyOutlined />} onClick={onCopy} aria-label="复制" />
      </Tooltip>
      <Tooltip title={feedback === 'like' ? '取消赞' : '有帮助'}>
        <Button
          type="text"
          size="small"
          icon={feedback === 'like' ? <LikeFilled style={{ color: 'var(--color-primary, #0071e3)' }} /> : <LikeOutlined />}
          onClick={() => setFeedbackValue('like')}
          disabled={!message.id}
          aria-label="赞"
        />
      </Tooltip>
      <Tooltip title={feedback === 'dislike' ? '取消踩' : '没帮助'}>
        <Button
          type="text"
          size="small"
          icon={feedback === 'dislike' ? <DislikeFilled style={{ color: 'var(--color-error, #FF3B30)' }} /> : <DislikeOutlined />}
          onClick={() => setFeedbackValue('dislike')}
          disabled={!message.id}
          aria-label="踩"
        />
      </Tooltip>
    </Space>
  )
}

export default MessageActions

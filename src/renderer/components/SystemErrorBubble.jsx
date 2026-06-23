import React, { useState } from 'react'
import { Button, message as antdMessage } from 'antd'
import { CopyOutlined, DownOutlined, UpOutlined } from '@ant-design/icons'

const SOFT_DISPLAY_LIMIT = 2 * 1024

function softTruncate(value) {
  if (typeof value !== 'string') return value
  if (value.length > SOFT_DISPLAY_LIMIT) return value.slice(0, SOFT_DISPLAY_LIMIT) + '...'
  return value
}

function buildCopyText(errorPayload, previousAssistantContent) {
  const e = errorPayload || {}
  const lines = [
    `[${e.code || 'UNKNOWN'}] ${e.title || e.message || '未知错误'}`,
    e.hint ? `建议：${e.hint}` : null,
    e.details?.occurredAt ? `时间：${e.details.occurredAt}` : null,
    '',
    e.details?.httpStatus ? `HTTP 状态：${e.details.httpStatus}` : null,
    e.details?.endpoint ? `接口：${e.details.endpoint}` : null,
    e.details?.rawMessage ? `错误原文：${e.details.rawMessage}` : null,
    e.details?.callSite ? `调用位置：${e.details.callSite}` : null,
  ].filter(Boolean)
  if (previousAssistantContent) {
    lines.push('', '—— AI 中断前的最后回复 ——', previousAssistantContent.slice(0, SOFT_DISPLAY_LIMIT))
  }
  return lines.join('\n')
}

export default function SystemErrorBubble({ errorPayload, previousAssistantContent = '', onCopy }) {
  const [expanded, setExpanded] = useState(false)
  const e = errorPayload || {}

  if (!e.code) {
    // 兼容老会话历史（无 code 字段）
    return (
      <div style={{ padding: 12, border: '1px solid #ffccc7', background: '#fff2f0', borderRadius: 8 }}>
        {'⚠'} {e.message || '未知错误'}
      </div>
    )
  }

  const handleCopy = async () => {
    const text = buildCopyText(e, previousAssistantContent)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // 兜底：通过 IPC 调主进程 clipboard
        await window.electronAPI?.invoke?.('clipboard:writeText', text)
      }
      antdMessage.success('错误信息已复制')
      onCopy?.(e, previousAssistantContent)
    } catch (err) {
      antdMessage.error('复制失败，请手动复制')
    }
  }

  return (
    <div
      style={{
        padding: 12,
        border: '1px solid #ffccc7',
        background: '#fff2f0',
        borderRadius: 8,
        margin: '8px 0',
      }}
    >
      <div style={{ fontSize: 14, color: '#cf1322', fontWeight: 600 }}>
        {'⚠'}{' '}
        <span style={{ fontFamily: 'Consolas, Monaco, monospace' }}>[{e.code}]</span>{' '}
        {e.title}
      </div>
      {e.hint && (
        <div style={{ marginTop: 6, color: '#595959' }}>
          {'💡'} {e.hint}
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <Button
          size="small"
          onClick={() => setExpanded(!expanded)}
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
        >
          {expanded ? '收起详情' : '查看详情'}
        </Button>
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
          复制错误信息
        </Button>
      </div>
      {expanded && e.details && (
        <div
          style={{
            marginTop: 10,
            padding: 8,
            background: '#fafafa',
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {e.details.httpStatus && <div>HTTP 状态：{e.details.httpStatus}</div>}
          {e.details.endpoint && <div>接口：{e.details.endpoint}</div>}
          {e.details.occurredAt && <div>发生时间：{e.details.occurredAt}</div>}
          {e.details.rawMessage && (
            <div>错误原文：{softTruncate(String(e.details.rawMessage))}</div>
          )}
          {e.details.callSite && <div>调用位置：{e.details.callSite}</div>}
        </div>
      )}
    </div>
  )
}

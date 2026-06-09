import React, { useState } from 'react'
import { Card, Button, Typography, Space, Tag } from 'antd'
import { ToolOutlined, DownOutlined, RightOutlined } from '@ant-design/icons'

const { Text } = Typography

/**
 * ToolMessageBubble - 历史会话中 tool 消息的折叠显示
 * 检测 JSON 内容，自动折叠并显示摘要
 */
export default function ToolMessageBubble({ content }) {
  const [expanded, setExpanded] = useState(false)

  if (!content) return <Text type="secondary">（空消息）</Text>

  // 尝试解析 JSON
  let parsed = null
  let isJson = false
  if (typeof content === 'string' && (content.trim().startsWith('{') || content.trim().startsWith('['))) {
    try {
      parsed = JSON.parse(content)
      isJson = true
    } catch (_) {}
  } else if (typeof content === 'object') {
    parsed = content
    isJson = true
  }

  const summary = isJson && parsed
    ? extractSummary(parsed)
    : (typeof content === 'string' ? content.slice(0, 100) + (content.length > 100 ? '...' : '') : JSON.stringify(content).slice(0, 100))

  const rawText = typeof content === 'string' ? content : JSON.stringify(content, null, 2)

  return (
    <Card
      size="small"
      style={{ marginBottom: 8, maxWidth: 520, background: '#fafafa', borderColor: '#e8e8e8' }}
      bodyStyle={{ padding: '8px 12px' }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={4}>
        <div
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setExpanded(!expanded)}
        >
          <ToolOutlined style={{ color: '#8c8c8c', fontSize: 14 }} />
          <Text type="secondary" style={{ fontSize: 13, flex: 1 }}>{summary}</Text>
          {rawText.length > 120 && (
            <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }}>
              {expanded ? <><DownOutlined /> 收起</> : <><RightOutlined /> 展开</>}
            </Button>
          )}
        </div>
        {expanded && (
          <pre style={{
            margin: 0, padding: '8px 10px', background: '#f0f0f0', borderRadius: 4,
            fontSize: 12, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
          }}>
            {rawText}
          </pre>
        )}
      </Space>
    </Card>
  )
}

function extractSummary(data) {
  if (!data) return '空数据'

  // material-query 结果
  if (data.materials && Array.isArray(data.materials)) {
    const types = [...new Set(data.materials.map(m => m.type).filter(Boolean))]
    return `材料库查询结果：${data.count || data.materials.length} 条材料 (${types.join('、')})`
  }

  // 带 success/count 的结构
  if (data.success !== undefined && data.count !== undefined) {
    return `工具返回：${data.count} 条记录`
  }

  // 带 error 的结果
  if (data.success === false && data.error) {
    return `工具执行失败：${typeof data.error === 'object' ? data.error.message || JSON.stringify(data.error) : data.error}`
  }

  // 通用：显示顶层 key
  const keys = Object.keys(data)
  if (keys.length <= 3) {
    return `数据：${keys.join('、')}`
  }
  return `数据：${keys.slice(0, 3).join('、')} 等 ${keys.length} 个字段`
}

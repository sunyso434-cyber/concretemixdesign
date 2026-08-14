import React, { useState } from 'react'
import { Card, Button, Typography, Space, Table } from 'antd'
import { ToolOutlined, DownOutlined, RightOutlined } from '@ant-design/icons'
import { resultToTableData } from '../utils/toolResultTable'
import MixDesignResultCard from './MixDesignResultCard'

const { Text } = Typography

/**
 * ToolMessageBubble - 历史会话中 tool 消息的折叠显示
 *
 * v0.9.x 输出优化：与 Timeline 工具块保持一致 —
 * 展开后优先结构化展示（配合比卡片 / 表格），原始 JSON 收进"查看原始数据"折叠。
 * 旧会话加载的 tool 消息因此也能获得与实时对话相同的视觉体验。
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

  // v0.9.x：结构化展示（与新对话 Timeline 工具块一致）
  const mixDesignData = parsed && parsed.type === 'mix_design' && parsed.data ? parsed.data : null
  const tableData = parsed && !mixDesignData ? resultToTableData(parsed) : null
  const hasStructuredView = !!(mixDesignData || tableData)

  return (
    <Card
      size="small"
      style={{ marginBottom: 8, maxWidth: 560, background: '#fafafa', borderColor: '#e8e8e8' }}
      styles={{ body: { padding: '8px 12px' } }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={4}>
        <div
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setExpanded(!expanded)}
        >
          <ToolOutlined style={{ color: '#8c8c8c', fontSize: 14 }} />
          <Text type="secondary" style={{ fontSize: 13, flex: 1 }}>{summary}</Text>
          {(rawText.length > 120 || hasStructuredView) && (
            <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }}>
              {expanded ? <><DownOutlined /> 收起</> : <><RightOutlined /> 展开</>}
            </Button>
          )}
        </div>
        {expanded && (
          <div style={{ width: '100%' }}>
            {mixDesignData && (
              <div style={{ margin: '4px 0' }}>
                <MixDesignResultCard data={mixDesignData} />
              </div>
            )}
            {tableData && (
              <div style={{ margin: '4px 0' }}>
                <Table
                  size="small"
                  columns={tableData.columns}
                  dataSource={tableData.data}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  style={{ fontSize: 12 }}
                />
              </div>
            )}
            {/* 原始 JSON：收进折叠（与新对话"查看原始数据"一致） */}
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: '#999', userSelect: 'none' }}>
                查看原始数据
              </summary>
              <pre style={{
                margin: '4px 0 0 0', padding: '8px 10px', background: '#f0f0f0', borderRadius: 4,
                fontSize: 12, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
              }}>
                {rawText}
              </pre>
            </details>
          </div>
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

  // 配合比设计结果
  if (data.type === 'mix_design' && data.data) {
    const d = data.data
    const parts = []
    if (d.strength) parts.push(d.strength)
    if (d.waterRatio) parts.push(`水胶比 ${d.waterRatio.toFixed(4)}`)
    if (d.totalCost) parts.push(`成本 ¥${d.totalCost.toFixed(2)}`)
    return `配合比设计结果${parts.length ? '：' + parts.join(' · ') : ''}`
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

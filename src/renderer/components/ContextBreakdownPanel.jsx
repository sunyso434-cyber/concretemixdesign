import React from 'react'
import { Button, Progress, Space, Typography } from 'antd'
import { CompressOutlined } from '@ant-design/icons'

const { Text } = Typography

/**
 * v0.9.x 输出优化：上下文占用细分面板（点击 ContextIndicator 圆环弹出）
 *
 * 数据：state.contextBreakdown = { system, tools, messages }（token 估算，
 * 来自主进程 context_stats 事件）；无数据时降级为仅显示总量 + 压缩按钮。
 */
const SEGMENTS = [
  { key: 'system', label: '系统提示词', color: '#1890ff' },
  { key: 'tools', label: '工具定义', color: '#722ed1' },
  { key: 'messages', label: '对话消息', color: '#52c41a' },
]

const ContextBreakdownPanel = ({ breakdown, onCompress, loading }) => {
  const total = breakdown
    ? (Number(breakdown.system) || 0) + (Number(breakdown.tools) || 0) + (Number(breakdown.messages) || 0)
    : 0

  const fmt = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '—'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
    return String(Math.round(n))
  }

  return (
    <div style={{ width: 260 }}>
      {breakdown && total > 0 ? (
        <>
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            {SEGMENTS.map((seg) => {
              const value = Number(breakdown[seg.key]) || 0
              const pct = total > 0 ? Math.round((value / total) * 100) : 0
              return (
                <div key={seg.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                    <Text style={{ fontSize: 12 }}>{seg.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{fmt(value)} · {pct}%</Text>
                  </div>
                  <Progress
                    percent={pct}
                    showInfo={false}
                    strokeColor={seg.color}
                    size="small"
                    style={{ marginBottom: 0 }}
                  />
                </div>
              )
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}>
              <Text style={{ fontSize: 12 }}>合计（估算）</Text>
              <Text style={{ fontSize: 12 }}>{fmt(total)}</Text>
            </div>
          </Space>
        </>
      ) : (
        <Text type="secondary" style={{ fontSize: 12 }}>暂无构成数据（运行一次 AI 任务后可见）</Text>
      )}
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <Button
          size="small"
          type="primary"
          ghost
          icon={<CompressOutlined />}
          loading={loading}
          onClick={onCompress}
        >
          立即压缩
        </Button>
      </div>
    </div>
  )
}

export default ContextBreakdownPanel

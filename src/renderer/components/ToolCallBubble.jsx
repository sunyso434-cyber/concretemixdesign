import React from 'react'
import { Card, Progress, Space, Typography, Tag } from 'antd'
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

const TOOL_LABELS = {
  list_available_materials: '查询材料库',
  calculate_mix_design: '计算配合比',
  optimize_mix_cost: '成本优化搜索',
  compare_materials: '材料对比分析',
  check_compliance: '规范审查',
  run_parameter_diagnosis: '参数诊断',
  predict_performance: '性能预测'
}

const STATUS_TEXT = {
  loading: '...',
  done: ' 已完成',
  error: ' 执行失败'
}

const ToolCallBubble = ({ status, toolName, summary, error }) => {
  const title = TOOL_LABELS[toolName] || toolName

  return (
    <Card size="small" style={{ marginBottom: 8, maxWidth: 480 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          {status === 'loading' && <LoadingOutlined style={{ color: '#1890ff' }} />}
          {status === 'done' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
          {status === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
          <Text strong>{title}{STATUS_TEXT[status] || ''}</Text>
        </Space>

        {summary && (
          <div>
            {summary.split('|').filter(Boolean).map((s, i) => (
              <Tag key={i} style={{ marginBottom: 4 }}>{s.trim()}</Tag>
            ))}
          </div>
        )}

        {status === 'loading' && <Progress percent={100} status="active" showInfo={false} size="small" />}

        {status === 'error' && error && (
          <Text type="danger">{error}</Text>
        )}
      </Space>
    </Card>
  )
}

export default ToolCallBubble

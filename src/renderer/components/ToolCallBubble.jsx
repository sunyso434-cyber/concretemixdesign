import React from 'react'
import { Card, Progress, Space, Typography, Tag } from 'antd'
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

const TOOL_LABELS = {
  list_available_materials: { title: '查询材料库', icon: '📋' },
  calculate_mix_design: { title: '计算配合比', icon: '📊' },
  optimize_mix_cost: { title: '成本优化搜索', icon: '🏆' },
  compare_materials: { title: '材料对比分析', icon: '🔍' },
  check_compliance: { title: '规范审查', icon: '📋' },
  run_parameter_diagnosis: { title: '参数诊断', icon: '🔍' },
  predict_performance: { title: '性能预测', icon: '📈' }
}

const ToolCallBubble = ({ status, toolName, summary, error }) => {
  const info = TOOL_LABELS[toolName] || { title: toolName, icon: '🔧' }

  return (
    <Card size="small" style={{ marginBottom: 8, maxWidth: 480 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          {status === 'loading' && <LoadingOutlined style={{ color: '#1890ff' }} />}
          {status === 'done' && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
          {status === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
          <Text strong>
            {info.icon} {info.title}
            {status === 'loading' ? '...' : status === 'done' ? ' ✓' : ' ✗'}
          </Text>
        </Space>

        {status === 'loading' && summary && (
          <div>
            {summary.split('|').map((s, i) => (
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

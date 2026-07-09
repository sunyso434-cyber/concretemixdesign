import React from 'react'
import { Card, Progress, Space, Typography, Tag } from 'antd'
import { LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

const TOOL_LABELS = {
  list_available_materials: '查询材料库',
  calculate_mix_design: '计算配合比',
  optimize_mix_cost: '成本优化搜索',
  check_compliance: '规范审查',
  predict_performance: '性能预测',
  list_standards: '查询规范库',
  prepare_sales_quote_draft: '准备报价草稿（已废弃）',
  calculate_sales_quote: '计算销售报价（已废弃）',
  create_sales_quote_rule: '创建报价规则（已废弃）',
  reverse_sales_quote: '反向套价（普通混凝土）',
  forward_sales_quote: '正向测算（特殊混凝土）',
  format_quote_report: '导出报价单',
  save_mix_design: '保存配合比方案'
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
          <Text type="danger">
            {typeof error === 'object' ? (error.message || JSON.stringify(error)) : String(error)}
          </Text>
        )}
      </Space>
    </Card>
  )
}

export default ToolCallBubble

import React from 'react'
import { Card, Tag, Typography, Collapse } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, SafetyOutlined } from '@ant-design/icons'

const { Text } = Typography

// 合规状态映射
const STATUS_MAP = {
  compliant: { label: '合规', color: 'success', icon: <CheckCircleOutlined /> },
  non_compliant: { label: '不合规', color: 'error', icon: <CloseCircleOutlined /> },
  conditional: { label: '有条件合规', color: 'warning', icon: <ExclamationCircleOutlined /> }
}

// 严重程度映射
const SEVERITY_MAP = {
  error: { label: '违规', color: '#ff4d4f', tagColor: 'red' },
  warning: { label: '警告', color: '#faad14', tagColor: 'orange' },
  info: { label: '合规', color: '#1890ff', tagColor: 'blue' }
}

const ComplianceResultCard = ({ data }) => {
  if (!data) return null

  const { complianceStatus, issues = [], compliantItems = [], summary } = data
  const statusConfig = STATUS_MAP[complianceStatus] || STATUS_MAP.conditional

  // 渲染问题列表（用 Collapse 展示）
  const renderIssues = () => {
    if (!issues || issues.length === 0) return null

    const collapseItems = issues.map((issue, index) => {
      const severityConfig = SEVERITY_MAP[issue.severity] || SEVERITY_MAP.warning
      const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag color={severityConfig.tagColor}>{severityConfig.label}</Tag>
          <Text strong style={{ fontSize: 13 }}>
            {issue.clause}{issue.standardName ? ` - ${issue.standardName}` : ''}
          </Text>
        </div>
      )

      const children = (
        <div style={{ fontSize: 13 }}>
          <div style={{ marginBottom: 6 }}>{issue.message}</div>
          {issue.currentValue && (
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">当前值：</Text>
              <Text>{issue.currentValue}</Text>
            </div>
          )}
          {issue.limitValue && (
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">限值：</Text>
              <Text>{issue.limitValue}</Text>
            </div>
          )}
          {issue.suggestion && (
            <div>
              <Text type="secondary">建议：</Text>
              <Text style={{ color: '#52c41a' }}>{issue.suggestion}</Text>
            </div>
          )}
        </div>
      )

      return {
        key: String(index),
        label: header,
        children
      }
    })

    return (
      <div style={{ marginTop: 12 }}>
        <Text strong style={{ fontSize: 14 }}>
          <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />
          发现问题（{issues.length}）
        </Text>
        <Collapse
          size="small"
          items={collapseItems}
          style={{ marginTop: 8 }}
          // 左边框带颜色标识
          className="compliance-issues-collapse"
        />
      </div>
    )
  }

  // 渲染合规项列表
  const renderCompliantItems = () => {
    if (!compliantItems || compliantItems.length === 0) return null

    return (
      <div style={{ marginTop: 12 }}>
        <Text strong style={{ fontSize: 14 }}>
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
          合规项（{compliantItems.length}）
        </Text>
        <div style={{ marginTop: 8 }}>
          {compliantItems.map((item, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
                borderBottom: index < compliantItems.length - 1 ? '1px solid #f0f0f0' : 'none'
              }}
            >
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
              <Text style={{ fontSize: 13 }}>
                {item.clause}
                {item.message ? ` - ${item.message}` : ''}
              </Text>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Card
      size="small"
      title={
        <span>
          <SafetyOutlined style={{ marginRight: 6 }} />
          规范审查结果
        </span>
      }
      extra={
        <Tag color={statusConfig.color} icon={statusConfig.icon}>
          {statusConfig.label}
        </Tag>
      }
      style={{ marginBottom: 8, maxWidth: 650 }}
    >
      {/* 摘要 */}
      {summary && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {summary}
        </Text>
      )}

      {/* 问题列表 */}
      {renderIssues()}

      {/* 合规项列表 */}
      {renderCompliantItems()}

      {/* 内联样式：Collapse 左边框颜色 */}
      <style>{`
        .compliance-issues-collapse .ant-collapse-item {
          border-left: 3px solid #ff4d4f !important;
        }
        .compliance-issues-collapse .ant-collapse-item:last-child {
          border-left: 3px solid #ff4d4f !important;
        }
      `}</style>
    </Card>
  )
}

export default ComplianceResultCard
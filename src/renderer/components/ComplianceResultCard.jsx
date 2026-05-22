import React from 'react'
import { Alert, Card, Tag, Typography, Collapse } from 'antd'
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
  error: { label: '明确不合规', color: '#ff4d4f', tagColor: 'red' },
  warning: { label: '需确认/风险', color: '#faad14', tagColor: 'orange' },
  info: { label: '合规', color: '#1890ff', tagColor: 'blue' }
}

const hasDisplayValue = (value) => value !== null && value !== undefined && value !== ''

const ComplianceResultCard = ({ data }) => {
  if (!data) return null

  const { complianceStatus, issues = [], compliantItems = [], summary } = data
  const statusConfig = STATUS_MAP[complianceStatus] || STATUS_MAP.conditional

  const renderAssumptions = () => {
    const assumptions = data.assumptions || []
    if (!data.assumptionNotice && assumptions.length === 0) return null

    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 10 }}
        message={data.assumptionNotice || '本次审查使用默认审查条件。'}
        description={assumptions.length > 0 ? (
          <div>
            {assumptions.map(item => (
              <div key={item.field}>
                <Text type="secondary">{item.reason}：</Text>
                <Text>{item.defaultValue}</Text>
              </div>
            ))}
          </div>
        ) : null}
      />
    )
  }

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
          {hasDisplayValue(issue.currentValue) && (
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">当前值：</Text>
              <Text>{issue.currentValue}</Text>
            </div>
          )}
          {hasDisplayValue(issue.limitValue) && (
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">限值：</Text>
              <Text>{issue.limitValue}</Text>
            </div>
          )}
          {issue.comparison && (
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">判断关系：</Text>
              <Text>{issue.comparison}</Text>
            </div>
          )}
          {issue.suggestion && (
            <div>
              <Text type="secondary">建议：</Text>
              <Text style={{ color: '#52c41a' }}>{issue.suggestion}</Text>
            </div>
          )}
          {issue.originalText && (
            <div style={{ marginTop: 6, padding: 8, background: '#fafafa', borderRadius: 4 }}>
              <Text type="secondary">规范原文：</Text>
              <Text>{issue.originalText}</Text>
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

  const renderScope = () => {
    if (!data.scope) return null

    const requestedText = Array.isArray(data.scope.requested)
      ? data.scope.requested.join('、')
      : data.scope.requested
    const modeText = data.scope.mode === 'category'
      ? '按类别'
      : data.scope.mode === 'single'
        ? '按单本规范'
        : '按指定范围'

    return (
      <div style={{ marginBottom: 10 }}>
        <Text strong>审查范围：</Text>
        <Text type="secondary">
          {modeText}{requestedText ? `（${requestedText}）` : ''}
        </Text>
        {data.scope.matchedStandards?.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {data.scope.matchedStandards.map(std => (
              <Tag key={std.id || std.name} color="blue">
                {std.name}{std.category ? ` / ${std.category}` : ''}
              </Tag>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderManualReviewItems = () => {
    const items = data.manualReviewItems || []
    if (items.length === 0) return null

    return (
      <div style={{ marginTop: 12 }}>
        <Text strong style={{ fontSize: 14 }}>
          <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 4 }} />
          需人工确认（{items.length}）
        </Text>
        <div style={{ marginTop: 8 }}>
          {items.map((item, index) => (
            <div
              key={`${item.standardName || ''}-${item.clause || index}`}
              style={{ padding: '6px 0', borderBottom: index < items.length - 1 ? '1px solid #f0f0f0' : 'none' }}
            >
              <Tag color="gold">需确认</Tag>
              <Text strong>
                {item.count ? `${item.count} 条规则需补充数据` : `${item.standardName || '未标明规范'} ${item.clause || ''}`}
              </Text>
              <div style={{ marginTop: 4 }}>
                <Text type="secondary">{item.reason || '条款适用条件不完整，建议人工复核。'}</Text>
              </div>
              {Array.isArray(item.clauses) && item.clauses.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary">
                    涉及条文：{item.clauses.slice(0, 3).map(clause => clause.clause).filter(Boolean).join('、')}
                    {item.clauses.length > 3 ? ` 等 ${item.clauses.length} 条` : ''}
                  </Text>
                </div>
              )}
              {item.originalText && (
                <div style={{ marginTop: 4, padding: 8, background: '#fafafa', borderRadius: 4 }}>
                  <Text type="secondary">规范原文：</Text>
                  <Text>{item.originalText}</Text>
                </div>
              )}
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
      {renderScope()}
      {renderAssumptions()}

      {/* 摘要 */}
      {summary && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {summary}
        </Text>
      )}

      {/* 问题列表 */}
      {renderIssues()}

      {renderManualReviewItems()}

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

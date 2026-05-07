import React from 'react'
import { Card, Table, Tag, Typography, Alert, Collapse } from 'antd'
import { ExclamationCircleOutlined, CheckCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

const DiagnosisResultCard = ({ data }) => {
  if (!data) return null

  const { summary, strengthParams, admixtureParams, reducingRateParams, residuals } = data

  const columns = [
    {
      title: '参数',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      render: (text, record) => (
        <span>
          {text}
          <Text type="secondary" style={{ marginLeft: 4, fontSize: 12 }}>
            {record.symbol}
          </Text>
        </span>
      )
    },
    {
      title: '设计值',
      dataIndex: 'designValue',
      key: 'designValue',
      width: 80,
      render: (v) => {
        if (v === undefined || v === null) return '-'
        return typeof v === 'number' && v < 1 ? v.toFixed(3) : typeof v === 'number' ? v.toFixed(1) : v
      }
    },
    {
      title: '反算值',
      dataIndex: 'diagnosedValue',
      key: 'diagnosedValue',
      width: 80,
      render: (v) => {
        if (v === undefined || v === null) return '-'
        return typeof v === 'number' && v < 1 ? v.toFixed(3) : typeof v === 'number' ? v.toFixed(1) : v
      }
    },
    {
      title: '偏差',
      dataIndex: 'deviationPercent',
      key: 'deviationPercent',
      width: 100,
      render: (v, record) => {
        if (v === undefined || v === null) return '-'
        const absV = Math.abs(v)
        const color = absV > 5 ? 'red' : absV > 2 ? 'orange' : 'green'
        return (
          <Text type={color === 'red' ? 'danger' : color === 'orange' ? 'warning' : 'success'} strong>
            {v > 0 ? '+' : ''}{v}%
          </Text>
        )
      }
    },
    {
      title: '方向',
      dataIndex: 'direction',
      key: 'direction',
      width: 60,
      render: (v) => {
        if (!v) return '-'
        return (
          <Tag color={v === '偏高' ? 'red' : v === '偏低' ? 'blue' : 'green'}>
            {v}
          </Tag>
        )
      }
    },
    {
      title: '可信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 60,
      render: (v) => {
        if (!v) return '-'
        return (
          <Tag color={v === '高' ? 'green' : v === '中' ? 'orange' : 'default'}>
            {v}
          </Tag>
        )
      }
    },
    {
      title: '方法',
      dataIndex: 'method',
      key: 'method',
      width: 110,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text>
    }
  ]

  const renderParamSection = (section) => {
    if (!section) return null
    const allParams = [...(section.abnormal || []), ...(section.normal || [])]
    if (allParams.length === 0) return null

    const hasAbnormal = section.abnormal && section.abnormal.length > 0
    return (
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 14 }}>
          {hasAbnormal ? (
            <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 6 }} />
          ) : (
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
          )}
          {section.label}
        </Text>
        <Table
          columns={columns}
          dataSource={allParams.map((p, i) => ({ ...p, key: i }))}
          pagination={false}
          size="small"
          style={{ marginTop: 8 }}
          onRow={(record) => {
            if (Math.abs(record.deviationPercent) > 5) {
              return { style: { backgroundColor: '#fff7e6' } }
            }
            return {}
          }}
        />
      </div>
    )
  }

  const residualColumns = [
    { title: '配合比', dataIndex: 'groupName', key: 'groupName' },
    {
      title: '实测值(MPa)',
      dataIndex: 'actual',
      key: 'actual',
      render: (v) => v?.toFixed(1) || '-'
    },
    {
      title: '预测值(MPa)',
      dataIndex: 'predicted',
      key: 'predicted',
      render: (v) => v?.toFixed(1) || '-'
    },
    {
      title: '残差',
      dataIndex: 'residual',
      key: 'residual',
      render: (v) => {
        if (v === undefined || v === null) return '-'
        const color = Math.abs(v) > 3 ? 'red' : 'green'
        return <Text type={color === 'red' ? 'danger' : 'success'}>{v > 0 ? '+' : ''}{v?.toFixed(1)}</Text>
      }
    }
  ]

  return (
    <Card
      size="small"
      title="📊 参数诊断结果"
      style={{ marginBottom: 8, maxWidth: 650 }}
    >
      {/* 摘要 */}
      <Alert
        type={summary?.abnormalCount > 0 ? 'warning' : 'success'}
        showIcon
        message={
          <span>
            数据概况：{summary?.totalGroups || 0} 组配合比，{summary?.materialCombinations || 0} 种材料组合
            {summary?.rSquared !== undefined && `，R² = ${summary.rSquared}`}
          </span>
        }
        description={summary?.overallAssessment || ''}
        style={{ marginBottom: 12 }}
      />

      {/* 强度参数 */}
      {renderParamSection(strengthParams)}

      {/* 外加剂参数 */}
      {renderParamSection(admixtureParams)}

      {/* 减水率参数 */}
      {renderParamSection(reducingRateParams)}

      {/* 残差分析（可折叠） */}
      {residuals && residuals.length > 0 && (
        <Collapse
          size="small"
          items={[{
            key: 'residuals',
            label: '残差分析（实测值 vs 预测值）',
            children: (
              <Table
                columns={residualColumns}
                dataSource={residuals.map((r, i) => ({ ...r, key: i }))}
                pagination={false}
                size="small"
              />
            )
          }]}
          style={{ marginTop: 12 }}
        />
      )}
    </Card>
  )
}

export default DiagnosisResultCard

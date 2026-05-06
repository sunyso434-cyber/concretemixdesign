import React from 'react'
import { Card, Table, Typography, Alert } from 'antd'

const { Text } = Typography

const MaterialCompareCard = ({ data }) => {
  const { compareType, results } = data

  const typeLabels = {
    cement: '水泥', flyAsh: '粉煤灰', slag: '矿渣粉',
    lithiumSlag: '锂渣', compositePowder: '复合粉',
    superplasticizer: '减水剂', sand: '细骨料', stone: '粗骨料'
  }

  const columns = [
    { title: '指标', dataIndex: 'metric', key: 'metric', width: 100 },
    ...results.map((r, i) => ({
      title: r.materialName,
      dataIndex: `mat_${i}`,
      key: `mat_${i}`,
      render: (v) => {
        if (v?.highlight) {
          return <Text type={v.highlight === 'best' ? 'success' : 'danger'} strong>{v.value}</Text>
        }
        return v?.value || '-'
      }
    }))
  ]

  const bestCost = Math.min(...results.map(r => r.totalCost))
  const bestStrength = Math.max(...results.map(r => r.targetStrength || 0))

  const rows = [
    {
      metric: '28d强度(MPa)',
      ...Object.fromEntries(results.map((r, i) => [`mat_${i}`, {
        value: r.targetStrength?.toFixed(2),
        highlight: r.targetStrength === bestStrength ? 'best' : undefined
      }]))
    },
    {
      metric: '每方成本(¥)',
      ...Object.fromEntries(results.map((r, i) => [`mat_${i}`, {
        value: r.totalCost?.toFixed(2),
        highlight: r.totalCost === bestCost ? 'best' : undefined
      }]))
    },
    {
      metric: '水胶比',
      ...Object.fromEntries(results.map((r, i) => [`mat_${i}`, { value: r.waterRatio?.toFixed(4) }]))
    },
    {
      metric: '砂率(%)',
      ...Object.fromEntries(results.map((r, i) => [`mat_${i}`, { value: r.sandRatio ? (r.sandRatio * 100).toFixed(1) : '-' }]))
    },
    {
      metric: '胶材总量(kg)',
      ...Object.fromEntries(results.map((r, i) => [`mat_${i}`, { value: r.cementitiousAmount?.toFixed(1) }]))
    }
  ]

  const bestName = results.find(r => r.totalCost === bestCost)?.materialName || ''

  return (
    <Card
      size="small"
      title={`🔍 ${typeLabels[compareType] || compareType}对比分析`}
      style={{ marginBottom: 8, maxWidth: 520 }}
    >
      <Table columns={columns} dataSource={rows} pagination={false} size="small" rowKey="metric" style={{ marginBottom: 12 }} />
      <Alert
        type="info"
        showIcon
        message={`从成本角度，推荐选择 ${bestName}，每方成本 ¥${bestCost.toFixed(2)}。`}
      />
    </Card>
  )
}

export default MaterialCompareCard

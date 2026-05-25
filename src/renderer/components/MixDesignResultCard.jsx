import React from 'react'
import { Card, Table, Descriptions, Button, Space, Divider, Typography, Collapse } from 'antd'
import { SaveOutlined, CaretDownOutlined } from '@ant-design/icons'

const { Text } = Typography
const { Panel } = Collapse

const MixDesignResultCard = ({ data, onSave, onSaveBasicMix }) => {
  const { strength, slump, materials, totalCost, waterRatio, sandRatio, density, targetStrength, calculationSteps, fineAggregateBreakdown, coarseAggregateBreakdown } = data

  const materialColumns = [
    { title: '材料', dataIndex: 'name', key: 'name' },
    { title: '用量(kg/m³)', dataIndex: 'amount', key: 'amount', render: v => v?.toFixed(1) },
    { title: '占比', dataIndex: 'pct', key: 'pct', render: v => v ? `${v}%` : '-' }
  ]

  const totalWeight = (materials?.water || 0) + (materials?.cement || 0) + (materials?.flyAsh || 0) +
    (materials?.slag || 0) + (materials?.lithiumSlag || 0) + (materials?.compositePowder || 0) +
    (materials?.sand || 0) + (materials?.stone || 0) + (materials?.superplasticizer || 0)

  const materialData = [
    { key: 'water', name: '水', amount: materials?.water, pct: totalWeight ? ((materials?.water || 0) / totalWeight * 100).toFixed(1) : 0 },
    { key: 'cement', name: '水泥', amount: materials?.cement, pct: totalWeight ? ((materials?.cement || 0) / totalWeight * 100).toFixed(1) : 0 },
    ...(materials?.flyAsh > 0 ? [{ key: 'flyAsh', name: '粉煤灰', amount: materials.flyAsh, pct: ((materials.flyAsh / totalWeight) * 100).toFixed(1) }] : []),
    ...(materials?.slag > 0 ? [{ key: 'slag', name: '矿渣粉', amount: materials.slag, pct: ((materials.slag / totalWeight) * 100).toFixed(1) }] : []),
    ...(materials?.lithiumSlag > 0 ? [{ key: 'lithiumSlag', name: '锂渣', amount: materials.lithiumSlag, pct: ((materials.lithiumSlag / totalWeight) * 100).toFixed(1) }] : []),
    ...(materials?.compositePowder > 0 ? [{ key: 'compositePowder', name: '复合粉', amount: materials.compositePowder, pct: ((materials.compositePowder / totalWeight) * 100).toFixed(1) }] : []),
    ...(fineAggregateBreakdown && fineAggregateBreakdown.length > 1
      ? fineAggregateBreakdown.map((f, i) => ({
          key: `sand_${f.id || i}`,
          name: `细骨料-${f.name || `砂${i + 1}`}`,
          amount: f.amount,
          pct: totalWeight ? ((f.amount || 0) / totalWeight * 100).toFixed(1) : 0
        }))
      : [{ key: 'sand', name: '细骨料', amount: materials?.sand, pct: totalWeight ? ((materials?.sand || 0) / totalWeight * 100).toFixed(1) : 0 }]
    ),
    ...(coarseAggregateBreakdown && coarseAggregateBreakdown.length > 1
      ? coarseAggregateBreakdown.map((c, i) => ({
          key: `stone_${c.id || i}`,
          name: `粗骨料-${c.name || `石${i + 1}`}`,
          amount: c.amount,
          pct: totalWeight ? ((c.amount || 0) / totalWeight * 100).toFixed(1) : 0
        }))
      : [{ key: 'stone', name: '粗骨料', amount: materials?.stone, pct: totalWeight ? ((materials?.stone || 0) / totalWeight * 100).toFixed(1) : 0 }]
    ),
    ...(materials?.superplasticizer > 0 ? [{ key: 'sp', name: '减水剂', amount: materials.superplasticizer, pct: ((materials.superplasticizer / totalWeight) * 100).toFixed(2) }] : [])
  ]

  return (
    <Card
      size="small"
      title={<Space>📊 <Text strong>{strength} 配合比计算结果</Text></Space>}
      style={{ marginBottom: 8, maxWidth: 520 }}
    >
      <Table
        columns={materialColumns}
        dataSource={materialData}
        pagination={false}
        size="small"
        rowKey="key"
        style={{ marginBottom: 12 }}
      />

      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="水胶比">{waterRatio?.toFixed(4) || '-'}</Descriptions.Item>
        <Descriptions.Item label="砂率">{sandRatio ? `${(sandRatio * 100).toFixed(1)}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="容重">{density ? `${density.toFixed(1)} kg/m³` : '-'}</Descriptions.Item>
        <Descriptions.Item label="配制强度">{targetStrength ? `${targetStrength.toFixed(2)} MPa` : '-'}</Descriptions.Item>
        <Descriptions.Item label="坍落度">{slump ? `${slump} mm` : '-'}</Descriptions.Item>
      </Descriptions>

      <Divider style={{ margin: '12px 0' }} />

      <Space>
        <Text strong style={{ color: '#fa8c16' }}>每方成本: ¥{totalCost?.toFixed(2) || '0.00'}</Text>
        {onSave && (
          <Button type="link" icon={<SaveOutlined />} size="small" onClick={() => onSave(data)}>
            保存方案
          </Button>
        )}
        {onSaveBasicMix && (
          <Button type="link" icon={<SaveOutlined />} size="small" onClick={() => onSaveBasicMix(data)}>
            保存到基础配合比库
          </Button>
        )}
      </Space>

      {calculationSteps && calculationSteps.length > 0 && (
        <Collapse ghost size="small" style={{ marginTop: 12 }} expandIcon={({ isActive }) => <CaretDownOutlined rotate={isActive ? 180 : 0} />}>
          <Panel header="查看计算步骤" key="steps">
            {calculationSteps.map((step, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <Text strong>{step.title}</Text>
                {step.details?.map((d, j) => (
                  <div key={j}>
                    <Text type="secondary">{d.label}: </Text>
                    <Text>{d.value}</Text>
                  </div>
                ))}
              </div>
            ))}
          </Panel>
        </Collapse>
      )}
    </Card>
  )
}

export default MixDesignResultCard

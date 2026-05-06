import React from 'react'
import { Card, Table, Descriptions, Button, Space, Divider, Typography, Collapse } from 'antd'
import { SaveOutlined, CaretDownOutlined } from '@ant-design/icons'

const { Text } = Typography
const { Panel } = Collapse

const OptimizationResultCard = ({ data, onSave }) => {
  const { strength, bestSolution, alternatives } = data

  const matColumns = [
    { title: '材料', dataIndex: 'name', key: 'name' },
    { title: '用量(kg/m³)', dataIndex: 'amount', key: 'amount', render: v => v?.toFixed(1) || '-' }
  ]

  const bestMatData = [
    { key: 'cement', name: '水泥', amount: bestSolution?.materials?.cement },
    ...(bestSolution?.materials?.flyAsh > 0 ? [{ key: 'flyAsh', name: '粉煤灰', amount: bestSolution.materials.flyAsh }] : []),
    ...(bestSolution?.materials?.slag > 0 ? [{ key: 'slag', name: '矿渣粉', amount: bestSolution.materials.slag }] : []),
    ...(bestSolution?.materials?.lithiumSlag > 0 ? [{ key: 'lithiumSlag', name: '锂渣', amount: bestSolution.materials.lithiumSlag }] : []),
    ...(bestSolution?.materials?.compositePowder > 0 ? [{ key: 'compositePowder', name: '复合粉', amount: bestSolution.materials.compositePowder }] : []),
    { key: 'sand', name: '细骨料', amount: bestSolution?.materials?.sand },
    { key: 'stone', name: '粗骨料', amount: bestSolution?.materials?.stone },
    ...(bestSolution?.materials?.superplasticizer > 0 ? [{ key: 'sp', name: '减水剂', amount: bestSolution.materials.superplasticizer }] : [])
  ]

  const altColumns = [
    { title: '方案', dataIndex: 'index', key: 'index', render: (_, __, idx) => `备选 ${idx + 1}` },
    { title: '成本(¥/m³)', dataIndex: 'totalCost', key: 'totalCost', render: v => v?.toFixed(2) },
    { title: '水胶比', dataIndex: 'waterRatio', key: 'waterRatio', render: v => v?.toFixed(4) },
    { title: '砂率', dataIndex: 'sandRatio', key: 'sandRatio', render: v => v ? `${(v * 100).toFixed(1)}%` : '-' }
  ]

  return (
    <Card
      size="small"
      title={<Space>🏆 <Text strong>{strength} 成本最优方案</Text></Space>}
      style={{ marginBottom: 8, maxWidth: 520 }}
    >
      <Text strong style={{ fontSize: 16, color: '#52c41a' }}>
        总成本: ¥{bestSolution?.totalCost?.toFixed(2) || '0.00'}/m³
      </Text>

      <Divider style={{ margin: '8px 0' }} />
      <Table columns={matColumns} dataSource={bestMatData} pagination={false} size="small" rowKey="key" style={{ marginBottom: 12 }} />

      <Descriptions column={2} size="small" bordered>
        <Descriptions.Item label="水胶比">{bestSolution?.waterRatio?.toFixed(4) || '-'}</Descriptions.Item>
        <Descriptions.Item label="砂率">{bestSolution?.sandRatio ? `${(bestSolution.sandRatio * 100).toFixed(1)}%` : '-'}</Descriptions.Item>
        <Descriptions.Item label="胶材成本">¥{bestSolution?.cementitiousCost?.toFixed(2) || '-'}</Descriptions.Item>
      </Descriptions>

      <Space style={{ marginTop: 12 }}>
        {onSave && (
          <Button type="link" icon={<SaveOutlined />} size="small" onClick={() => onSave(data)}>
            保存方案
          </Button>
        )}
      </Space>

      {alternatives && alternatives.length > 0 && (
        <Collapse ghost size="small" style={{ marginTop: 12 }} expandIcon={({ isActive }) => <CaretDownOutlined rotate={isActive ? 180 : 0} />}>
          <Panel header={`备选方案 (${alternatives.length}个)`} key="alts">
            <Table columns={altColumns} dataSource={alternatives} pagination={false} size="small" rowKey={(_, i) => `alt_${i}`} />
          </Panel>
        </Collapse>
      )}
    </Card>
  )
}

export default OptimizationResultCard

import React from 'react'
import { Card, Button, Tag, Typography, Row, Col } from 'antd'
import { RightOutlined } from '@ant-design/icons'

const { Text } = Typography

const TYPE_FIELDS = {
  '水泥': ['compressiveStrength28d', 'specificSurfaceArea'],
  '粉煤灰': ['activityIndex28d', 'waterDemandRatio', 'fineness'],
  '矿渣粉': ['activityIndex28d', 'fluidityRatio', 'specificSurfaceArea'],
  '锂渣': ['activityIndex28d', 'waterDemandRatio'],
  '复合粉': ['activityIndex28d', 'fluidityRatio'],
  '细骨料': ['finenessModulus', 'mudContent'],
  '粗骨料': ['specification'],
  '减水剂': ['waterReducingRate', 'recommendedDosage']
}

const FIELD_LABELS = {
  compressiveStrength28d: '28d强度',
  specificSurfaceArea: '比表面积',
  activityIndex28d: '28d活性',
  waterDemandRatio: '需水量比',
  fineness: '细度',
  fluidityRatio: '流动度比',
  finenessModulus: '细度模数',
  mudContent: '含泥量',
  specification: '规格',
  waterReducingRate: '减水率',
  recommendedDosage: '推荐掺量'
}

const formatValue = (field, value) => {
  if (value === undefined || value === null) return '-'
  if (field === 'compressiveStrength28d' || field === 'activityIndex28d') return `${value} MPa`
  if (field === 'specificSurfaceArea') return `${value} m²/kg`
  if (field === 'waterDemandRatio' || field === 'fluidityRatio') return `${value}%`
  if (field === 'waterReducingRate') return `${value}%`
  if (field === 'recommendedDosage') return `${value}%`
  return value
}

const MaterialPicker = ({ materials, onSelect }) => {
  if (!materials || materials.length === 0) return null

  const materialType = materials[0]?.type || ''
  const fields = TYPE_FIELDS[materialType] || []

  return (
    <Card size="small" title={`请选择${materialType}`} style={{ marginBottom: 8, maxWidth: 560 }}>
      <Row gutter={[12, 12]}>
        {materials.map(mat => (
          <Col span={12} key={mat.id}>
            <Card
              size="small"
              hoverable
              style={{ height: '100%' }}
              onClick={() => onSelect(mat)}
            >
              <Text strong>{mat.name}</Text>
              {mat.specification && <Tag style={{ marginLeft: 8 }}>{mat.specification}</Tag>}
              <div style={{ marginTop: 8 }}>
                {fields.map(f => {
                  const val = mat[f]
                  if (val === undefined || val === null) return null
                  return (
                    <div key={f}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{FIELD_LABELS[f] || f}: </Text>
                      <Text style={{ fontSize: 12 }}>{formatValue(f, val)}</Text>
                    </div>
                  )
                })}
                {mat.price != null && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>单价: </Text>
                    <Text style={{ fontSize: 12 }}>¥{mat.price}/吨</Text>
                  </div>
                )}
              </div>
              <Button type="link" size="small" style={{ padding: 0, marginTop: 8 }}>
                选择此材料 <RightOutlined />
              </Button>
            </Card>
          </Col>
        ))}
      </Row>
    </Card>
  )
}

export default MaterialPicker

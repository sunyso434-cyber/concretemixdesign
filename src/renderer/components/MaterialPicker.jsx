import React, { useState, useMemo } from 'react'
import { Card, Button, Checkbox, Tag, Typography } from 'antd'

const { Text } = Typography

const TYPE_FIELDS = {
  '水泥': ['compressiveStrength28d', 'specificSurfaceArea'],
  '粉煤灰': ['activityIndex28d', 'waterDemandRatio', 'fineness'],
  '矿渣粉': ['activityIndex28d', 'fluidityRatio', 'specificSurfaceArea'],
  '锂渣': ['activityIndex28d', 'waterDemandRatio'],
  '复合粉': ['activityIndex28d', 'fluidityRatio'],
  '细骨料': ['finenessModulus', 'mudContent'],
  '粗骨料': ['specification'],
  '减水剂': ['waterReducingRate', 'recommendedDosage'],
  '外加剂': ['waterReducingRate', 'recommendedDosage'],
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
  recommendedDosage: '推荐掺量',
}

const formatValue = (field, value) => {
  if (value === undefined || value === null) return '-'
  if (field === 'compressiveStrength28d' || field === 'activityIndex28d') return `${value}MPa`
  if (field === 'specificSurfaceArea') return `${value}m²/kg`
  if (field === 'waterDemandRatio' || field === 'fluidityRatio' || field === 'waterReducingRate' || field === 'recommendedDosage') return `${value}%`
  return value
}

const CATEGORY_GROUPS = [
  { key: 'cement', label: '水泥', types: ['水泥'] },
  { key: 'admixture', label: '掺合料', subtitle: '矿渣粉、粉煤灰、锂渣、复合粉', types: ['矿渣粉', '粉煤灰', '锂渣', '复合粉'] },
  { key: 'aggregate', label: '骨料', subtitle: '粗骨料、细骨料', types: ['粗骨料', '细骨料'] },
  { key: 'additive', label: '外加剂', subtitle: '减水剂', types: ['外加剂', '减水剂'] },
]

const MaterialPicker = ({ materials, onConfirm }) => {
  const [selected, setSelected] = useState([])

  const grouped = useMemo(() => {
    if (!materials || materials.length === 0) return []
    return CATEGORY_GROUPS
      .map(cat => {
        const items = materials.filter(m => cat.types.includes(m.type))
        return { ...cat, items }
      })
      .filter(cat => cat.items.length > 0)
  }, [materials])

  const allIds = useMemo(() => materials.map(m => m.id), [materials])
  const allSelected = allIds.length > 0 && selected.length === allIds.length

  const toggleAll = () => setSelected(allSelected ? [] : [...allIds])
  const toggleOne = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const handleConfirm = () => {
    const selectedMaterials = materials.filter(m => selected.includes(m.id))
    if (onConfirm) onConfirm(selectedMaterials)
  }

  if (!materials || materials.length === 0) return null

  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text strong>请选择材料（可多选）</Text>
        <Button size="small" onClick={toggleAll}>{allSelected ? '取消全选' : '全选'}</Button>
      </div>

      {grouped.map(group => (
        <div key={group.key} style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>
            <Text strong style={{ fontSize: 13 }}>[{group.label}]</Text>
            {group.subtitle && <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>{group.subtitle}</Text>}
          </div>
          {group.items.map(mat => {
            const fields = TYPE_FIELDS[mat.type] || []
            const isChecked = selected.includes(mat.id)
            return (
              <div
                key={mat.id}
                style={{
                  padding: '6px 0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
                onClick={() => toggleOne(mat.id)}
              >
                <Checkbox
                  checked={isChecked}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleOne(mat.id)}
                />
                <Text strong style={{ marginLeft: 8, minWidth: 120 }}>{mat.name}</Text>
                {mat.specification && <Tag style={{ marginLeft: 4 }}>{mat.specification}</Tag>}
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 12 }}>
                  {fields.map(f => {
                    const val = mat[f]
                    if (val === undefined || val === null) return null
                    return <span key={f} style={{ marginRight: 12 }}>{FIELD_LABELS[f] || f}: {formatValue(f, val)}</span>
                  })}
                </Text>
                {mat.price != null && (
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>¥{mat.price}/吨</Text>
                )}
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary">已选 {selected.length} / {allIds.length} 种材料</Text>
        <Button type="primary" size="small" disabled={selected.length === 0} onClick={handleConfirm}>确认选择</Button>
      </div>
    </Card>
  )
}

export default MaterialPicker

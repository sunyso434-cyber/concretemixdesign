import React, { useState, useEffect } from 'react'
import { Card, Form, Select, InputNumber, Button, Table, Space, Switch, Alert, Divider, message, List } from 'antd'

const BidirectionalInsulationPanel = ({
  materials = [],
  onCalculate,
  calculationResult,
  concreteParams = {}
}) => {
  const [topEnabled, setTopEnabled] = useState(true)
  const [sideEnabled, setSideEnabled] = useState(true)
  const [topLayers, setTopLayers] = useState([{ material_id: null, thickness: 50 }])
  const [sideLayers, setSideLayers] = useState([{ material_id: null, thickness: 50 }])
  const [loading, setLoading] = useState(false)
  const [boundaryConditions, setBoundaryConditions] = useState({
    top: { windSpeed: 0, surfaceRoughness: 'smooth', insulationType: 'normal' },
    side: { windSpeed: 0, surfaceRoughness: 'smooth', insulationType: 'normal' },
    bottom: { type: 'basement' }
  })

  // 材料选项（扁平化）
  const materialOptions = materials.map(m => ({
    value: m.id,
    label: `${m.name} (λ=${m.thermalConductivity})`
  }))

  const handleAddLayer = (position) => {
    const newLayer = { material_id: null, thickness: 50 }
    if (position === 'top') {
      setTopLayers([...topLayers, newLayer])
    } else {
      setSideLayers([...sideLayers, newLayer])
    }
  }

  const handleRemoveLayer = (position, index) => {
    if (position === 'top') {
      if (topLayers.length > 1) {
        setTopLayers(topLayers.filter((_, i) => i !== index))
      }
    } else {
      if (sideLayers.length > 1) {
        setSideLayers(sideLayers.filter((_, i) => i !== index))
      }
    }
  }

  const handleUpdateLayer = (position, index, field, value) => {
    if (position === 'top') {
      const newLayers = [...topLayers]
      newLayers[index][field] = value
      setTopLayers(newLayers)
    } else {
      const newLayers = [...sideLayers]
      newLayers[index][field] = value
      setSideLayers(newLayers)
    }
  }

  const handleCalculate = async () => {
    // 验证
    if (topEnabled && topLayers.some(l => !l.material_id)) {
      message.warning('请为顶面保温层选择材料')
      return
    }
    if (sideEnabled && sideLayers.some(l => !l.material_id)) {
      message.warning('请为侧面保温层选择材料')
      return
    }

    setLoading(true)
    try {
      await onCalculate?.({
        concreteThickness: concreteParams.thickness || 2,
        concreteLength: concreteParams.length || 50,
        concreteWidth: concreteParams.width || 20,
        topInsulation: topEnabled ? { enabled: true, layers: topLayers } : null,
        sideInsulation: sideEnabled ? { enabled: true, layers: sideLayers } : null,
        boundaryConditions,
        targetTempDiff: concreteParams.targetTempDiff || 25,
        maxAdiabaticTemp: concreteParams.maxAdiabaticTemp || 55
      })
    } finally {
      setLoading(false)
    }
  }

  const topColumns = [
    {
      title: '材料',
      dataIndex: 'material_id',
      key: 'material_id',
      width: 200,
      render: (val, _, index) => (
        <Select
          value={val}
          onChange={(v) => handleUpdateLayer('top', index, 'material_id', v)}
          options={materialOptions}
          placeholder="选择材料"
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '厚度(mm)',
      dataIndex: 'thickness',
      key: 'thickness',
      width: 120,
      render: (val, _, index) => (
        <InputNumber
          value={val}
          onChange={(v) => handleUpdateLayer('top', index, 'thickness', v)}
          min={5}
          max={500}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, __, index) => (
        <Button
          type="link"
          danger
          size="small"
          onClick={() => handleRemoveLayer('top', index)}
          disabled={topLayers.length <= 1}
        >
          删除
        </Button>
      )
    }
  ]

  const sideColumns = [
    {
      title: '材料',
      dataIndex: 'material_id',
      key: 'material_id',
      width: 200,
      render: (val, _, index) => (
        <Select
          value={val}
          onChange={(v) => handleUpdateLayer('side', index, 'material_id', v)}
          options={materialOptions}
          placeholder="选择材料"
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '厚度(mm)',
      dataIndex: 'thickness',
      key: 'thickness',
      width: 120,
      render: (val, _, index) => (
        <InputNumber
          value={val}
          onChange={(v) => handleUpdateLayer('side', index, 'thickness', v)}
          min={5}
          max={500}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, __, index) => (
        <Button
          type="link"
          danger
          size="small"
          onClick={() => handleRemoveLayer('side', index)}
          disabled={sideLayers.length <= 1}
        >
          删除
        </Button>
      )
    }
  ]

  const BoundaryConditionForm = ({ position, config, onChange }) => (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Space wrap>
        <Form.Item label="风速" style={{ marginBottom: 8 }}>
          <InputNumber
            value={config.windSpeed}
            onChange={(v) => onChange({ ...config, windSpeed: v })}
            min={0}
            max={10}
            step={0.5}
            addonAfter="m/s"
            style={{ width: 120 }}
          />
        </Form.Item>
        <Form.Item label="表面粗糙度" style={{ marginBottom: 8 }}>
          <Select
            value={config.surfaceRoughness}
            onChange={(v) => onChange({ ...config, surfaceRoughness: v })}
            options={[
              { value: 'verySmooth', label: '光滑' },
              { value: 'smooth', label: '平整' },
              { value: 'rough', label: '粗糙' }
            ]}
            style={{ width: 100 }}
          />
        </Form.Item>
        <Form.Item label="保温类型" style={{ marginBottom: 8 }}>
          <Select
            value={config.insulationType}
            onChange={(v) => onChange({ ...config, insulationType: v })}
            options={[
              { value: 'normal', label: '普通' },
              { value: 'windproof', label: '防风' }
            ]}
            style={{ width: 100 }}
          />
        </Form.Item>
      </Space>
    </Space>
  )

  return (
    <Card title="双向保温计算" size="small" style={{ marginTop: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 顶面保温 */}
        <Card
          type="inner"
          title={
            <Space>
              <span>顶面保温</span>
              <Switch checked={topEnabled} onChange={setTopEnabled} size="small" />
            </Space>
          }
          size="small"
        >
          {topEnabled && (
            <>
              <Divider style={{ margin: '12px 0' }}>边界条件</Divider>
              <BoundaryConditionForm
                position="top"
                config={boundaryConditions.top}
                onChange={(v) => setBoundaryConditions({ ...boundaryConditions, top: v })}
              />
              <Divider style={{ margin: '12px 0' }}>保温层配置</Divider>
              <Space style={{ marginBottom: 8 }}>
                <Button size="small" onClick={() => handleAddLayer('top')}>+ 添加保温层</Button>
              </Space>
              <Table
                dataSource={topLayers}
                columns={topColumns}
                rowKey={(_, index) => index}
                pagination={false}
                size="small"
              />
            </>
          )}
        </Card>

        {/* 侧面保温 */}
        <Card
          type="inner"
          title={
            <Space>
              <span>侧面保温</span>
              <Switch checked={sideEnabled} onChange={setSideEnabled} size="small" />
            </Space>
          }
          size="small"
        >
          {sideEnabled && (
            <>
              <Divider style={{ margin: '12px 0' }}>边界条件</Divider>
              <BoundaryConditionForm
                position="side"
                config={boundaryConditions.side}
                onChange={(v) => setBoundaryConditions({ ...boundaryConditions, side: v })}
              />
              <Divider style={{ margin: '12px 0' }}>保温层配置</Divider>
              <Space style={{ marginBottom: 8 }}>
                <Button size="small" onClick={() => handleAddLayer('side')}>+ 添加保温层</Button>
              </Space>
              <Table
                dataSource={sideLayers}
                columns={sideColumns}
                rowKey={(_, index) => index}
                pagination={false}
                size="small"
              />
            </>
          )}
        </Card>

        {/* 底面边界 */}
        <Card type="inner" title="底面边界条件" size="small">
          <Form.Item label="底面类型" style={{ marginBottom: 8 }}>
            <Select
              value={boundaryConditions.bottom.type}
              onChange={(v) => setBoundaryConditions({ ...boundaryConditions, bottom: { type: v } })}
              options={[
                { value: 'basement', label: '地下室/基础' },
                { value: 'exposed', label: '露天底板' },
                { value: 'heated', label: '加热底板' }
              ]}
              style={{ width: 150 }}
            />
          </Form.Item>
        </Card>

        {/* 计算按钮 */}
        <Button
          type="primary"
          onClick={handleCalculate}
          loading={loading}
          disabled={!topEnabled && !sideEnabled}
        >
          计算双向保温
        </Button>

        {/* 结果显示 */}
        {calculationResult && (
          <Card type="inner" title="计算结果" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              {calculationResult.top && (
                <Alert
                  type={calculationResult.top.meetsRequirement ? 'success' : 'warning'}
                  message={
                    <Space>
                      <span>顶面温差:</span>
                      <strong>{calculationResult.top.tempDiff} °C</strong>
                      <span>({calculationResult.top.meetsRequirement ? '满足要求' : '不满足要求'})</span>
                    </Space>
                  }
                />
              )}
              {calculationResult.side && (
                <Alert
                  type={calculationResult.side.meetsRequirement ? 'success' : 'warning'}
                  message={
                    <Space>
                      <span>侧面温差:</span>
                      <strong>{calculationResult.side.tempDiff} °C</strong>
                      <span>({calculationResult.side.meetsRequirement ? '满足要求' : '不满足要求'})</span>
                    </Space>
                  }
                />
              )}
              <Alert
                type={calculationResult.meetsRequirement ? 'success' : 'error'}
                message={
                  <Space>
                    <span>最大温差:</span>
                    <strong>{calculationResult.maxTempDiff} °C</strong>
                    <span>({calculationResult.meetsRequirement ? '满足要求' : '超过目标温差'})</span>
                  </Space>
                }
              />
              {calculationResult.recommendations?.length > 0 && (
                <List
                  header={<span style={{ fontWeight: 'bold' }}>建议</span>}
                  dataSource={calculationResult.recommendations}
                  renderItem={item => <List.Item style={{ padding: '4px 0' }}>{item}</List.Item>}
                />
              )}
            </Space>
          </Card>
        )}
      </Space>
    </Card>
  )
}

export default BidirectionalInsulationPanel
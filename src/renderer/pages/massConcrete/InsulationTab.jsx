// src/renderer/pages/massConcrete/InsulationTab.jsx
import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, InputNumber, message, Table } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setInsulationData, setInsulationMaterials } from '../../../store/massConcreteSlice'
import InsulationProfileChart from '../../components/charts/InsulationProfileChart'

const { Option } = Select

/**
 * 保温养护计算标签页组件
 * 用于计算大体积混凝土的保温层设计和温度控制
 * @param {Function} onCalculate - 计算完成后的回调函数
 */
const InsulationTab = ({ onCalculate }) => {
  const dispatch = useDispatch()
  const insulationData = useSelector(state => state.massConcrete.insulationData)
  const insulationMaterials = useSelector(state => state.massConcrete.insulationMaterials)
  const stressData = useSelector(state => state.massConcrete.stressData)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [selectedMaterials, setSelectedMaterials] = useState([])

  // 加载保温材料列表
  useEffect(() => {
    const loadInsulationMaterials = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('mc_getAllInsulationMaterials')
        if (result.success) {
          dispatch(setInsulationMaterials(result.data))
        }
      } catch (error) {
        console.error('加载保温材料失败:', error)
      }
    }
    loadInsulationMaterials()
  }, [dispatch])

  // 处理保温材料选择变化
  const handleMaterialChange = (values) => {
    setSelectedMaterials(values)
  }

  // 计算保温方案
  const calculateInsulation = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      // 获取选中的保温材料详情
      const selectedMaterialDetails = selectedMaterials.map(id =>
        insulationMaterials.find(m => m.id === id)
      ).filter(Boolean)

      const params = {
        insulationThickness: values.insulationThickness || 0.05,
        insulationMaterial: selectedMaterialDetails[0] || { name: '帆布', thermalConductivity: 0.05 },
        surfaceTempDiff: values.surfaceTempDiff || 15,
        tempRiseData: stressData?.tempRiseData || {}
      }

      const result = await window.electron.ipcRenderer.invoke('mc_calculateInsulation', params)

      if (result.success) {
        dispatch(setInsulationData(result.data))
        message.success('保温计算成功')
        onCalculate?.()
      } else {
        message.error(result.error || '计算失败')
      }
    } catch (error) {
      console.error('计算失败:', error)
      message.error(error.message || '计算失败')
    } finally {
      setLoading(false)
    }
  }

  // 保温材料列定义
  const materialColumns = [
    {
      title: '材料名称',
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: '导热系数 (W/m·K)',
      dataIndex: 'thermalConductivity',
      key: 'thermalConductivity'
    },
    {
      title: '厚度 (m)',
      dataIndex: 'defaultThickness',
      key: 'defaultThickness'
    }
  ]

  // 格式化图表数据
  const getInsulationLayersData = () => {
    if (!insulationData?.insulationLayers) return []
    return insulationData.insulationLayers.map(layer => ({
      thickness: layer.thickness,
      name: layer.name
    }))
  }

  return (
    <div>
      <Card className="custom-card" title="保温参数设置">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            insulationThickness: 0.05,
            surfaceTempDiff: 15
          }}
        >
          <div className="grid-2-col">
            <Form.Item
              name="insulationThickness"
              label="保温层厚度 (m)"
              rules={[{ required: true, message: '请输入保温层厚度' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 0.05"
                min={0.01}
                max={1}
                precision={3}
              />
            </Form.Item>

            <Form.Item
              name="surfaceTempDiff"
              label="表面允许温差 (°C)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 15"
                min={5}
                max={30}
                precision={1}
              />
            </Form.Item>
          </div>

          <Form.Item
            name="insulationMaterial"
            label="保温材料"
          >
            <Select
              mode="multiple"
              placeholder="请选择保温材料"
              style={{ width: '100%' }}
              onChange={handleMaterialChange}
            >
              {insulationMaterials.map(material => (
                <Option key={material.id} value={material.id}>
                  {material.name} (λ={material.thermalConductivity} W/m·K)
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>

        <div style={{ marginTop: 24 }}>
          <Button
            type="primary"
            className="custom-btn"
            onClick={calculateInsulation}
            loading={loading}
          >
            计算保温方案
          </Button>
        </div>
      </Card>

      {/* 保温材料列表 */}
      {insulationMaterials.length > 0 && (
        <Card className="custom-card" title="可选保温材料" style={{ marginTop: 16 }}>
          <Table
            dataSource={insulationMaterials}
            columns={materialColumns}
            pagination={false}
            rowKey="id"
            size="small"
          />
        </Card>
      )}

      {/* 计算结果图表展示 */}
      {insulationData && (
        <>
          <Card className="custom-card" title="保温曲线" style={{ marginTop: 16 }}>
            <InsulationProfileChart
              insulationLayers={getInsulationLayersData()}
              virtualThickness={insulationData.virtualThickness || 0}
              surfaceTempDiff={insulationData.surfaceTempDiff || 0}
              meetsRequirement={insulationData.meetsRequirement || false}
              title="保温方案对比"
            />
          </Card>

          <Card className="custom-card" title="保温计算结果" style={{ marginTop: 16 }}>
            <div className="grid-2-col">
              <div>
                <h4>保温参数</h4>
                <ul>
                  <li>虚拟厚度: {insulationData.virtualThickness ? insulationData.virtualThickness.toFixed(3) : '-'} m</li>
                  <li>表面散热系数: {insulationData.surfaceHeatTransferCoefficient ? insulationData.surfaceHeatTransferCoefficient.toFixed(2) : '-'} W/(m²·K)</li>
                  <li>表面温差: {insulationData.surfaceTempDiff ? insulationData.surfaceTempDiff.toFixed(1) : '-'} °C</li>
                </ul>
              </div>
              <div>
                <h4>评估结果</h4>
                <ul>
                  <li>是否满足要求: {insulationData.meetsRequirement ? '是' : '否'}</li>
                  <li>推荐保温层数: {insulationData.recommendedLayers || '-'}</li>
                  <li>保温效果评级: {insulationData.insulationRating || '-'}</li>
                </ul>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

export default InsulationTab
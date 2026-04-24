// src/renderer/pages/massConcrete/InsulationTab.jsx
import React, { useState, useEffect } from 'react'
import { Card, Form, Select, Button, InputNumber, message, Table, Tabs, Alert, Divider, Tag } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setInsulationData, setInsulationMaterials } from '../../../store/massConcreteSlice'
import InsulationProfileChart from '../../components/charts/InsulationProfileChart'
import BidirectionalInsulationPanel from './BidirectionalInsulationPanel'
import WeatherAlertPanel from './WeatherAlertPanel'

const { Option } = Select
const { TabPane } = Tabs

/**
 * 保温养护计算标签页组件
 * 用于计算大体积混凝土的保温层设计和温度控制
 * @param {Function} onCalculate - 计算完成后的回调函数
 * @param {Function} onNavigate - 导航到指定标签页的回调函数
 */
const InsulationTab = ({ onCalculate, onNavigate }) => {
  const dispatch = useDispatch()
  const adiabaticTempData = useSelector(state => state.massConcrete.adiabaticTempData)
  const insulationData = useSelector(state => state.massConcrete.insulationData)
  const insulationMaterials = useSelector(state => state.massConcrete.insulationMaterials)
  const stressData = useSelector(state => state.massConcrete.stressData)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [selectedMaterials, setSelectedMaterials] = useState([])
  const [activeTab, setActiveTab] = useState('traditional')
  const [bidirectionalResult, setBidirectionalResult] = useState(null)

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

  // 获取风险等级对应的颜色
  const getRiskColor = (level) => {
    const colorMap = {
      'low': 'green',
      'medium': 'orange',
      'high': 'red',
      'extreme': 'red'
    }
    return colorMap[level] || 'default'
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
        // === 新增参数 ===
        windSpeed: values.windSpeed || 3.0,
        surfaceRoughness: values.surfaceRoughness || 'smooth',
        insulationType: values.insulationType || 'windproof',
        targetTempDiff: values.targetTempDiff || 25,

        // === 保温材料配置 ===
        insulationThickness: values.insulationThickness || 0.05,
        insulationLayers: selectedMaterialDetails.map(m => ({
          material_id: m.id,
          materialName: m.name,
          thickness: (values.insulationThickness || 0.05) * 1000,  // m → mm
          thermalConductivity: m.thermalConductivity
        })),

        // === 从上游继承 ===
        concreteThickness: adiabaticTempData?.concreteThickness || 2.0,
        maxAdiabaticTemp: adiabaticTempData?.maxAdiabaticTemp || 50
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
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="单向保温计算" key="traditional">
          <Card className="custom-card" title="保温参数设置">
            <Alert
              message="参数说明"
              description={
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>温升数据和应力数据已从上游自动继承，只需设置保温施工参数</li>
                  <li>风速和表面粗糙度影响保温层表面散热系数计算</li>
                </ul>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />

            {/* 上游数据只读显示 */}
            <Card size="small" style={{ marginBottom: 16, background: '#f5f5f5' }}>
              <div className="grid-2-col">
                <div>
                  <span style={{ color: '#666' }}>强度等级：</span>
                  <span style={{ fontWeight: 500 }}>{adiabaticTempData?.strengthGrade || '-'}</span>
                </div>
                <div>
                  <span style={{ color: '#666' }}>最大绝热温升：</span>
                  <span style={{ fontWeight: 500 }}>{adiabaticTempData?.maxAdiabaticTemp?.toFixed(1) || '-'} °C</span>
                </div>
                <div>
                  <span style={{ color: '#666' }}>构件厚度：</span>
                  <span style={{ fontWeight: 500 }}>{adiabaticTempData?.concreteThickness || '-'} m</span>
                </div>
                <div>
                  <span style={{ color: '#666' }}>裂缝风险：</span>
                  <Tag color={getRiskColor(stressData?.crackRiskLevel)}>
                    {stressData?.crackRiskLevel || '-'}
                  </Tag>
                </div>
              </div>
            </Card>

            <Form
              form={form}
              layout="vertical"
              initialValues={{
                windSpeed: 3.0,
                surfaceRoughness: 'smooth',
                insulationType: 'windproof',
                targetTempDiff: 25,
                insulationThickness: 0.05
              }}
            >
              <Divider>施工参数</Divider>

              <div className="grid-2-col">
                <Form.Item
                  name="windSpeed"
                  label="风速 (m/s)"
                  extra="范围: 0~20 m/s"
                  rules={[
                    { required: true, message: '请输入风速' },
                    { type: 'number', min: 0, max: 20, message: '风速应在 0~20 m/s 之间' }
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    max={20}
                    precision={1}
                    placeholder="如 3.0"
                  />
                </Form.Item>

                <Form.Item
                  name="surfaceRoughness"
                  label="混凝土表面粗糙度"
                  rules={[{ required: true, message: '请选择表面粗糙度' }]}
                >
                  <Select placeholder="请选择表面粗糙度">
                    <Option value="verySmooth">非常光滑（木模/钢模）</Option>
                    <Option value="smooth">光滑（竹胶板）</Option>
                    <Option value="rough">粗糙（砖模/土模）</Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  name="insulationType"
                  label="保温类型"
                  rules={[{ required: true, message: '请选择保温类型' }]}
                >
                  <Select placeholder="请选择保温类型">
                    <Option value="windproof">防风保温</Option>
                    <Option value="normal">普通保温</Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  name="targetTempDiff"
                  label="目标表面温差 (°C)"
                  extra="范围: 10~40°C，规范要求 ≤ 25°C"
                  rules={[
                    { required: true, message: '请输入目标温差' },
                    { type: 'number', min: 10, max: 40, message: '目标温差应在 10~40°C 之间' }
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={10}
                    max={40}
                    precision={1}
                    placeholder="如 25"
                  />
                </Form.Item>
              </div>

              <Divider>保温材料配置</Divider>

              <div className="grid-2-col">
                <Form.Item
                  name="insulationThickness"
                  label="保温层厚度 (m)"
                  extra="范围: 0.001~1 m（1~1000 mm）"
                  rules={[
                    { required: true, message: '请输入保温层厚度' },
                    { type: 'number', min: 0.001, max: 1, message: '保温层厚度应在 0.001~1 m 之间' }
                  ]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    placeholder="如 0.05"
                    min={0.001}
                    max={1}
                    precision={3}
                  />
                </Form.Item>

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
              </div>
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
        </TabPane>

        <TabPane tab="双向保温计算" key="bidirectional">
          <BidirectionalInsulationPanel
            materials={insulationMaterials}
            onCalculate={async (params) => {
              try {
                const result = await window.electron.ipcRenderer.invoke('mc_calculateBidirectionalInsulation', params)
                if (result.success) {
                  setBidirectionalResult(result.data)
                  message.success('双向保温计算成功')
                } else {
                  message.error(result.error || '计算失败')
                }
              } catch (error) {
                message.error(error.message || '计算失败')
              }
            }}
            calculationResult={bidirectionalResult}
            concreteParams={{
              thickness: 2,
              length: 50,
              width: 20,
              targetTempDiff: 25,
              maxAdiabaticTemp: stressData?.maxAdiabaticTemp || 55
            }}
          />
        </TabPane>

        <TabPane tab="气象影响评估" key="weather">
          <WeatherAlertPanel
            onEvaluate={(result) => {
              console.log('气象评估结果:', result)
            }}
          />
        </TabPane>
      </Tabs>
    </div>
  )
}

export default InsulationTab
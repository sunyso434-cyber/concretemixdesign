// src/renderer/pages/massConcrete/MixDesignTab.jsx
import React, { useState, useEffect } from 'react'
import { Card, Form, Select, Button, InputNumber, message, Divider } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setMixDesignData } from '../../../store/massConcreteSlice'

const { Option } = Select

/**
 * 大体积混凝土配合比设计标签页
 * 直接复用通用配合比设计（MixDesignPage）的完整表单结构和计算逻辑
 * 后端自动叠加 GB 50496-2018 大体积混凝土限值检查
 */
const MixDesignTab = ({ onCalculate }) => {
  const dispatch = useDispatch()
  const mixDesignData = useSelector(state => state.massConcrete.mixDesignData)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [materials, setMaterials] = useState([])

  // 监听计算方法变化
  const watchedCalculationMethod = Form.useWatch ? Form.useWatch('calculationMethod', form) : null

  // 计算方法切换时自动设置对应参数
  const handleCalculationMethodChange = (value) => {
    if (value === 'mass') {
      form.setFieldsValue({ targetDensity: 2400 })
    } else {
      form.setFieldsValue({ airContent: 1.5 })
    }
  }

  // 强度等级选项
  const strengthOptions = ['C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50']

  // 计算方法选项
  const calculationMethodOptions = [
    { value: 'absolute', label: '绝对体积法' },
    { value: 'mass', label: '质量法' }
  ]

  // 材料类型映射
  const materialTypes = {
    cement: '水泥',
    flyAsh: '粉煤灰',
    slag: '矿渣粉',
    sand: '细骨料',
    stone: '粗骨料',
    superplasticizer: '外加剂'
  }

  // 加载原材料列表
  useEffect(() => {
    const loadMaterials = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('getAllMaterials')
        if (result.success) {
          setMaterials(result.data)
        }
      } catch (error) {
        console.error('加载原材料失败:', error)
      }
    }
    loadMaterials()
  }, [])

  // 根据类型获取原材料
  const getMaterialsByType = (type) => {
    if (type === 'superplasticizer') {
      return materials.filter(m => m.type === '减水剂' || m.type === '外加剂')
    }
    return materials.filter(m => m.type === materialTypes[type])
  }

  // 计算配合比
  const calculateMixDesign = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      // 重新加载材料列表
      const latestMaterials = await window.electron.ipcRenderer.invoke('getAllMaterials')
      if (!latestMaterials.success) {
        throw new Error('获取材料列表失败')
      }

      // 构建材料对象（与通用配合比设计保持一致）
      const materialsObj = {
        cement: latestMaterials.data.find(m => m.id === values.cement),
        flyAsh: latestMaterials.data.find(m => m.id === values.flyAsh),
        slag: latestMaterials.data.find(m => m.id === values.slag),
        sand: Array.isArray(values.sand)
          ? latestMaterials.data.filter(m => values.sand.some(sid => String(sid) === String(m.id)))
          : latestMaterials.data.find(m => m.id === values.sand),
        stone: Array.isArray(values.stone)
          ? latestMaterials.data.filter(m => values.stone.some(sid => String(sid) === String(m.id)))
          : latestMaterials.data.find(m => m.id === values.stone),
        superplasticizer: latestMaterials.data.find(m => m.id === values.superplasticizer)
      }

      // 参数与通用配合比设计保持一致（不传水胶比，由通用计算根据强度自动计算）
      const params = {
        ...values,
        materials: materialsObj
      }

      // 调用大体积混凝土配合比计算（后端会自动调用通用计算并叠加限值）
      const result = await window.electron.ipcRenderer.invoke('mc_calculateMixDesign', params)

      if (result.success) {
        dispatch(setMixDesignData(result.data))
        message.success('配合比计算成功')
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

  // 材料名称和数值（两行布局）
  const materialItems = mixDesignData ? [
    { name: '水泥', value: (mixDesignData.materials?.cement || 0).toFixed(0) },
    { name: '粉煤灰', value: (mixDesignData.materials?.flyAsh || 0).toFixed(0) },
    { name: '矿渣粉', value: (mixDesignData.materials?.slag || 0).toFixed(0) },
    { name: '细骨料', value: (mixDesignData.materials?.sand || 0).toFixed(0) },
    { name: '粗骨料', value: (mixDesignData.materials?.stone || 0).toFixed(0) },
    { name: '水', value: (mixDesignData.materials?.water || 0).toFixed(0) },
    { name: '外加剂', value: ((mixDesignData.materials?.superplasticizer || 0)).toFixed(2) }
  ] : []

  // 多种细骨料详细列表
  const fineAggregateDetails = mixDesignData?.fineAggregateBreakdown?.length > 0
    ? mixDesignData.fineAggregateBreakdown.map(item => ({
        name: item.name || `砂${item.id}`,
        value: (item.amount || 0).toFixed(0)
      }))
    : []

  // 配合比参数（两行布局）
  const paramItems = mixDesignData ? [
    { name: '水胶比', value: (mixDesignData.waterRatio || 0).toFixed(2) },
    { name: '砂率', value: ((mixDesignData.sandRatio || 0) * 100).toFixed(1) + '%' },
    { name: '容重 (kg/m³)', value: (mixDesignData.density || 0).toFixed(0) }
  ] : []

  return (
    <div>
      <Card className="custom-card" title="配合比设计">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            calculationMethod: 'absolute',
            airContent: 1.5,
            targetDensity: 2400,
            slump: 160,
            flyAshDosage: 20,
            slagDosage: 10,
            sandRatio: 35
          }}
        >
          {/* 基本参数 */}
          <div className="grid-2-col">
            <Form.Item
              name="strength"
              label="强度等级"
              rules={[{ required: true, message: '请选择强度等级' }]}
            >
              <Select placeholder="请选择强度等级" style={{ width: '100%' }}>
                {strengthOptions.map(strength => (
                  <Option key={strength} value={strength}>{strength}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="calculationMethod"
              label="计算方法"
            >
              <Select
                placeholder="请选择计算方法"
                style={{ width: '100%' }}
                onChange={handleCalculationMethodChange}
              >
                {calculationMethodOptions.map(opt => (
                  <Option key={opt.value} value={opt.value}>{opt.label}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="slump"
              label="坍落度 (mm)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 160"
                min={30}
                max={220}
                precision={0}
              />
            </Form.Item>

            {watchedCalculationMethod === 'mass' && (
              <Form.Item
                name="targetDensity"
                label="容重 (kg/m³)"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="如 2400"
                  min={2000}
                  max={2800}
                  precision={0}
                />
              </Form.Item>
            )}

            {watchedCalculationMethod === 'absolute' && (
              <Form.Item
                name="airContent"
                label="含气量 (%)"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="如 1.5"
                  min={0}
                  max={10}
                  precision={1}
                />
              </Form.Item>
            )}
          </div>

          <Divider>材料选择</Divider>

          {/* 材料选择 */}
          <div className="grid-2-col">
            <Form.Item
              name="cement"
              label="水泥"
              rules={[{ required: true, message: '请选择水泥' }]}
            >
              <Select placeholder="请选择水泥" style={{ width: '100%' }}>
                {getMaterialsByType('cement').map(material => (
                  <Option key={material.id} value={material.id}>{material.name}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="flyAsh"
              label="粉煤灰"
            >
              <Select placeholder="请选择粉煤灰" style={{ width: '100%' }} allowClear>
                {getMaterialsByType('flyAsh').map(material => (
                  <Option key={material.id} value={material.id}>{material.name}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="slag"
              label="矿渣粉"
            >
              <Select placeholder="请选择矿渣粉" style={{ width: '100%' }} allowClear>
                {getMaterialsByType('slag').map(material => (
                  <Option key={material.id} value={material.id}>{material.name}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="sand"
              label="细骨料"
              rules={[{ required: true, message: '请选择细骨料' }]}
            >
              <Select placeholder="请选择细骨料" style={{ width: '100%' }} mode="multiple">
                {getMaterialsByType('sand').map(material => (
                  <Option key={material.id} value={material.id}>{material.name}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="stone"
              label="粗骨料"
              rules={[{ required: true, message: '请选择粗骨料' }]}
            >
              <Select placeholder="请选择粗骨料" style={{ width: '100%' }}>
                {getMaterialsByType('stone').map(material => (
                  <Option key={material.id} value={material.id}>{material.name}</Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name="superplasticizer"
              label="外加剂"
            >
              <Select placeholder="请选择外加剂" style={{ width: '100%' }} allowClear>
                {getMaterialsByType('superplasticizer').map(material => (
                  <Option key={material.id} value={material.id}>{material.name}</Option>
                ))}
              </Select>
            </Form.Item>
          </div>

          <Divider>配合比参数</Divider>

          {/* 配合比参数 */}
          <div className="grid-2-col">
            <Form.Item
              name="flyAshDosage"
              label="粉煤灰掺量 (%)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 20"
                min={0}
                max={50}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="slagDosage"
              label="矿渣粉掺量 (%)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 10"
                min={0}
                max={60}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="sandRatio"
              label="砂率 (%)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 35"
                min={30}
                max={50}
                precision={1}
              />
            </Form.Item>
          </div>
        </Form>

        <div style={{ marginTop: 24 }}>
          <Button
            type="primary"
            className="custom-btn"
            onClick={calculateMixDesign}
            loading={loading}
          >
            计算配合比
          </Button>
        </div>
      </Card>

      {/* 计算结果展示 - 两行布局：第一行材料名称，第二行单方质量 */}
      {mixDesignData && (
        <Card className="custom-card" title="配合比计算结果" style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  {materialItems.map(item => (
                    <td key={item.name} style={{ padding: '8px', textAlign: 'center', border: '1px solid #d9d9d9', fontWeight: 'bold' }}>{item.name}</td>
                  ))}
                </tr>
                <tr>
                  {materialItems.map(item => (
                    <td key={item.name} style={{ padding: '8px', textAlign: 'center', border: '1px solid #d9d9d9' }}>{item.value}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* 多种细骨料详细展示 */}
          {fineAggregateDetails.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Divider orientation="left" plain style={{ margin: '8px 0' }}>细骨料详情</Divider>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    {fineAggregateDetails.map(item => (
                      <td key={item.name} style={{ padding: '8px', textAlign: 'center', border: '1px solid #d9d9d9', fontWeight: 'bold' }}>{item.name}</td>
                    ))}
                  </tr>
                  <tr>
                    {fineAggregateDetails.map(item => (
                      <td key={item.name} style={{ padding: '8px', textAlign: 'center', border: '1px solid #d9d9d9' }}>{item.value}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                {paramItems.map(item => (
                  <td key={item.name} style={{ padding: '8px', textAlign: 'center', border: '1px solid #d9d9d9', fontWeight: 'bold' }}>{item.name}</td>
                ))}
              </tr>
              <tr>
                {paramItems.map(item => (
                  <td key={item.name} style={{ padding: '8px', textAlign: 'center', border: '1px solid #d9d9d9' }}>{item.value}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

export default MixDesignTab
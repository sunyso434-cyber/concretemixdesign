// src/renderer/pages/massConcrete/MixDesignTab.jsx
import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, InputNumber, message } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setMixDesignData } from '../../../store/massConcreteSlice'

const { Option } = Select

/**
 * 配合比设计标签页组件
 * 用于大体积混凝土的配合比设计输入
 * @param {Function} onCalculate - 计算完成后的回调函数
 */
const MixDesignTab = ({ onCalculate }) => {
  const dispatch = useDispatch()
  const mixDesignData = useSelector(state => state.massConcrete.mixDesignData)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [materials, setMaterials] = useState([])

  // 强度等级选项
  const strengthOptions = ['C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50']

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

      // 构建材料对象
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

      const params = {
        ...values,
        materials: materialsObj
      }

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

  return (
    <div>
      <Card className="custom-card" title="配合比设计参数">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            calculationMethod: 'absolute',
            airContent: 1.5,
            flyAshDosage: 20,
            slagDosage: 10,
            sandRatio: 35
          }}
        >
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
              name="cementConsumption"
              label="水泥用量 (kg/m³)"
              rules={[{ required: true, message: '请输入水泥用量' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 240"
                min={150}
                max={500}
                precision={0}
              />
            </Form.Item>

            <Form.Item
              name="flyAshDosage"
              label="粉煤灰掺量 (%)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="请输入粉煤灰掺量"
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
                placeholder="请输入矿渣粉掺量"
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
                placeholder="请输入砂率"
                min={30}
                max={50}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="waterRatio"
              label="水胶比"
              rules={[{ required: true, message: '请输入水胶比' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 0.45"
                min={0.3}
                max={0.7}
                precision={2}
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

      {/* 计算结果展示 */}
      {mixDesignData && (
        <Card className="custom-card" title="配合比计算结果" style={{ marginTop: 16 }}>
          <div className="grid-2-col">
            <div>
              <h4>材料用量 (kg/m³)</h4>
              <ul>
                <li>水泥: {mixDesignData.materials?.cement || '-'}</li>
                <li>粉煤灰: {mixDesignData.materials?.flyAsh || '-'}</li>
                <li>矿渣粉: {mixDesignData.materials?.slag || '-'}</li>
                <li>细骨料: {mixDesignData.materials?.sand || '-'}</li>
                <li>粗骨料: {mixDesignData.materials?.stone || '-'}</li>
                <li>水: {mixDesignData.materials?.water || '-'}</li>
                <li>减水剂: {mixDesignData.materials?.superplasticizer || '-'}</li>
              </ul>
            </div>
            <div>
              <h4>配合比参数</h4>
              <ul>
                <li>水胶比: {mixDesignData.waterRatio || '-'}</li>
                <li>砂率: {mixDesignData.sandRatio ? (mixDesignData.sandRatio * 100).toFixed(1) + '%' : '-'}</li>
                <li>容重: {mixDesignData.density || '-'} kg/m³</li>
              </ul>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

export default MixDesignTab
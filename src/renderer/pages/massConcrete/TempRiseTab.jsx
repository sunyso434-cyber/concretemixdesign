// src/renderer/pages/massConcrete/TempRiseTab.jsx
import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, InputNumber, message, Divider, Alert, Row, Col, Modal, Popconfirm } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setAdiabaticTempData, setTemperatureFieldData, setTemperatureFieldStatus, setHeatDissipationConditions } from '../../../store/massConcreteSlice'
import TempRiseChart from '../../components/charts/TempRiseChart'
import TemperatureFieldChart from '../../components/charts/TemperatureFieldChart'

const { Option } = Select

/**
 * 水化热影响系数表 - 粉煤灰
 * 格式: {掺量比例: 系数}
 */
const FLY_ASH_K1 = {
  0: 1.00,
  10: 0.98,
  20: 0.95,
  30: 0.88,
  40: 0.78,
  50: 0.58
}

/**
 * 水化热影响系数表 - 矿渣粉
 * 格式: {掺量比例: 系数}
 */
const SLAG_K2 = {
  0: 1.00,
  10: 0.97,
  20: 0.92,
  30: 0.80,
  40: 0.55,
  50: 0.32
}

/**
 * 线性插值计算影响系数
 */
const interpolateK = (ratio, table) => {
  const ratios = Object.keys(table).map(Number).sort((a, b) => a - b)
  if (ratio <= ratios[0]) return table[ratios[0]]
  if (ratio >= ratios[ratios.length - 1]) return table[ratios[ratios.length - 1]]
  for (let i = 0; i < ratios.length - 1; i++) {
    if (ratio >= ratios[i] && ratio <= ratios[i + 1]) {
      const t = (ratio - ratios[i]) / (ratios[i + 1] - ratios[i])
      return table[ratios[i]] + t * (table[ratios[i + 1]] - table[ratios[i]])
    }
  }
  return 1.0
}

/**
 * 强度等级选项
 */
const STRENGTH_OPTIONS = ['C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50']

/**
 * 温度升幅计算标签页组件
 * 用于计算大体积混凝土的绝热温升和温度场分布
 * @param {Function} onCalculate - 计算完成后的回调函数
 */
const TempRiseTab = ({ onCalculate }) => {
  const dispatch = useDispatch()
  const adiabaticTempData = useSelector(state => state.massConcrete.adiabaticTempData)
  const mixDesignData = useSelector(state => state.massConcrete.mixDesignData)
  const temperatureFieldData = useSelector(state => state.massConcrete.temperatureFieldData)
  const heatDissipationConditions = useSelector(state => state.massConcrete.heatDissipationConditions)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [temperatureFieldLoading, setTemperatureFieldLoading] = useState(false)
  const [materials, setMaterials] = useState([])
  const [selectedCement, setSelectedCement] = useState(null)
  const [selectedFlyAsh, setSelectedFlyAsh] = useState(null)
  const [selectedSlag, setSelectedSlag] = useState(null)

  // 散热条件相关状态
  const [selectedCondition, setSelectedCondition] = useState(null)
  const [editingConditionVisible, setEditingConditionVisible] = useState(false)
  const [editingCondition, setEditingCondition] = useState(null)
  const [conditionForm] = Form.useForm()

  // 水化热默认值
  const DEFAULT_CEMENT_HEAT_3D = 260
  const DEFAULT_CEMENT_HEAT_7D = 300

  // 加载散热条件列表
  const loadHeatDissipationConditions = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('mc_getHeatDissipationConditions')
      if (result.success) {
        dispatch(setHeatDissipationConditions(result.data))
      }
    } catch (error) {
      console.error('加载散热条件失败:', error)
    }
  }

  // 初始化加载
  useEffect(() => {
    loadHeatDissipationConditions()
  }, [])

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

  // 根据类型获取材料
  const getMaterialsByType = (type) => {
    return materials.filter(m => m.type === type)
  }

  // 水泥选择变化时，自动填充水化热
  const handleCementChange = async (cementId) => {
    if (!cementId) {
      setSelectedCement(null)
      form.setFieldsValue({
        cementHeat3d: DEFAULT_CEMENT_HEAT_3D,
        cementHeat7d: DEFAULT_CEMENT_HEAT_7D
      })
      return
    }

    try {
      const result = await window.electron.ipcRenderer.invoke('mc_getMaterialById', cementId)
      if (result.success && result.data) {
        const cement = result.data
        setSelectedCement(cement)
        form.setFieldsValue({
          cementHeat3d: cement.cementHeat3d ?? DEFAULT_CEMENT_HEAT_3D,
          cementHeat7d: cement.cementHeat7d ?? DEFAULT_CEMENT_HEAT_7D
        })
      }
    } catch (error) {
      console.error('获取水泥信息失败:', error)
      form.setFieldsValue({
        cementHeat3d: DEFAULT_CEMENT_HEAT_3D,
        cementHeat7d: DEFAULT_CEMENT_HEAT_7D
      })
    }
  }

  // 散热条件选择变化时，自动填充散热系数
  const handleConditionChange = (conditionId) => {
    if (!conditionId) {
      setSelectedCondition(null)
      return
    }

    const condition = heatDissipationConditions.find(c => c.id === conditionId)
    if (condition) {
      setSelectedCondition(condition)
    }
  }

  // 打开散热条件编辑对话框
  const openConditionEditor = (condition = null) => {
    setEditingCondition(condition)
    if (condition) {
      conditionForm.setFieldsValue({
        name: condition.name,
        windSpeedRef: condition.windSpeedRef,
        beta: condition.beta,
        remarks: condition.remarks
      })
    } else {
      conditionForm.resetFields()
    }
    setEditingConditionVisible(true)
  }

  // 创建或更新散热条件
  const handleSaveCondition = async () => {
    try {
      const values = await conditionForm.validateFields()
      if (editingCondition) {
        // 更新
        const result = await window.electron.ipcRenderer.invoke('mc_updateHeatDissipationCondition', {
          id: editingCondition.id,
          ...values
        })
        if (result.success) {
          message.success('散热条件更新成功')
          await loadHeatDissipationConditions()
        } else {
          message.error(result.error || '更新失败')
        }
      } else {
        // 创建
        const result = await window.electron.ipcRenderer.invoke('mc_createHeatDissipationCondition', values)
        if (result.success) {
          message.success('散热条件创建成功')
          await loadHeatDissipationConditions()
        } else {
          message.error(result.error || '创建失败')
        }
      }
      setEditingConditionVisible(false)
    } catch (error) {
      console.error('保存散热条件失败:', error)
    }
  }

  // 删除散热条件
  const handleDeleteCondition = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('mc_deleteHeatDissipationCondition', id)
      if (result.success) {
        message.success('散热条件删除成功')
        await loadHeatDissipationConditions()
      } else {
        message.error(result.error || '删除失败')
      }
    } catch (error) {
      console.error('删除散热条件失败:', error)
    }
  }

  // 计算总发热量
  const calculateTotalHeat = () => {
    const values = form.getFieldsValue()
    const cementHeat3d = values.cementHeat3d || DEFAULT_CEMENT_HEAT_3D
    const cementHeat7d = values.cementHeat7d || DEFAULT_CEMENT_HEAT_7D
    const cementAmount = values.cementConsumption || 0
    const flyAshAmount = values.flyAshConsumption || 0
    const slagAmount = values.slagConsumption || 0

    if (cementHeat3d <= 0 || cementHeat7d <= 0 || cementAmount <= 0) {
      return null
    }

    const Q0 = 4 / (7 / cementHeat7d - 3 / cementHeat3d)
    const totalBinder = cementAmount + flyAshAmount + slagAmount
    const flyAshRatio = totalBinder > 0 ? (flyAshAmount / totalBinder) * 100 : 0
    const slagRatio = totalBinder > 0 ? (slagAmount / totalBinder) * 100 : 0
    const k1 = interpolateK(flyAshRatio, FLY_ASH_K1)
    const k2 = interpolateK(slagRatio, SLAG_K2)
    let k = 1.0
    if (flyAshRatio > 0 && slagRatio > 0) {
      k = k1 + k2 - 1
    } else if (flyAshRatio > 0) {
      k = k1
    } else if (slagRatio > 0) {
      k = k2
    }
    return k * Q0
  }

  // 材料用量变化时自动更新总发热量
  const handleMaterialChange = () => {
    const totalHeat = calculateTotalHeat()
    if (totalHeat !== null && !Number.isNaN(totalHeat)) {
      const cementAmount = form.getFieldValue('cementConsumption') || 0
      const flyAshAmount = form.getFieldValue('flyAshConsumption') || 0
      const slagAmount = form.getFieldValue('slagConsumption') || 0
      form.setFieldsValue({
        totalBinder: cementAmount + flyAshAmount + slagAmount,
        totalHeat: totalHeat.toFixed(2)
      })
    }
  }

  // 从配合比数据导入所有材料信息和用量
  const importFromMixDesign = async () => {
    if (!mixDesignData) {
      message.warning('请先进行配合比设计')
      return
    }

    try {
      const materialAmounts = mixDesignData.materials || {}
      const inputMaterials = mixDesignData.inputParams?.materials || {}

      // 收集所有材料ID（处理材料可能是数组的情况）
      const materialIds = []
      const extractMaterialId = (material) => {
        if (!material) return null
        if (Array.isArray(material)) {
          // 返回第一个材料的ID
          return material.length > 0 ? material[0].id : null
        }
        if (typeof material === 'object') return material.id
        return material
      }

      const cementId = extractMaterialId(inputMaterials.cement)
      const flyAshId = extractMaterialId(inputMaterials.flyAsh)
      const slagId = extractMaterialId(inputMaterials.slag)
      const sandId = extractMaterialId(inputMaterials.sand)
      const stoneId = extractMaterialId(inputMaterials.stone)
      const admixtureId = extractMaterialId(inputMaterials.superplasticizer)

      if (cementId) materialIds.push(cementId)
      if (flyAshId) materialIds.push(flyAshId)
      if (slagId) materialIds.push(slagId)
      if (sandId) materialIds.push(sandId)
      if (stoneId) materialIds.push(stoneId)
      if (admixtureId) materialIds.push(admixtureId)

      // 批量获取材料详情
      let materialMap = {}
      if (materialIds.length > 0) {
        const result = await window.electron.ipcRenderer.invoke('mc_getMaterialsByIds', materialIds)
        if (result.success && result.data) {
          result.data.forEach(m => {
            materialMap[m.id] = m
          })
        }
      }

      // 获取水泥水化热
      const cementMaterial = cementId ? materialMap[cementId] : null
      const cementHeat3d = cementMaterial?.cementHeat3d ?? DEFAULT_CEMENT_HEAT_3D
      const cementHeat7d = cementMaterial?.cementHeat7d ?? DEFAULT_CEMENT_HEAT_7D

      // 获取材料用量
      const cementAmount = materialAmounts.cement || 0
      const flyAshAmount = materialAmounts.flyAsh || 0
      const slagAmount = materialAmounts.slag || 0

      // 计算总发热量
      const totalHeat = calculateTotalHeatForAmounts(cementAmount, flyAshAmount, slagAmount, cementHeat3d, cementHeat7d)

      // 填充表单
      form.setFieldsValue({
        strengthGrade: mixDesignData.strength || 'C30',
        cement: cementId,
        cementConsumption: Math.round(cementAmount),
        flyAsh: flyAshId,
        flyAshConsumption: Math.round(flyAshAmount),
        slag: slagId,
        slagConsumption: Math.round(slagAmount),
        sand: sandId,
        sandConsumption: Math.round(materialAmounts.sand || 0),
        stone: stoneId,
        stoneConsumption: Math.round(materialAmounts.stone || 0),
        waterConsumption: Math.round(materialAmounts.water || 0),
        admixture: admixtureId,
        admixtureConsumption: Number(materialAmounts.superplasticizer || 0).toFixed(2),
        cementHeat3d,
        cementHeat7d,
        totalBinder: Math.round(cementAmount + flyAshAmount + slagAmount),
        totalHeat: totalHeat !== null && !Number.isNaN(totalHeat) ? totalHeat.toFixed(2) : 0
      })

      setSelectedCement(cementId ? materialMap[cementId] : null)
      setSelectedFlyAsh(flyAshId ? materialMap[flyAshId] : null)
      setSelectedSlag(slagId ? materialMap[slagId] : null)

      message.success('已从配合比导入数据')
    } catch (error) {
      console.error('导入配合比失败:', error)
      message.error('导入失败: ' + error.message)
    }
  }

  // 根据用量计算总发热量（静态方法）
  const calculateTotalHeatForAmounts = (cementAmount, flyAshAmount, slagAmount, cementHeat3d, cementHeat7d) => {
    if (cementHeat3d <= 0 || cementHeat7d <= 0 || cementAmount <= 0) {
      return null
    }
    const Q0 = 4 / (7 / cementHeat7d - 3 / cementHeat3d)
    const totalBinder = cementAmount + flyAshAmount + slagAmount
    const flyAshRatio = totalBinder > 0 ? (flyAshAmount / totalBinder) * 100 : 0
    const slagRatio = totalBinder > 0 ? (slagAmount / totalBinder) * 100 : 0
    const k1 = interpolateK(flyAshRatio, FLY_ASH_K1)
    const k2 = interpolateK(slagRatio, SLAG_K2)
    let k = 1.0
    if (flyAshRatio > 0 && slagRatio > 0) {
      k = k1 + k2 - 1
    } else if (flyAshRatio > 0) {
      k = k1
    } else if (slagRatio > 0) {
      k = k2
    }
    return k * Q0
  }

  // 计算绝热温升
  const calculateAdiabaticTemp = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      // 从配合比数据或表单获取强度等级
      const strengthGrade = mixDesignData?.strength || values.strengthGrade || 'C30'

      const params = {
        // === 配合比继承（新增）===
        strengthGrade,
        cementConsumption: Number(values.cementConsumption),
        flyAshConsumption: Number(values.flyAshConsumption) || 0,
        slagConsumption: Number(values.slagConsumption) || 0,

        // === 原有字段 ===
        totalBinder: Number(values.totalBinder || values.cementConsumption),
        totalHeat: Number(values.totalHeat),
        moldingTemp: Number(values.placementTemp) || 25,
        ambientTemp: Number(values.ambientTemp) || 20,
        concreteThickness: Number(values.memberHeight) || 2,
        concreteLength: Number(values.memberLength) || 10
      }

      const result = await window.electron.ipcRenderer.invoke('mc_calculateAdiabaticTemp', params)

      if (result.success) {
        dispatch(setAdiabaticTempData(result.data))
        message.success('温度升幅计算成功')
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

  // 计算温度场
  const calculateTemperatureField = async () => {
    if (!adiabaticTempData) {
      message.warning('请先计算温度升幅')
      return
    }

    setTemperatureFieldLoading(true)
    try {
      dispatch(setTemperatureFieldStatus('calculating'))

      // 从绝热温升结果获取 T0 和 m
      const T0 = adiabaticTempData.maxAdiabaticTemp
      const m = adiabaticTempData.hydrationRateCoefficient

      const values = form.getFieldsValue()

      // 从选中的散热条件获取 beta 值
      const beta = selectedCondition?.beta || 10  // 默认值 10 W/(m²·K)

      const params = {
        moldingTemp: Number(values.placementTemp) || 25,
        ambientTemp: Number(values.ambientTemp) || 20,
        thickness: Number(values.memberHeight) || 2,
        lambda: 2.33,  // 导热系数默认值
        c: 0.92,       // 比热容默认值
        rho: mixDesignData?.materials?.density || 2400,  // 从配合比获取密度
        beta,          // 表面散热系数
        adiabaticParams: {
          T0,
          m
        }
      }

      const result = await window.electron.ipcRenderer.invoke('mc_calculateTemperatureField', params)

      if (result.success) {
        dispatch(setTemperatureFieldData(result.data))
        message.success('温度场计算成功')
      } else {
        message.error(result.error || '计算失败')
      }
    } catch (error) {
      console.error('温度场计算失败:', error)
      message.error(error.message || '计算失败')
    } finally {
      setTemperatureFieldLoading(false)
    }
  }

  // 格式化图表数据
  const getTempCurveData = () => {
    if (!adiabaticTempData?.tempCurveData) return []
    return adiabaticTempData.tempCurveData.map(item => ({
      day: item.day,
      temperature: item.temperature
    }))
  }

  return (
    <div>
      <Card className="custom-card" title="温度计算参数">
        {mixDesignData ? (
          <Alert
            message="配合比数据已准备好"
            description={`强度等级: ${mixDesignData.strength || '未设置'}，可点击下方"导入配合比数据"按钮自动填充`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        ) : (
          <Alert
            message="无配合比数据"
            description="请在下方手动选择强度等级和原材料，系统将自动获取水化热参数"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Button
          type="primary"
          onClick={importFromMixDesign}
          style={{ marginBottom: 16 }}
          disabled={!mixDesignData}
        >
          导入配合比数据
        </Button>

        <Divider>配合比参数</Divider>

        <Form
          form={form}
          layout="vertical"
          initialValues={{
            strengthGrade: 'C30',
            cement: null,
            cementConsumption: 280,
            flyAsh: null,
            flyAshConsumption: 0,
            slag: null,
            slagConsumption: 0,
            sand: null,
            sandConsumption: 0,
            stone: null,
            stoneConsumption: 0,
            waterConsumption: 0,
            admixture: null,
            admixtureConsumption: 0,
            cementHeat3d: DEFAULT_CEMENT_HEAT_3D,
            cementHeat7d: DEFAULT_CEMENT_HEAT_7D,
            totalBinder: 280,
            totalHeat: 0,
            ambientTemp: 20,
            placementTemp: 25,
            memberLength: 10,
            memberWidth: 5,
            memberHeight: 2
          }}
        >
          {/* 强度等级 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="strengthGrade"
                label="强度等级"
                rules={[{ required: true, message: '请选择强度等级' }]}
              >
                <Select placeholder="请选择强度等级">
                  {STRENGTH_OPTIONS.map(strength => (
                    <Option key={strength} value={strength}>{strength}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider plain>材料选择与用量</Divider>

          {/* 水泥选择与用量 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="cement"
                label="水泥（选择材料自动获取水化热）"
                rules={[{ required: true, message: '请选择水泥' }]}
              >
                <Select
                  placeholder="请选择水泥"
                  onChange={handleCementChange}
                  showSearch
                  optionFilterProp="children"
                >
                  {getMaterialsByType('水泥').map(material => (
                    <Option key={material.id} value={material.id}>
                      {material.name} {material.cementHeat3d ? `(水化热:${material.cementHeat3d}/${material.cementHeat7d})` : ''}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="cementConsumption"
                label="水泥用量 (kg/m³)"
                rules={[{ required: true, message: '请输入水泥用量' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={600}
                  precision={0}
                  onChange={handleMaterialChange}
                />
              </Form.Item>
            </Col>
          </Row>

          {/* 粉煤灰选择与用量 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="flyAsh"
                label="粉煤灰"
              >
                <Select
                  placeholder="请选择粉煤灰"
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {getMaterialsByType('粉煤灰').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="flyAshConsumption"
                label="粉煤灰用量 (kg/m³)"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={300}
                  precision={0}
                  onChange={handleMaterialChange}
                />
              </Form.Item>
            </Col>
          </Row>

          {/* 矿渣粉选择与用量 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="slag"
                label="矿渣粉"
              >
                <Select
                  placeholder="请选择矿渣粉"
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {getMaterialsByType('矿渣粉').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="slagConsumption"
                label="矿渣粉用量 (kg/m³)"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  max={300}
                  precision={0}
                  onChange={handleMaterialChange}
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider plain>其他材料选择与用量</Divider>

          {/* 细骨料选择与用量 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="sand" label="细骨料">
                <Select
                  placeholder="请选择细骨料"
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {getMaterialsByType('细骨料').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sandConsumption" label="细骨料用量 (kg/m³)">
                <InputNumber style={{ width: '100%' }} min={0} max={1000} precision={0} />
              </Form.Item>
            </Col>
          </Row>

          {/* 粗骨料选择与用量 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="stone" label="粗骨料">
                <Select
                  placeholder="请选择粗骨料"
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {getMaterialsByType('粗骨料').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="stoneConsumption" label="粗骨料用量 (kg/m³)">
                <InputNumber style={{ width: '100%' }} min={0} max={1000} precision={0} />
              </Form.Item>
            </Col>
          </Row>

          {/* 外加剂选择与用量 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="admixture" label="外加剂">
                <Select
                  placeholder="请选择外加剂"
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {getMaterialsByType('减水剂').concat(getMaterialsByType('外加剂')).map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="admixtureConsumption" label="外加剂用量 (kg/m³)">
                <InputNumber style={{ width: '100%' }} min={0} max={50} precision={2} />
              </Form.Item>
            </Col>
          </Row>

          {/* 用水量（不需要选择材料） */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="waterConsumption" label="用水量 (kg/m³)">
                <InputNumber style={{ width: '100%' }} min={0} max={300} precision={0} />
              </Form.Item>
            </Col>
          </Row>

          <Divider plain>水化热参数（自动计算，仅供查看）</Divider>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="cementHeat3d"
                label="水泥3天水化热 (kJ/kg)"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={100}
                  max={500}
                  precision={1}
                  disabled
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="cementHeat7d"
                label="水泥7天水化热 (kJ/kg)"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={100}
                  max={500}
                  precision={1}
                  disabled
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="totalBinder"
                label="总胶凝材料 (kg/m³)"
              >
                <InputNumber style={{ width: '100%' }} min={0} max={800} precision={0} disabled />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="totalHeat"
                label="总发热量 (kJ/m³)"
              >
                <InputNumber style={{ width: '100%' }} min={0} max={1000} precision={2} disabled />
              </Form.Item>
            </Col>
          </Row>

          <Divider plain>环境与构件参数</Divider>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="ambientTemp" label="环境温度 (°C)">
                <InputNumber style={{ width: '100%' }} min={-30} max={50} precision={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="placementTemp" label="浇筑温度 (°C)">
                <InputNumber style={{ width: '100%' }} min={0} max={40} precision={1} />
              </Form.Item>
            </Col>
          </Row>

          <Divider plain>散热条件</Divider>

          <Row gutter={16} align="middle">
            <Col span={12}>
              <Form.Item name="heatDissipationConditionId" label="散热条件">
                <Select
                  placeholder="选择散热条件"
                  onChange={handleConditionChange}
                  allowClear
                >
                  {heatDissipationConditions.map(cond => (
                    <Option key={cond.id} value={cond.id}>
                      {cond.name} (β={cond.beta} W/(m²·K))
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Button type="link" onClick={() => openConditionEditor(null)}>
                新增散热条件
              </Button>
              {selectedCondition && (
                <Button type="link" onClick={() => openConditionEditor(selectedCondition)}>
                  编辑
                </Button>
              )}
            </Col>
          </Row>

          {selectedCondition && (
            <Alert
              message={`当前散热条件: ${selectedCondition.name}`}
              description={`参考风速: ${selectedCondition.windSpeedRef || '无'}，散热系数 β = ${selectedCondition.beta} W/(m²·K)${selectedCondition.remarks ? '，' + selectedCondition.remarks : ''}`}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="memberLength" label="构件长度 (m)">
                <InputNumber style={{ width: '100%' }} min={1} max={200} precision={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="memberWidth" label="构件宽度 (m)">
                <InputNumber style={{ width: '100%' }} min={1} max={100} precision={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="memberHeight" label="构件高度 (m)">
                <InputNumber style={{ width: '100%' }} min={0.5} max={20} precision={1} />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ marginTop: 24 }}>
            <Button
              type="primary"
              className="custom-btn"
              onClick={calculateAdiabaticTemp}
              loading={loading}
            >
              计算温度升幅
            </Button>
          </div>
        </Form>
      </Card>

      {/* 计算结果图表展示 */}
      {adiabaticTempData && (
        <>
          <Card className="custom-card" title="温度升幅曲线" style={{ marginTop: 16 }}>
            <TempRiseChart
              tempCurveData={getTempCurveData()}
              title="温度-时间曲线"
            />
          </Card>

          <Card className="custom-card" title="温度计算结果" style={{ marginTop: 16 }}>
            <div className="grid-2-col">
              <div>
                <h4>温升参数</h4>
                <ul>
                  <li>最高温度: {adiabaticTempData.maxAdiabaticTemp ? adiabaticTempData.maxAdiabaticTemp.toFixed(1) : '-'} °C</li>
                  <li>温升系数m0: {adiabaticTempData.hydrationRateCoefficient ? adiabaticTempData.hydrationRateCoefficient.toFixed(4) : '-'} </li>
                  <li>总发热量: {adiabaticTempData.totalHeat ? Number(adiabaticTempData.totalHeat).toFixed(2) : '-'} kJ/m³</li>
                </ul>
              </div>
              <div>
                <h4>计算参数</h4>
                <ul>
                  <li>入模温度: {adiabaticTempData.moldingTemp || '-'} °C</li>
                  <li>环境温度: {adiabaticTempData.ambientTemp || '-'} °C</li>
                  <li>构件厚度: {adiabaticTempData.concreteThickness || '-'} m</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* 温度场计算区块 */}
          <Card className="custom-card" title="温度场数值解" style={{ marginTop: 16 }}>
            <Alert
              message="温度场数值解说明"
              description="基于《GB 50496-2018》附录B，采用显式差分格式计算混凝土温度场分布，根据傅里叶数 Fo 动态调整空间网格，考虑表面散热边界条件。"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Button
              type="default"
              className="custom-btn"
              onClick={calculateTemperatureField}
              loading={temperatureFieldLoading}
              disabled={!adiabaticTempData}
            >
              计算温度场
            </Button>

            {temperatureFieldData && (
              <TemperatureFieldChart temperatureFieldData={temperatureFieldData} />
            )}
          </Card>
        </>
      )}

      {/* 散热条件编辑对话框 */}
      <Modal
        title={editingCondition ? '编辑散热条件' : '新增散热条件'}
        open={editingConditionVisible}
        onOk={handleSaveCondition}
        onCancel={() => setEditingConditionVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={conditionForm}
          layout="vertical"
        >
          <Form.Item
            name="name"
            label="散热条件名称"
            rules={[{ required: true, message: '请输入散热条件名称' }]}
          >
            <Input placeholder="如：室外微风" />
          </Form.Item>

          <Form.Item
            name="windSpeedRef"
            label="参考风速"
            rules={[{ required: false, message: '请输入参考风速' }]}
          >
            <Input placeholder="如：1~2 m/s" />
          </Form.Item>

          <Form.Item
            name="beta"
            label="散热系数 β (W/(m²·K))"
            rules={[{ required: true, message: '请输入散热系数' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              max={200}
              precision={1}
              placeholder="如：10"
            />
          </Form.Item>

          <Form.Item
            name="remarks"
            label="备注"
          >
            <Input.TextArea placeholder="备注信息" rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 散热条件列表管理 */}
      {heatDissipationConditions.length > 0 && (
        <Card className="custom-card" title="散热条件列表" style={{ marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>名称</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>参考风速</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>散热系数 β</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>备注</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {heatDissipationConditions.map(cond => (
                <tr key={cond.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px' }}>{cond.name}</td>
                  <td style={{ padding: '8px' }}>{cond.windSpeedRef || '-'}</td>
                  <td style={{ padding: '8px' }}>{cond.beta} W/(m²·K)</td>
                  <td style={{ padding: '8px' }}>{cond.remarks || '-'}</td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <Button type="link" size="small" onClick={() => openConditionEditor(cond)}>
                      编辑
                    </Button>
                    {!cond.isDefault && (
                      <Popconfirm
                        title="确定删除该散热条件？"
                        onConfirm={() => handleDeleteCondition(cond.id)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button type="link" size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

export default TempRiseTab
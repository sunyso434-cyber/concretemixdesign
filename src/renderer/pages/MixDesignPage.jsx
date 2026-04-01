import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, Table, Space, message, Modal, InputNumber, Divider } from 'antd'

const { Option } = Select

const MixDesignPage = () => {
  const [form] = Form.useForm()
  const [materials, setMaterials] = useState([])
  const [calculationResult, setCalculationResult] = useState(null)
  const [seriesResults, setSeriesResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [advancedModalVisible, setAdvancedModalVisible] = useState(false)
  const [advancedForm] = Form.useForm()
  const [saveForm] = Form.useForm()
  const [tempSettings, setTempSettings] = useState(null)

  // 强度等级选项
  const strengthOptions = ['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60']

  // 环境类别选项
  const environmentOptions = [
    { value: '1', label: '一类（室内干燥环境）' },
    { value: '2a', label: '二类a（室内潮湿环境）' },
    { value: '2b', label: '二类b（严寒和寒冷地区的露天环境）' },
    { value: '3a', label: '三类a（使用除冰盐的环境）' },
    { value: '3b', label: '三类b（海水环境）' }
  ]

  // 工程类型选项
  const projectTypeOptions = [
    { value: 'civil', label: '民用建筑' },
    { value: 'industrial', label: '工业建筑' },
    { value: 'bridge', label: '桥梁工程' },
    { value: 'water', label: '水利工程' }
  ]

  // 计算方法选项
  const calculationMethodOptions = [
    { value: 'absolute', label: '绝对体积法' },
    { value: 'mass', label: '质量法' }
  ]

  // 材料类型
  const materialTypes = {
    cement: '水泥',
    admixture: '粉煤灰',
    slag: '矿渣粉',
    sand: '细骨料',
    stone: '粗骨料',
    superplasticizer: '减水剂'
  }

  // 加载原材料列表
  const loadMaterials = async () => {
    try {
      console.log('开始加载原材料...')
      const result = await window.electron.ipcRenderer.invoke('getAllMaterials')
      console.log('getAllMaterials返回结果:', result)
      if (result.success) {
        setMaterials(result.data)
        console.log('原材料列表:', result.data)
        return result.data // 返回最新的材料数据
      } else {
        message.error(result.error)
        return []
      }
    } catch (error) {
      console.error('加载原材料失败:', error)
      message.error('加载原材料失败')
      return []
    }
  }

  // 初始化加载
  useEffect(() => {
    loadMaterials()
  }, [])

  // 快速测试计算
  const quickTest = async () => {
    setLoading(true)
    try {
      console.log('开始快速测试...')
      const testParams = {
        strength: 'C30',
        slump: 120,
        environment: '1',
        projectType: 'civil',
        calculationMethod: 'absolute',
        flyAshDosage: 20,
        slagDosage: 10,
        sandRatio: 35,
        tempSettings: tempSettings
      }
      console.log('测试参数:', testParams)
      
      console.log('调用calculateMixDesign...')
      const result = await window.electron.ipcRenderer.invoke('calculateMixDesign', testParams)
      console.log('calculateMixDesign返回结果:', result)
      
      if (result.success) {
        setCalculationResult(result.data)
        message.success('计算成功！')
      } else {
        message.error(result.error)
      }
    } catch (error) {
      console.error('快速测试失败:', error)
      message.error(`快速测试失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 计算配合比
  const calculateMixDesign = async () => {
    setLoading(true)
    try {
      console.log('开始验证表单...')
      const values = await form.validateFields()
      console.log('表单验证成功，values:', values)
      
      // 重新加载材料列表，确保使用最新的材料数据
      const latestMaterials = await loadMaterials()
      
      // 构建材料对象
      const materialsObj = {
        cement: latestMaterials.find(m => m.id === values.cement),
        flyAsh: latestMaterials.find(m => m.id === values.flyAsh),
        slag: latestMaterials.find(m => m.id === values.slag),
        sand: Array.isArray(values.sand) ? latestMaterials.filter(m => values.sand.some(sid => String(sid) === String(m.id))) : latestMaterials.find(m => m.id === values.sand),
        stone: Array.isArray(values.stone) ? latestMaterials.filter(m => values.stone.some(sid => String(sid) === String(m.id))) : latestMaterials.find(m => m.id === values.stone),
        superplasticizer: latestMaterials.find(m => m.id === values.superplasticizer)
      }
      
      // 检查材料对象是否都存在
      for (const [key, material] of Object.entries(materialsObj)) {
        if (key === 'sand' || key === 'stone') {
          if (!material || (Array.isArray(material) && material.length === 0)) {
            throw new Error(`找不到${key}材料，请重新选择`)
          }
        } else if (!material) {
          throw new Error(`找不到${key}材料，请重新选择`)
        }
      }
      
      // 从values中移除sand和stone，因为它们已经在materialsObj中处理过了
      const { sand, stone, ...otherValues } = values
      const params = {
        ...otherValues,
        materials: materialsObj,
        tempSettings: tempSettings
      }
      
      console.log('调用calculateMixDesign...')
      const result = await window.electron.ipcRenderer.invoke('calculateMixDesign', params)
      console.log('calculateMixDesign返回结果:', result)
      
      if (result.success) {
        setCalculationResult(result.data)
        console.log('计算结果:', {
          hasMaterialCosts: !!result.data.materialCosts,
          hasTotalCost: !!result.data.totalCost,
          materialCosts: result.data.materialCosts,
          totalCost: result.data.totalCost
        })
        message.success('计算成功')
      } else {
        message.error(result.error)
      }
    } catch (error) {
      console.error('计算失败:', error)
      message.error(`计算失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 计算系列配合比
  const calculateSeriesMixDesign = async () => {
    setLoading(true)
    try {
      console.log('开始验证表单...')
      const values = await form.validateFields()
      console.log('表单验证成功，values:', values)
      
      // 重新加载材料列表，确保使用最新的材料数据
      const latestMaterials = await loadMaterials()
      
      // 构建材料对象
      const materialsObj = {
        cement: latestMaterials.find(m => m.id === values.cement),
        flyAsh: latestMaterials.find(m => m.id === values.flyAsh),
        slag: latestMaterials.find(m => m.id === values.slag),
        sand: Array.isArray(values.sand) ? latestMaterials.filter(m => values.sand.includes(m.id)) : latestMaterials.find(m => m.id === values.sand),
        stone: Array.isArray(values.stone) ? latestMaterials.filter(m => values.stone.includes(m.id)) : latestMaterials.find(m => m.id === values.stone),
        superplasticizer: latestMaterials.find(m => m.id === values.superplasticizer)
      }
      
      // 检查材料对象是否都存在
      for (const [key, material] of Object.entries(materialsObj)) {
        if (key === 'sand' || key === 'stone') {
          if (!material || (Array.isArray(material) && material.length === 0)) {
            throw new Error(`找不到${key}材料，请重新选择`)
          }
        } else if (!material) {
          throw new Error(`找不到${key}材料，请重新选择`)
        }
      }
      
      const seriesStrengths = ['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60']
      const baseSandRatio = values.sandRatio || 35
      const results = []
      
      for (const strength of seriesStrengths) {
        // 计算当前强度等级的砂率
        const strengthNum = parseInt(strength.replace('C', ''))
        const sandRatioAdjustment = (30 - strengthNum) // C30为基准，每增减5MPa调整1%
        const currentSandRatio = baseSandRatio + sandRatioAdjustment / 5
        
        // 从values中移除sand和stone，因为它们已经在materialsObj中处理过了
        const { sand, stone, ...otherValues } = values
        const params = {
          ...otherValues,
          strength: strength,
          sandRatio: currentSandRatio,
          materials: materialsObj,
          tempSettings: tempSettings
        }
        
        console.log(`计算${strength}配合比，砂率: ${currentSandRatio}%`)
        const result = await window.electron.ipcRenderer.invoke('calculateMixDesign', params)
        
        if (result.success) {
          results.push({
            strength: strength,
            data: result.data
          })
        } else {
          console.error(`计算${strength}配合比失败:`, result.error)
        }
      }
      
      setSeriesResults(results)
      message.success('系列配合比计算成功')
    } catch (error) {
      console.error('系列配合比计算失败:', error)
      message.error(`系列配合比计算失败: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 打开高级设置
  const openAdvancedModal = () => {
    advancedForm.setFieldsValue(tempSettings || {})
    setAdvancedModalVisible(true)
  }

  // 保存高级设置
  const saveAdvancedSettings = () => {
    const values = advancedForm.getFieldsValue()
    setTempSettings(values)
    setAdvancedModalVisible(false)
    message.success('高级设置已保存（临时）')
  }

  // 打开保存方案模态框
  const openSaveModal = () => {
    if (!calculationResult) {
      message.warning('请先计算配合比')
      return
    }
    saveForm.resetFields()
    setSaveModalVisible(true)
  }

  // 关闭保存方案模态框
  const closeSaveModal = () => {
    setSaveModalVisible(false)
  }

  // 保存方案
  const saveMixDesign = async () => {
    try {
      const saveValues = await saveForm.validateFields()
      const values = await form.validateFields()
      
      // 重新加载材料列表，确保使用最新的材料数据
      const latestMaterials = await loadMaterials()
      
      // 构建材料对象
      const materialsObj = {
        cement: latestMaterials.find(m => m.id === values.cement),
        flyAsh: latestMaterials.find(m => m.id === values.flyAsh),
        slag: latestMaterials.find(m => m.id === values.slag),
        sand: latestMaterials.find(m => m.id === values.sand),
        stone: latestMaterials.find(m => m.id === values.stone),
        superplasticizer: latestMaterials.find(m => m.id === values.superplasticizer)
      }
      
      console.log('calculationResult:', {
        hasMaterialCosts: !!calculationResult.materialCosts,
        hasTotalCost: !!calculationResult.totalCost,
        materialCosts: calculationResult.materialCosts,
        totalCost: calculationResult.totalCost
      })
      
      const mixDesignData = {
        ...saveValues,
        ...values,
        ...calculationResult,
        materialDetails: materialsObj,
        tempSettings,
        status: '未验证'
      }
      
      console.log('保存方案数据:', {
        hasMaterialDetails: !!mixDesignData.materialDetails,
        hasMaterialCosts: !!mixDesignData.materialCosts,
        hasTotalCost: !!mixDesignData.totalCost,
        materialDetailsKeys: mixDesignData.materialDetails ? Object.keys(mixDesignData.materialDetails) : [],
        materialCostsKeys: mixDesignData.materialCosts ? Object.keys(mixDesignData.materialCosts) : [],
        totalCost: mixDesignData.totalCost
      })
      
      const result = await window.electron.ipcRenderer.invoke('createMixDesign', mixDesignData)
      if (result.success) {
        message.success('保存成功')
        closeSaveModal()
      } else {
        message.error(result.error)
      }
    } catch (error) {
      console.error('保存方案失败:', error)
      message.error('保存失败')
    }
  }

  // 构建计算结果表格数据
  const buildCalculationResult = () => {
    if (!calculationResult || !calculationResult.materials) return []
    const materialsAmounts = calculationResult.materials
    console.log('Materials amounts:', materialsAmounts)
    const result = [
      { key: '1', material: '水泥', amount: (materialsAmounts.cement || 0).toFixed(1), unit: 'kg/m³' },
      { key: '2', material: '粉煤灰', amount: (materialsAmounts.flyAsh || 0).toFixed(1), unit: 'kg/m³' },
      { key: '3', material: '矿渣粉', amount: (materialsAmounts.slag || 0).toFixed(1), unit: 'kg/m³' }
    ]
    
    // 处理多种细骨料
    const sandKeys = Object.keys(materialsAmounts).filter(key => key.startsWith('sand_'))
    console.log('Sand keys:', sandKeys)
    if (sandKeys.length > 0) {
      // 显示每种细骨料的用量
      sandKeys.forEach((key, index) => {
        const materialId = key.replace('sand_', '')
        console.log('Sand material ID:', materialId, typeof materialId)
        // 使用宽松相等或转换为字符串比较
        const material = materials.find(m => m && String(m.id) === String(materialId)) || { name: `细骨料${index + 1}` }
        console.log('Sand material found:', material)
        result.push({ 
          key: `sand_${index + 1}`, 
          material: `砂 - ${material.name || `细骨料${index + 1}`}`, 
          amount: (materialsAmounts[key] || 0).toFixed(1), 
          unit: 'kg/m³' 
        })
      })
    } else {
      // 单一细骨料
      result.push({ key: '4', material: '砂', amount: (materialsAmounts.sand || 0).toFixed(1), unit: 'kg/m³' })
    }
    
    // 处理多种粗骨料
    const stoneKeys = Object.keys(materialsAmounts).filter(key => key.startsWith('stone_'))
    console.log('Stone keys:', stoneKeys)
    if (stoneKeys.length > 0) {
      // 显示每种粗骨料的用量
      stoneKeys.forEach((key, index) => {
        const materialId = key.replace('stone_', '')
        console.log('Stone material ID:', materialId, typeof materialId)
        // 使用宽松相等或转换为字符串比较
        const material = materials.find(m => m && String(m.id) === String(materialId)) || { name: `粗骨料${index + 1}` }
        console.log('Stone material found:', material)
        result.push({ 
          key: `stone_${index + 1}`, 
          material: `石 - ${material.name || `粗骨料${index + 1}`}`, 
          amount: (materialsAmounts[key] || 0).toFixed(1), 
          unit: 'kg/m³' 
        })
      })
    } else {
      // 单一粗骨料
      result.push({ key: '5', material: '石', amount: (materialsAmounts.stone || 0).toFixed(1), unit: 'kg/m³' })
    }
    
    // 添加水和减水剂
    result.push(
      { key: 'water', material: '水', amount: (materialsAmounts.water || 0).toFixed(1), unit: 'kg/m³' },
      { key: 'superplasticizer', material: '减水剂', amount: (materialsAmounts.superplasticizer || 0).toFixed(1), unit: 'kg/m³' }
    )
    
    console.log('Result:', result)
    return result
  }

  const columns = [
    {
      title: '材料',
      dataIndex: 'material',
      key: 'material'
    },
    {
      title: '用量',
      dataIndex: 'amount',
      key: 'amount'
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit'
    }
  ]

  // 根据类型获取原材料
  const getMaterialsByType = (type) => {
    return materials.filter(m => m.type === materialTypes[type])
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 className="page-title">配合比设计</h2>
        <p className="page-subtitle">根据JGJ 55-2011标准计算混凝土配合比</p>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Card className="custom-card" title="设计目标参数">
          <Form form={form} layout="vertical" initialValues={{ calculationMethod: 'absolute', targetDensity: 2400, projectType: 'civil', flyAshDosage: 20, slagDosage: 10, sandRatio: 35 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item name="strength" label="强度等级" rules={[{ required: true, message: '请选择强度等级' }]}>
                <Select placeholder="请选择强度等级" style={{ width: '100%' }}>
                  {strengthOptions.map(strength => (
                    <Option key={strength} value={strength}>{strength}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="slump" label="坍落度 (mm)" rules={[{ required: true, message: '请输入坍落度' }]}>
                <Input type="number" placeholder="请输入坍落度" style={{ width: '100%' }} />
              </Form.Item>
              
              <Form.Item name="environment" label="环境类别" rules={[{ required: true, message: '请选择环境类别' }]}>
                <Select placeholder="请选择环境类别" style={{ width: '100%' }}>
                  {environmentOptions.map(env => (
                    <Option key={env.value} value={env.value}>{env.label}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="projectType" label="工程类型" rules={[{ required: true, message: '请选择工程类型' }]}>
                <Select placeholder="请选择工程类型" style={{ width: '100%' }}>
                  {projectTypeOptions.map(type => (
                    <Option key={type.value} value={type.value}>{type.label}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="flyAshDosage" label="粉煤灰掺量 (%)">
                <InputNumber style={{ width: '100%' }} placeholder="请输入粉煤灰掺量" min={0} max={50} precision={1} />
              </Form.Item>
              
              <Form.Item name="slagDosage" label="矿渣粉掺量 (%)">
                <InputNumber style={{ width: '100%' }} placeholder="请输入矿渣粉掺量" min={0} max={60} precision={1} />
              </Form.Item>
              
              <Form.Item name="sandRatio" label="砂率 (%)">
                <InputNumber style={{ width: '100%' }} placeholder="请输入砂率" min={30} max={50} precision={1} />
              </Form.Item>
            </div>
          </Form>
        </Card>
      </div>

      <div style={{ marginBottom: 24 }}>
        <Card className="custom-card" title="原材料选择">
          <Form form={form} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Form.Item name="cement" label="水泥" rules={[{ required: true, message: '请选择水泥' }]}>
                <Select placeholder="请选择水泥" style={{ width: '100%' }}>
                  {getMaterialsByType('cement').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="flyAsh" label="粉煤灰">
                <Select placeholder="请选择粉煤灰" style={{ width: '100%' }}>
                  {getMaterialsByType('admixture').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="slag" label="矿渣粉">
                <Select placeholder="请选择矿渣粉" style={{ width: '100%' }}>
                  {getMaterialsByType('slag').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="sand" label="细骨料" rules={[{ required: true, message: '请选择细骨料' }]}>
                <Select placeholder="请选择细骨料" style={{ width: '100%' }} mode="multiple">
                  {getMaterialsByType('sand').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="stone" label="粗骨料" rules={[{ required: true, message: '请选择粗骨料' }]}>
                <Select placeholder="请选择粗骨料" style={{ width: '100%' }} mode="multiple">
                  {getMaterialsByType('stone').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="superplasticizer" label="外加剂">
                <Select placeholder="请选择外加剂" style={{ width: '100%' }}>
                  {getMaterialsByType('superplasticizer').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </div>
          </Form>
        </Card>
      </div>

      <div className="action-bar" style={{ marginBottom: 24 }}>
        <Button 
          type="primary" 
          className="custom-btn"
          onClick={calculateMixDesign} 
          loading={loading}
        >
          计算配合比
        </Button>
        <Button 
          type="primary" 
          className="custom-btn"
          onClick={calculateSeriesMixDesign} 
          loading={loading}
        >
          计算系列配合比
        </Button>
        <Button 
          className="custom-btn"
          onClick={openAdvancedModal}
        >
          高级设置
        </Button>
        <Button 
          className="custom-btn"
          onClick={openSaveModal}
        >
          保存方案
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: '300px' }}>
          {calculationResult ? (
            <Card className="custom-card" title="计算结果">
              <Table 
                dataSource={buildCalculationResult()} 
                columns={columns} 
                pagination={false} 
                className="custom-table"
              />
              <div style={{ marginTop: 24, padding: '16px', background: '#f9f9f9', borderRadius: '8px' }}>
                <h4 style={{ marginBottom: 16, fontSize: '14px', fontWeight: '600' }}>配合比参数</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <p>配置强度f_cu,0: <strong>{String(calculationResult.targetStrength || 0)} MPa</strong></p>
                  <p>水胶比: <strong>{String(calculationResult.waterRatio || 0)}</strong></p>
                  <p>砂率: <strong>{String((calculationResult.sandRatio || 0) * 100)}%</strong></p>
                  <p>容重: <strong>{String(calculationResult.density || 0)} kg/m³</strong></p>
                  <p>减水剂掺量: <strong>{String(calculationResult.superplasticizerDosage || 0)}%</strong></p>
                  <p>减水率: <strong>{String(calculationResult.waterReducingRate || 0)}%</strong></p>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="custom-card" title="计算结果">
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <p style={{ color: '#999' }}>请填写设计参数并点击计算配合比按钮</p>
              </div>
            </Card>
          )}
        </div>
        
        <div style={{ flex: 1, minWidth: '300px' }}>
          {calculationResult && calculationResult.materialCosts && (
            <Card className="custom-card" title="成本分析">
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <p>水泥成本: <strong>{String((calculationResult.materialCosts.cement || 0).toFixed(2))} 元/m³</strong></p>
                  <p>粉煤灰成本: <strong>{String((calculationResult.materialCosts.flyAsh || 0).toFixed(2))} 元/m³</strong></p>
                  <p>矿渣粉成本: <strong>{String((calculationResult.materialCosts.slag || 0).toFixed(2))} 元/m³</strong></p>
                  
                  {/* 处理多种细骨料的成本 */}
                  {Object.keys(calculationResult.materialCosts).filter(key => key.startsWith('sand_')).map((key, index) => {
                    const materialId = key.replace('sand_', '')
                    const material = materials.find(m => m && String(m.id) === String(materialId)) || { name: `细骨料${index + 1}` }
                    return (
                      <p key={key}>{`砂 - ${material.name} 成本:`} <strong>{String((calculationResult.materialCosts[key] || 0).toFixed(2))} 元/m³</strong></p>
                    )
                  })}
                  
                  {/* 处理单一细骨料的成本 */}
                  {!Object.keys(calculationResult.materialCosts).some(key => key.startsWith('sand_')) && (
                    <p>砂成本: <strong>{String((calculationResult.materialCosts.sand || 0).toFixed(2))} 元/m³</strong></p>
                  )}
                  
                  {/* 处理多种粗骨料的成本 */}
                  {Object.keys(calculationResult.materialCosts).filter(key => key.startsWith('stone_')).map((key, index) => {
                    const materialId = key.replace('stone_', '')
                    const material = materials.find(m => m && String(m.id) === String(materialId)) || { name: `粗骨料${index + 1}` }
                    return (
                      <p key={key}>{`石 - ${material.name} 成本:`} <strong>{String((calculationResult.materialCosts[key] || 0).toFixed(2))} 元/m³</strong></p>
                    )
                  })}
                  
                  {/* 处理单一粗骨料的成本 */}
                  {!Object.keys(calculationResult.materialCosts).some(key => key.startsWith('stone_')) && (
                    <p>石成本: <strong>{String((calculationResult.materialCosts.stone || 0).toFixed(2))} 元/m³</strong></p>
                  )}
                  
                  <p>减水剂成本: <strong>{String((calculationResult.materialCosts.superplasticizer || 0).toFixed(2))} 元/m³</strong></p>
                </div>
                <Divider />
                <p style={{ fontSize: '16px', fontWeight: 'bold', textAlign: 'right' }}>总成本: <strong style={{ color: '#1890ff' }}>{String((calculationResult.totalCost || 0).toFixed(2))} 元/m³</strong></p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* 高级设置弹窗 */}
      <Modal
        className="custom-modal"
        title="高级设置（临时）"
        open={advancedModalVisible}
        onOk={saveAdvancedSettings}
        onCancel={() => setAdvancedModalVisible(false)}
        width={600}
      >
        <Form className="custom-form" form={advancedForm} layout="vertical">
          <Divider orientation="left">JGJ 55标准参数</Divider>
          <Form.Item name="regressionAlphaA" label="回归系数α_a">
            <InputNumber style={{ width: '100%' }} placeholder="默认0.53" min={0.4} max={0.6} precision={3} />
          </Form.Item>
          <Form.Item name="regressionAlphaB" label="回归系数α_b">
            <InputNumber style={{ width: '100%' }} placeholder="默认0.20" min={0.1} max={0.3} precision={3} />
          </Form.Item>
          <Form.Item name="strengthStdDev" label="强度标准差σ(MPa)">
            <InputNumber style={{ width: '100%' }} placeholder="留空使用默认值" min={3.0} max={8.0} precision={1} />
          </Form.Item>
          <Divider orientation="left">减水剂掺量影响参数</Divider>
          <Form.Item name="mbInfluence" label="MB值每增大0.1，掺量增加(%)">
            <InputNumber style={{ width: '100%' }} placeholder="默认0.1%" min={0.05} max={0.5} precision={2} />
          </Form.Item>
          <Form.Item name="finenessInfluence" label="细度模数每减少0.1，掺量增加(%)">
            <InputNumber style={{ width: '100%' }} placeholder="默认0.1%" min={0.05} max={0.5} precision={2} />
          </Form.Item>
          <Form.Item name="strengthInfluence" label="强度等级每提高5MPa，掺量增加(%)">
            <InputNumber style={{ width: '100%' }} placeholder="默认0.1%" min={0.05} max={0.5} precision={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 系列配合比结果 */}
      {seriesResults && seriesResults.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Card className="custom-card" title="系列配合比结果">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e8e8e8' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>强度等级</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>水泥 (kg/m³)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>粉煤灰 (kg/m³)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>矿渣粉 (kg/m³)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>砂 (kg/m³)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>石 (kg/m³)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>水 (kg/m³)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>减水剂 (kg/m³)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>砂率 (%)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>成本 (元/m³)</th>
                  </tr>
                </thead>
                <tbody>
                  {seriesResults.map((item, index) => (
                    <tr key={item.strength} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px', fontWeight: 'bold' }}>{item.strength}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.cement || 0).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.flyAsh || 0).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.slag || 0).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.sand || 0).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.stone || 0).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.water || 0).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.superplasticizer || 0).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.sandRatio * 100).toFixed(1)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: '#1890ff' }}>{(item.data.totalCost || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* 保存方案弹窗 */}
      <Modal
        className="custom-modal"
        title="保存配合比方案"
        open={saveModalVisible}
        onOk={saveMixDesign}
        onCancel={closeSaveModal}
        width={600}
      >
        <Form className="custom-form" form={saveForm} layout="vertical">
          <Form.Item name="name" label="方案名称" rules={[{ required: true, message: '请输入方案名称' }]}>
            <Input placeholder="请输入方案名称" />
          </Form.Item>
          <Form.Item name="projectName" label="项目名称">
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入描述" rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default MixDesignPage

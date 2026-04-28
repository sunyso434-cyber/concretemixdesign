import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, Table, Space, message, Divider, Row, Col, Tag, InputNumber, Progress } from 'antd'

import { useSelector, useDispatch } from 'react-redux'
import { setOptimizationTask, clearOptimizationTask } from '../../store/mixDesignSlice'

const { Option } = Select
const { Group: InputNumberGroup } = InputNumber

const OptimizationPage = () => {
  const dispatch = useDispatch()
  const optimizationTask = useSelector(state => state.mixDesign.optimizationTask)

  const [form] = Form.useForm()
  const [materials, setMaterials] = useState([])
  const [optimizing, setOptimizing] = useState(false)
  const [result, setResult] = useState(null)
  const [progress, setProgress] = useState(null)
  const [currentTaskId, setCurrentTaskId] = useState(null)

  // 强度等级选项
  const strengthOptions = ['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60']

  // 坍落度选项
  const slumpOptions = [
    { value: 60, label: '60mm' },
    { value: 90, label: '90mm' },
    { value: 120, label: '120mm' },
    { value: 150, label: '150mm' },
    { value: 180, label: '180mm' },
    { value: 210, label: '210mm' }
  ]

  // 加载原材料和恢复优化状态
  useEffect(() => {
    loadMaterials()

    // 检查是否有正在进行的优化任务
    if (optimizationTask && optimizationTask.status === 'running' && optimizationTask.taskId) {
      setOptimizing(true)
      setCurrentTaskId(optimizationTask.taskId)
      // 查询任务状态
      window.electronAPI.invoke('getOptimizationTaskStatus', optimizationTask.taskId)
        .then(res => {
          if (res.success) {
            if (res.status === 'completed' && res.result) {
              setResult(res.result.bestSolution)
              dispatch(clearOptimizationTask())
              message.success('优化完成！找到最低成本方案')
            } else if (res.status === 'failed') {
              dispatch(clearOptimizationTask())
              message.error('优化失败')
            } else if (res.status === 'cancelled') {
              dispatch(clearOptimizationTask())
              message.info('优化已取消')
            }
            setOptimizing(false)
            setCurrentTaskId(null)
          }
        })
    }

    // 监听优化进度事件
    const handleProgress = (progress) => {
      setProgress(progress)
    }

    // 监听优化完成事件
    const handleCompleted = (data) => {
      console.log('[优化页面] 优化完成:', data)
      setProgress(null)
      setOptimizing(false)
      if (data.result && data.result.bestSolution) {
        setResult(data.result.bestSolution)
        dispatch(clearOptimizationTask())
        message.success('优化完成！找到最低成本方案')
      }
      setCurrentTaskId(null)
    }

    // 监听优化失败事件
    const handleFailed = (data) => {
      console.log('[优化页面] 优化失败:', data)
      setProgress(null)
      setOptimizing(false)
      dispatch(clearOptimizationTask())
      if (data.error !== 'cancelled') {
        message.error('优化失败：' + data.error)
      }
      setCurrentTaskId(null)
    }

    window.electronAPI.on('optimization-progress', handleProgress)
    window.electronAPI.on('optimization-completed', handleCompleted)
    window.electronAPI.on('optimization-failed', handleFailed)

    return () => {
      window.electronAPI.removeAllListeners('optimization-progress')
      window.electronAPI.removeAllListeners('optimization-completed')
      window.electronAPI.removeAllListeners('optimization-failed')
    }
  }, [optimizationTask])

  const loadMaterials = async () => {
    try {
      const res = await window.electronAPI.invoke('getAllMaterials')
      if (res.success) {
        setMaterials(res.data || [])
      } else {
        message.error('加载材料失败：' + res.error)
      }
    } catch (error) {
      message.error('加载材料失败：' + error.message)
    }
  }

  // 材料类型映射
  const materialTypeMap = {
    '水泥': 'cement',
    '粉煤灰': 'flyAsh',
    '矿渣粉': 'slag',
    '细骨料': 'sand',
    '粗骨料': 'stone',
    '减水剂': 'superplasticizer'
  }

  // 执行优化计算
  const handleOptimize = async () => {
    try {
      const values = await form.validateFields()

      // 验证必选材料
      if (!values.cement) {
        message.error('请选择水泥')
        return
      }
      if (!values.sand || values.sand.length === 0) {
        message.error('请选择细骨料')
        return
      }
      if (!values.stone || values.stone.length === 0) {
        message.error('请选择粗骨料')
        return
      }
      if (!values.superplasticizer) {
        message.error('请选择减水剂')
        return
      }

      setOptimizing(true)
      setResult(null)

      // 构建材料对象
      const materialsMap = {}
      materials.forEach(m => {
        // 水泥（单选）
        if (m.id === values.cement) materialsMap.cement = m

        // 粉煤灰（多选）
        if (Array.isArray(values.flyAsh) && values.flyAsh.includes(m.id)) {
          if (!materialsMap.flyAsh) materialsMap.flyAsh = []
          materialsMap.flyAsh.push(m)
        }

        // 矿渣粉（多选）
        if (Array.isArray(values.slag) && values.slag.includes(m.id)) {
          if (!materialsMap.slag) materialsMap.slag = []
          materialsMap.slag.push(m)
        }

        // 锂渣（多选）
        if (Array.isArray(values.lithiumSlag) && values.lithiumSlag.includes(m.id)) {
          if (!materialsMap.lithiumSlag) materialsMap.lithiumSlag = []
          materialsMap.lithiumSlag.push(m)
        }

        // 复合粉（多选）
        if (Array.isArray(values.compositePowder) && values.compositePowder.includes(m.id)) {
          if (!materialsMap.compositePowder) materialsMap.compositePowder = []
          materialsMap.compositePowder.push(m)
        }

        // 细骨料（多选）
        if (Array.isArray(values.sand) && values.sand.includes(m.id)) {
          if (!materialsMap.sand) materialsMap.sand = []
          materialsMap.sand.push(m)
        }

        // 粗骨料（多选）
        if (Array.isArray(values.stone) && values.stone.includes(m.id)) {
          if (!materialsMap.stone) materialsMap.stone = []
          materialsMap.stone.push(m)
        }

        // 减水剂（多选）
        if (Array.isArray(values.superplasticizer) && values.superplasticizer.includes(m.id)) {
          if (!materialsMap.superplasticizer) materialsMap.superplasticizer = []
          materialsMap.superplasticizer.push(m)
        }
      })

      // 构建优化参数
      const params = {
        constraints: {
          strength: values.strength,
          slump: values.slump,
          materials: materialsMap,
          projectName: values.projectName
        },
        userLimits: {
          flyAshRange: [values.flyAshRange?.[0] ?? 0, values.flyAshRange?.[1] ?? 30],
          slagRange: [values.slagRange?.[0] ?? 0, values.slagRange?.[1] ?? 20],
          lithiumSlagRange: [values.lithiumSlagRange?.[0] ?? 0, values.lithiumSlagRange?.[1] ?? 20],
          compositePowderRange: [values.compositePowderRange?.[0] ?? 0, values.compositePowderRange?.[1] ?? 20],
          gridStep: values.gridStep || 5
        }
      }

      console.log('[优化页面] 发送优化请求:', params)

      // 使用后台模式，允许用户导航到其他界面
      const res = await window.electronAPI.invoke('optimizeMixDesign', { ...params, background: true })

      console.log('[优化页面] 收到优化结果:', res)

      if (res.success) {
        // 保存任务ID到 Redux
        setCurrentTaskId(res.taskId)
        dispatch(setOptimizationTask({ taskId: res.taskId, status: 'running' }))
        message.info('优化已开始，您可在优化页面查看进度，也可先操作其他功能')
      } else {
        message.error('优化失败：' + res.error)
        setOptimizing(false)
      }
    } catch (error) {
      console.error('[优化页面] 优化失败:', error)
      setOptimizing(false)
      dispatch(clearOptimizationTask())
      if (error.message?.includes('未找到满足约束条件')) {
        message.error('未找到满足约束条件的方案，请放宽约束或更换原材料')
      } else {
        message.error('优化失败：' + error.message)
      }
    }
  }

  // 取消优化
  const handleCancel = async () => {
    if (!currentTaskId) return

    try {
      const res = await window.electronAPI.invoke('cancelOptimization', currentTaskId)
      if (res.success) {
        message.info('优化已取消')
        dispatch(clearOptimizationTask())
        setOptimizing(false)
        setCurrentTaskId(null)
        setProgress(null)
      } else {
        message.error('取消失败：' + res.error)
      }
    } catch (error) {
      message.error('取消失败：' + error.message)
    }
  }

  // 保存最优方案
  const handleSaveBest = async () => {
    if (!result) return

    try {
      const saveData = {
        name: `优化方案 - ${result.params?.flyAsh || 0}% 粉煤灰 + ${result.params?.slag || 0}% 矿渣`,
        projectName: form.getFieldValue('projectName'),
        strength: form.getFieldValue('strength'),
        slump: form.getFieldValue('slump'),
        waterRatio: result.waterRatio,
        sandRatio: result.sandRatio,
        materials: result.materials,
        materialCosts: result.materialCosts,
        totalCost: result.totalCost,
        density: result.density,
        tempSettings: form.getFieldValue('tempSettings'),
        fineAggregateBreakdown: result.fineAggregateBreakdown,
        coarseAggregateBreakdown: result.coarseAggregateBreakdown,
        // 保存选中的粉煤灰和矿渣粉材料信息（名称、单价等）
        materialDetails: {
          flyAsh: result.selectedMaterials?.flyAsh || null,
          slag: result.selectedMaterials?.slag || null
        }
      }

      const res = await window.electronAPI.invoke('createMixDesign', saveData)

      if (res.success) {
        message.success('方案保存成功')
      } else {
        message.error('保存失败：' + res.error)
      }
    } catch (error) {
      message.error('保存失败：' + error.message)
    }
  }

  // 渲染材料选择器
  const renderMaterialSelect = (materialType, mode = 'single', placeholder = '请选择') => {
    const filteredMaterials = materials.filter(m => m.type === materialType && m.status === '正常')

    return (
      <Select
        mode={mode}
        placeholder={placeholder}
        allowClear
        style={{ width: '100%' }}
        showSearch
        optionFilterProp="children"
      >
        {filteredMaterials.map(m => (
          <Option key={m.id} value={m.id} label={m.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{m.name}</span>
              {m.price && (
                <span style={{ color: '#999', fontSize: '12px' }}>
                  ¥{m.price}/吨
                </span>
              )}
            </div>
          </Option>
        ))}
      </Select>
    )
  }

  // 获取材料信息
  const getMaterialById = (id) => materials.find(m => String(m.id) === String(id))
  const getMaterialByName = (name) => materials.find(m => m.name === name)

  // 构建结果表格数据
  const buildResultTableData = () => {
    if (!result?.materials) return []

    // 获取当前表单值
    const formValues = form.getFieldsValue()

    const data = []
    const materialsData = result.materials

    // 水泥
    if (materialsData.cement) {
      const mat = getMaterialById(formValues.cement)
      data.push({
        key: 'cement',
        name: mat?.name || '水泥',
        amount: materialsData.cement,
        price: mat?.price || 0,
        cost: result.materialCosts?.cement || 0
      })
    }

    // 粉煤灰（优先使用优化器选择的材料信息）
    if (materialsData.flyAsh && materialsData.flyAsh > 0) {
      // 优先使用优化器选择的粉煤灰材料信息（包含名称、单价等）
      const selectedFlyAsh = result.selectedMaterials?.flyAsh
      const mat = selectedFlyAsh || getMaterialById(formValues.flyAsh)
      data.push({
        key: 'flyAsh',
        name: mat?.name || '粉煤灰',
        amount: materialsData.flyAsh,
        price: mat?.price || 0,
        cost: result.materialCosts?.flyAsh || 0
      })
    }

    // 矿渣粉（优先使用优化器选择的材料信息）
    if (materialsData.slag && materialsData.slag > 0) {
      // 优先使用优化器选择的矿渣粉材料信息（包含名称、单价等）
      const selectedSlag = result.selectedMaterials?.slag
      const mat = selectedSlag || getMaterialById(formValues.slag)
      data.push({
        key: 'slag',
        name: mat?.name || '矿渣粉',
        amount: materialsData.slag,
        price: mat?.price || 0,
        cost: result.materialCosts?.slag || 0
      })
    }

    // 细骨料（使用 fineAggregateBreakdown 显示，处理混合砂情况）
    if (result.fineAggregateBreakdown && result.fineAggregateBreakdown.length > 0) {
      result.fineAggregateBreakdown.forEach(f => {
        // 检查是否为混合砂（id 包含 "_"）
        if (f.id && f.id.toString().includes('_')) {
          // 混合砂，展开为各个单一砂
          const sandIds = f.id.toString().split('_')
          const ratios = f.ratio || []
          sandIds.forEach((sandId, i) => {
            const mat = getMaterialById(sandId)
            const ratio = ratios[i] || (1 / sandIds.length)
            const amount = f.amount * ratio
            data.push({
              key: `sand_${sandId}`,
              name: mat?.name || `砂_${sandId}`,
              amount: amount,
              price: mat?.price || 0,
              cost: result.materialCosts?.[`sand_${sandId}`] || 0
            })
          })
        } else {
          // 单一砂
          const mat = getMaterialById(f.id)
          data.push({
            key: `sand_${f.id}`,
            name: mat?.name || f.name || '细骨料',
            amount: f.amount,
            price: mat?.price || 0,
            cost: result.materialCosts?.[`sand_${f.id}`] || 0
          })
        }
      })
    } else if (materialsData.sand) {
      // 单一细骨料
      const mat = materials.find(m => m.type === '细骨料' && m.id === formValues.sand?.[0])
      data.push({
        key: 'sand',
        name: mat?.name || '细骨料',
        amount: materialsData.sand,
        price: mat?.price || 0,
        cost: result.materialCosts?.sand || 0
      })
    }

    // 粗骨料（使用 coarseAggregateBreakdown 显示，处理混合粗骨料情况）
    if (result.coarseAggregateBreakdown && result.coarseAggregateBreakdown.length > 0) {
      result.coarseAggregateBreakdown.forEach(c => {
        // 检查是否为混合粗骨料（id 包含 "_"）
        if (c.id && c.id.toString().includes('_')) {
          // 混合粗骨料，展开为各个单一粗骨料
          const stoneIds = c.id.toString().split('_')
          const ratios = c.ratio || []
          stoneIds.forEach((stoneId, i) => {
            const mat = getMaterialById(stoneId)
            const ratio = ratios[i] || (1 / stoneIds.length)
            const amount = c.amount * ratio
            data.push({
              key: `stone_${stoneId}`,
              name: mat?.name || `石_${stoneId}`,
              amount: amount,
              price: mat?.price || 0,
              cost: result.materialCosts?.[`stone_${stoneId}`] || 0
            })
          })
        } else {
          // 单一粗骨料
          const mat = getMaterialById(c.id)
          data.push({
            key: `stone_${c.id}`,
            name: mat?.name || c.name || '粗骨料',
            amount: c.amount,
            price: mat?.price || 0,
            cost: result.materialCosts?.[`stone_${c.id}`] || 0
          })
        }
      })
    } else if (materialsData.stone) {
      // 单一粗骨料
      const mat = materials.find(m => m.type === '粗骨料' && m.id === formValues.stone?.[0])
      data.push({
        key: 'stone',
        name: mat?.name || '粗骨料',
        amount: materialsData.stone,
        price: mat?.price || 0,
        cost: result.materialCosts?.stone || 0
      })
    }

    // 减水剂（显示具体材料名称）
    if (materialsData.superplasticizer) {
      const spId = formValues.superplasticizer?.[0] || formValues.superplasticizer
      const mat = getMaterialById(spId)
      data.push({
        key: 'superplasticizer',
        name: mat?.name || '减水剂',
        amount: materialsData.superplasticizer,
        price: mat?.price || 0,
        cost: result.materialCosts?.superplasticizer || 0
      })
    }

    // 水
    if (materialsData.water) {
      data.push({
        key: 'water',
        name: '水',
        amount: materialsData.water,
        price: 0,
        cost: 0
      })
    }

    return data
  }

  return (
    <div className="page-container">
      <Card className="custom-card" title="成本优化配合比设计">
        <div className="optim-materials-info" style={{ color: '#666' }}>
          <Space>
            <span>本功能可自动寻找成本最优的配合比方案。原材料在左侧面板统一管理。</span>
          </Space>
        </div>

        <Form form={form} layout="vertical" className="custom-form">
          <Divider orientation="left">一类约束：性能目标</Divider>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="projectName"
                label="项目名称"
              >
                <Input placeholder="请输入项目名称" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="strength"
                label="强度等级"
                rules={[{ required: true, message: '请选择强度等级' }]}
              >
                <Select placeholder="请选择">
                  {strengthOptions.map(s => (
                    <Option key={s} value={s}>{s}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="slump"
                label="坍落度"
                rules={[{ required: true, message: '请选择坍落度' }]}
              >
                <Select placeholder="请选择">
                  {slumpOptions.map(s => (
                    <Option key={s.value} value={s.value}>{s.label}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">原材料选择</Divider>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="cement"
                label="水泥"
                rules={[{ required: true, message: '请选择水泥' }]}
              >
                {renderMaterialSelect('水泥')}
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="flyAsh"
                label="粉煤灰（可选，可多选）"
                tooltip="可选择多种粉煤灰，系统会优化组合比例"
              >
                {renderMaterialSelect('粉煤灰', 'multiple')}
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="slag"
                label="矿渣粉（可选，可多选）"
                tooltip="可选择多种矿渣粉，系统会优化组合比例"
              >
                {renderMaterialSelect('矿渣粉', 'multiple')}
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="lithiumSlag"
                label="锂渣（可选，可多选）"
                tooltip="可选择多种锂渣，系统会优化组合比例"
              >
                {renderMaterialSelect('锂渣', 'multiple')}
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="compositePowder"
                label="复合粉（可选，可多选）"
                tooltip="可选择多种复合粉，系统会优化组合比例"
              >
                {renderMaterialSelect('复合粉', 'multiple')}
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="superplasticizer"
                label="减水剂（可多选）"
                rules={[{ required: true, message: '请选择减水剂' }]}
                tooltip="可选择多种减水剂，系统会优化组合比例"
              >
                {renderMaterialSelect('减水剂', 'multiple')}
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="sand"
                label="细骨料（可多选，用于成本优化）"
                rules={[{ required: true, message: '请选择细骨料' }]}
                tooltip="选择多种细骨料时，系统会自动优化掺配比例以降低成本"
              >
                {renderMaterialSelect('细骨料', 'multiple', '请选择细骨料（可多选）')}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="stone"
                label="粗骨料（可多选）"
                rules={[{ required: true, message: '请选择粗骨料' }]}
              >
                {renderMaterialSelect('粗骨料', 'multiple', '请选择粗骨料（可多选）')}
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">二类约束：自定义限值</Divider>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name={['flyAshRange', 0]}
                label="粉煤灰掺量最小值（%）"
                initialValue={0}
                tooltip="系统将在此范围内搜索最优掺量"
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name={['flyAshRange', 1]}
                label="粉煤灰掺量最大值（%）"
                initialValue={30}
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name={['slagRange', 0]}
                label="矿渣粉掺量最小值（%）"
                initialValue={0}
                tooltip="系统将在此范围内搜索最优掺量"
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name={['slagRange', 1]}
                label="矿渣粉掺量最大值（%）"
                initialValue={20}
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name={['lithiumSlagRange', 0]}
                label="锂渣掺量最小值（%）"
                initialValue={0}
                tooltip="系统将在此范围内搜索最优掺量"
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name={['lithiumSlagRange', 1]}
                label="锂渣掺量最大值（%）"
                initialValue={20}
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name={['compositePowderRange', 0]}
                label="复合粉掺量最小值（%）"
                initialValue={0}
                tooltip="系统将在此范围内搜索最优掺量"
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name={['compositePowderRange', 1]}
                label="复合粉掺量最大值（%）"
                initialValue={20}
              >
                <InputNumber min={0} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="gridStep"
                label="网格精度（%）"
                initialValue={5}
                tooltip="数值越小精度越高，计算越慢"
              >
                <InputNumber min={1} max={10} step={1} />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          {/* 优化进度条 */}
          {optimizing && progress && (
            <div className="optim-materials-info">
              <Progress
                percent={Math.round((progress.current / progress.total) * 100)}
                status="active"
                role="status"
                aria-live="polite"
                format={(percent) => `${progress.phase || '计算中'} ${progress.current}/${progress.total} (${percent}%)`}
              />
            </div>
          )}

          <Form.Item>
            <Space direction="vertical" align="start">
              <Space>
                <Button
                  type="primary"
                  size="large"
                  onClick={handleOptimize}
                  disabled={optimizing}
                >
                  {optimizing ? '优化计算中...' : '开始优化'}
                </Button>
                {optimizing && currentTaskId && (
                  <Button
                    size="large"
                    onClick={handleCancel}
                  >
                    取消优化
                  </Button>
                )}
                {result && (
                  <Button
                    type="primary"
                    size="large"
                    onClick={handleSaveBest}
                  >
                    保存最优方案
                  </Button>
                )}
                {result && (
                  <Button
                    size="large"
                    onClick={() => {
                      setResult(null)
                      setProgress(null)
                    }}
                  >
                    清除结果
                  </Button>
                )}
              </Space>
              {progress && (
                <div className="optim-progress-info">
                  <div className="optim-progress-message">
                    {progress.message || '优化中...'} ({progress.current}/{progress.total})
                  </div>
                  <Progress percent={Math.round((progress.current / progress.total) * 100)} status="active" />
                </div>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 优化结果 */}
      {result && (
        <Card className="custom-card optim-result-card" title="最优方案" role="region" aria-label="优化结果">
          <Row gutter={16}>
            <Col span={8}>
              <div className="stat-block stat-block-cost">
                <div className="stat-block-value">
                  ¥{result.totalCost?.toFixed(2)}
                </div>
                <div className="stat-block-sub">每立方米成本</div>
              </div>
            </Col>
            <Col span={8}>
              <div className="stat-block stat-block-strength">
                <div className="stat-block-value">
                  水胶比：{result.waterRatio?.toFixed(3)}
                </div>
                <div className="stat-block-sub">砂率：{(result.sandRatio * 100)?.toFixed(1)}%</div>
              </div>
            </Col>
            <Col span={8}>
              <div className="stat-block stat-block-density">
                <div className="stat-block-value">
                  {result.density?.toFixed(0)} kg/m³
                </div>
                <div className="stat-block-sub">表观密度</div>
              </div>
            </Col>
          </Row>

          <Divider />

          <div className="optim-materials-info">
            <strong>优化参数：</strong>
            <Tag color="blue">粉煤灰 {result.params?.flyAsh || 0}%</Tag>
            <Tag color="green">矿渣粉 {result.params?.slag || 0}%</Tag>
            <Tag color="orange">砂率 {(result.sandRatio * 100)?.toFixed(1)}%</Tag>
            {result.fineAggregateBreakdown && result.fineAggregateBreakdown.length > 0 && (
              <Tag color="purple">
                {result.fineAggregateBreakdown.length === 1
                  ? result.fineAggregateBreakdown[0].name
                  : `混合砂(${result.fineAggregateBreakdown.map(f => f.name).join('+')})`}
              </Tag>
            )}
          </div>

          <div className="optim-materials-info">
            <strong>原材料信息：</strong>
            {(() => {
              const mats = result.materials || {}
              const info = []
              if (mats.cement) info.push(`水泥: ${mats.cement.toFixed(0)} kg`)
              if (mats.flyAsh > 0) info.push(`粉煤灰: ${mats.flyAsh.toFixed(0)} kg`)
              if (mats.slag > 0) info.push(`矿渣粉: ${mats.slag.toFixed(0)} kg`)
              if (result.fineAggregateBreakdown?.length > 0) {
                result.fineAggregateBreakdown.forEach(f => {
                  info.push(`${f.name}: ${f.amount.toFixed(0)} kg`)
                })
              } else if (mats.sand) {
                info.push(`砂: ${mats.sand.toFixed(0)} kg`)
              }
              if (result.coarseAggregateBreakdown?.length > 0) {
                result.coarseAggregateBreakdown.forEach(c => {
                  info.push(`${c.name}: ${c.amount.toFixed(0)} kg`)
                })
              } else if (mats.stone) {
                info.push(`石: ${mats.stone.toFixed(0)} kg`)
              }
              if (mats.superplasticizer) info.push(`减水剂: ${mats.superplasticizer.toFixed(1)} kg`)
              info.push(`水: ${mats.water.toFixed(0)} kg`)
              return info.map((item, i) => <Tag key={i}>{item}</Tag>)
            })()}
          </div>

          <Table
            size="small"
            columns={[
              { title: '材料', dataIndex: 'name', key: 'name' },
              { title: '用量 (kg/m³)', dataIndex: 'amount', key: 'amount', render: v => (v || 0).toFixed(1) },
              { title: '单价 (元/吨)', dataIndex: 'price', key: 'price', render: v => (v || 0).toFixed(0) },
              { title: '成本 (元/m³)', dataIndex: 'cost', key: 'cost', render: v => (v || 0).toFixed(2) }
            ]}
            dataSource={buildResultTableData()}
            pagination={false}
            footer={() => {
              const totalAmount = buildResultTableData().reduce((sum, item) => sum + (item.amount || 0), 0)
              return (
                <div className="optim-table-footer">
                  <span>材料用量合计：{totalAmount.toFixed(1)} kg/m³</span>
                  <span>容重：{result.density?.toFixed(1)} kg/m³</span>
                  <span>总成本：¥{result.totalCost?.toFixed(2)} /m³</span>
                </div>
              )
            }}
          />
        </Card>
      )}

    </div>
  )
}

export default OptimizationPage

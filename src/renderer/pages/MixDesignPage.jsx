import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, Table, Space, message, Modal, InputNumber, Divider } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setCalculationCache, clearCalculationCache } from '../../store/mixDesignSlice'

const { Option } = Select

const MixDesignPage = () => {
  const dispatch = useDispatch()
  const calculationCache = useSelector(state => state.mixDesign.calculationCache)

  const [form] = Form.useForm()
  const [materials, setMaterials] = useState([])
  const [calculationResult, setCalculationResult] = useState(null)
  const watchedSand = Form.useWatch ? Form.useWatch('sand', form) : null
  const watchedSandRatio = Form.useWatch ? Form.useWatch('sandRatio', form) : null
  const watchedStrength = Form.useWatch ? Form.useWatch('strength', form) : null
  const [adjustedResult, setAdjustedResult] = useState(null)
  const [seriesResults, setSeriesResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveModalVisible, setSaveModalVisible] = useState(false)
  const [advancedModalVisible, setAdvancedModalVisible] = useState(false)
  const [advancedForm] = Form.useForm()
  const [saveForm] = Form.useForm()
  const [tempSettings, setTempSettings] = useState(null)
  const [cacheRestored, setCacheRestored] = useState(false)

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
    flyAsh: '粉煤灰',
    slag: '矿渣粉',
    sand: '细骨料',
    stone: '粗骨料',
    superplasticizer: '外加剂'
  }

  // 当有计算结果且选中了两种细骨料时，实时按两砂细度模数计算占比并调整展示结果（不保存）
  useEffect(() => {
    try {
      if (!calculationResult || !materials) {
        setAdjustedResult(null)
        return
      }

      const selectedSand = Array.isArray(watchedSand) ? watchedSand : (watchedSand ? [watchedSand] : [])
      if (selectedSand.length !== 2) {
        setAdjustedResult(null)
        return
      }

      // 找到对应的材料对象
      const sandMaterials = materials.filter(m => selectedSand.some(id => String(id) === String(m.id)))
      if (sandMaterials.length !== 2) {
        setAdjustedResult(null)
        return
      }

      const fm1 = parseFloat(sandMaterials[0].finenessModulus)
      const fm2 = parseFloat(sandMaterials[1].finenessModulus)
      let r1 = null

      // 计算目标细度模数（与后端保持一致：C30 基准 + 每 5MPa 增加 0.1）
      const computeTargetFinenessModulus = (strength, tempSettings = null) => {
        try {
          const baseFm = (tempSettings && tempSettings.targetFinenessModulusBase !== undefined && tempSettings.targetFinenessModulusBase !== null)
            ? parseFloat(tempSettings.targetFinenessModulusBase)
            : 2.7
          const strengthNum = parseInt(String(strength || '').replace('C', '')) || 30
          // 以 C30 为基准，每增加 5MPa，细度模数增加 0.1（即每 1MPa 增加 0.02）
          const target = baseFm + (strengthNum - 30) * 0.02
          return Number(target.toFixed(2))
        } catch (e) {
          return 2.7
        }
      }

      const strengthForCalc = watchedStrength || form.getFieldValue('strength') || 'C30'
      const targetFM = computeTargetFinenessModulus(strengthForCalc, tempSettings)

      // 优先使用后端返回的细骨料分配比例（保证前后端算法一致）
      // 后端在有筛余数据时使用筛余合成算法，与解析解可能不同
      if (Array.isArray(calculationResult.fineAggregateBreakdown) && calculationResult.fineAggregateBreakdown.length === 2) {
        const b0 = calculationResult.fineAggregateBreakdown.find(b => String(b.id) === String(sandMaterials[0].id))
        r1 = b0 ? b0.ratio : 0.5
      } else if (Number.isFinite(fm1) && Number.isFinite(fm2) && fm1 !== fm2) {
        // 无后端分配时使用解析解（仅适用于无筛余数据的情况）
        r1 = (targetFM - fm2) / (fm1 - fm2)
      } else {
        r1 = 0.5
      }

      r1 = Math.max(0, Math.min(1, r1))
      const r2 = 1 - r1

      const totalSand = calculationResult.materials?.sand || 0
      const newMaterials = { ...calculationResult.materials }
      newMaterials[`sand_${sandMaterials[0].id}`] = totalSand * r1
      newMaterials[`sand_${sandMaterials[1].id}`] = totalSand * r2
      newMaterials.sand = totalSand

      // 重新计算细砂相关成本并更新总成本
      const baseCosts = { ...(calculationResult.materialCosts || {}) }
      // 先收集并移除旧的 sand_/stone_ 明细与汇总的 sand/stone 成本，避免重复计算
      const existingSandDetails = {}
      const existingStoneDetails = {}
      Object.keys(baseCosts).forEach(k => {
        if (k.startsWith('sand_')) { existingSandDetails[k] = baseCosts[k]; delete baseCosts[k] }
        if (k.startsWith('stone_')) { existingStoneDetails[k] = baseCosts[k]; delete baseCosts[k] }
      })
      if (baseCosts.sand !== undefined) delete baseCosts.sand
      if (baseCosts.stone !== undefined) delete baseCosts.stone

      let newTotal = 0
      // 累加非细/粗骨料成本
      Object.keys(baseCosts).forEach(k => { newTotal += baseCosts[k] || 0 })

      const newCosts = { ...baseCosts }
      const price1 = parseFloat(sandMaterials[0].price) || 0
      const price2 = parseFloat(sandMaterials[1].price) || 0

      if (price1 > 0) {
        newCosts[`sand_${sandMaterials[0].id}`] = (newMaterials[`sand_${sandMaterials[0].id}`] * price1) / 1000
        newTotal += newCosts[`sand_${sandMaterials[0].id}`]
      }
      if (price2 > 0) {
        newCosts[`sand_${sandMaterials[1].id}`] = (newMaterials[`sand_${sandMaterials[1].id}`] * price2) / 1000
        newTotal += newCosts[`sand_${sandMaterials[1].id}`]
      }
      newCosts.sand = (newCosts[`sand_${sandMaterials[0].id}`] || 0) + (newCosts[`sand_${sandMaterials[1].id}`] || 0)

      // 如果原始结果中包含粗骨料明细，保留这些明细并加入总成本（但已从 baseCosts 移除，避免重复）
      if (existingStoneDetails && Object.keys(existingStoneDetails).length > 0) {
        let stoneSum = 0
        Object.entries(existingStoneDetails).forEach(([k, v]) => {
          newCosts[k] = v
          stoneSum += v || 0
          newTotal += v || 0
        })
        newCosts.stone = stoneSum
      }

      setAdjustedResult({ ...calculationResult, materials: newMaterials, materialCosts: newCosts, totalCost: newTotal, fineAggregateBreakdown: [ { id: sandMaterials[0].id, name: sandMaterials[0].name, amount: newMaterials[`sand_${sandMaterials[0].id}`], ratio: r1 }, { id: sandMaterials[1].id, name: sandMaterials[1].name, amount: newMaterials[`sand_${sandMaterials[1].id}`], ratio: r2 } ] })
    } catch (e) {
      console.error('实时调整细骨料占比失败:', e)
      setAdjustedResult(null)
    }
  }, [calculationResult, materials, watchedSand, watchedSandRatio, watchedStrength, tempSettings])

  // 当 adjustedResult 变化时，同步到 Redux 缓存
  useEffect(() => {
    if (!cacheRestored) return // 跳过初始渲染和缓存恢复
    if (adjustedResult) {
      dispatch(setCalculationCache({
        calculationResult: calculationResult,
        adjustedResult: adjustedResult,
        seriesResults: seriesResults
      }))
    }
  }, [adjustedResult, cacheRestored])

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

  // 初始化加载 - 优先从缓存恢复状态
  useEffect(() => {
    if (calculationCache && !cacheRestored) {
      // 从 Redux 缓存恢复状态
      setCalculationResult(calculationCache.calculationResult)
      setAdjustedResult(calculationCache.adjustedResult)
      setSeriesResults(calculationCache.seriesResults)
      setCacheRestored(true)
      console.log('[MixDesignPage] 从缓存恢复状态')
    } else {
      // 无缓存，加载材料
      loadMaterials()
    }
  }, [calculationCache, cacheRestored])

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
        // 保存到 Redux 缓存
        dispatch(setCalculationCache({
          calculationResult: result.data,
          adjustedResult: null,
          seriesResults: null
        }))
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
      
      console.log('材料对象:', materialsObj)
      
      // 检查材料对象是否都存在
      for (const [key, material] of Object.entries(materialsObj)) {
        if (key === 'sand' || key === 'stone') {
          if (!material || (Array.isArray(material) && material.length === 0)) {
            throw new Error(`找不到${key}材料，请重新选择`)
          }
          // 检查价格
          if (Array.isArray(material)) {
            const materialsWithoutPrice = material.filter(m => !m.price || m.price <= 0)
            if (materialsWithoutPrice.length > 0) {
              throw new Error(`${key}材料 ${materialsWithoutPrice.map(m => m.name).join(', ')} 未设置价格，请在材料管理页面设置价格`)
            }
          } else if (!material.price || material.price <= 0) {
            throw new Error(`${key}材料 ${material.name} 未设置价格，请在材料管理页面设置价格`)
          }
        } else {
          if (!material) {
            throw new Error(`找不到${key}材料，请重新选择`)
          }
          if (!material.price || material.price <= 0) {
            throw new Error(`${key}材料 ${material.name} 未设置价格，请在材料管理页面设置价格`)
          }
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
        // 保存到 Redux 缓存
        dispatch(setCalculationCache({
          calculationResult: result.data,
          adjustedResult: null,
          seriesResults: null
        }))
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

  // 计算系列配合比（使用批量计算接口）
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
          if (Array.isArray(material)) {
            const materialsWithoutPrice = material.filter(m => !m.price || m.price <= 0)
            if (materialsWithoutPrice.length > 0) {
              throw new Error(`${key}材料 ${materialsWithoutPrice.map(m => m.name).join(', ')} 未设置价格，请在材料管理页面设置价格`)
            }
          } else if (!material.price || material.price <= 0) {
            throw new Error(`${key}材料 ${material.name} 未设置价格，请在材料管理页面设置价格`)
          }
        } else {
          if (!material) {
            throw new Error(`找不到${key}材料，请重新选择`)
          }
          if (!material.price || material.price <= 0) {
            throw new Error(`${key}材料 ${material.name} 未设置价格，请在材料管理页面设置价格`)
          }
        }
      }

      // 从 values 中移除 sand 和 stone
      const { sand, stone, ...otherValues } = values

      // 构建批量计算参数
      const baseParams = {
        ...otherValues,
        materials: materialsObj,
        tempSettings: tempSettings
      }

      console.log('调用批量计算接口...')
      const result = await window.electron.ipcRenderer.invoke('calculateSeriesMixDesign', {
        baseParams,
        strengthRange: ['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60']
      })

      if (result.success) {
        setSeriesResults(result.data)
        // 保存到 Redux 缓存
        dispatch(setCalculationCache({
          calculationResult: null,
          adjustedResult: null,
          seriesResults: result.data
        }))
        message.success('系列配合比计算成功')
      } else {
        message.error(result.error)
      }
    } catch (error) {
      console.error('系列配合比计算失败:', error)
      message.error(`系列配合比计算失败：${error.message}`)
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
    if (!calculationResult && (!seriesResults || seriesResults.length === 0)) {
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

  // 保存方案（单个或批量）
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
        sand: Array.isArray(values.sand) ? latestMaterials.filter(m => values.sand.some(sid => String(sid) === String(m.id))) : latestMaterials.find(m => m.id === values.sand),
        stone: Array.isArray(values.stone) ? latestMaterials.filter(m => values.stone.some(sid => String(sid) === String(m.id))) : latestMaterials.find(m => m.id === values.stone),
        superplasticizer: latestMaterials.find(m => m.id === values.superplasticizer)
      }

      // 检查是否保存系列配合比
      if (seriesResults && seriesResults.length > 0) {
        // 批量保存系列配合比
        const designsToSave = seriesResults.map(item => {
          const resultToSave = item.data
          return {
            ...resultToSave,
            strength: item.strength,
            materialDetails: materialsObj,
            tempSettings
          }
        })

        const result = await window.electron.ipcRenderer.invoke('batchSaveSeriesMixDesigns', {
          designs: designsToSave,
          saveValues: {
            ...saveValues,
            ...values
          }
        })

        if (result.success) {
          message.success(`批量保存成功，共保存 ${result.data.length} 个方案`)
          closeSaveModal()
        } else {
          message.error(result.error)
        }
        return
      }

      // 保存单个配合比
      const resultToSave = adjustedResult || calculationResult
      console.log('保存时使用的结果:', {
        hasMaterialCosts: !!resultToSave?.materialCosts,
        hasTotalCost: !!resultToSave?.totalCost,
        materialCosts: resultToSave?.materialCosts,
        totalCost: resultToSave?.totalCost
      })

      const mixDesignData = {
        ...saveValues,
        ...values,
        ...resultToSave,
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
    const displayResult = adjustedResult || calculationResult
    if (!displayResult || !displayResult.materials) return []
    const materialsAmounts = displayResult.materials
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
      key: 'material',
      onHeaderCell: () => ({ scope: 'col' })
    },
    {
      title: '用量',
      dataIndex: 'amount',
      key: 'amount',
      onHeaderCell: () => ({ scope: 'col' })
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      onHeaderCell: () => ({ scope: 'col' })
    }
  ]

  // 根据类型获取原材料
  const getMaterialsByType = (type) => {
    // 外加剂/减水剂类型允许匹配两种材料类型
    if (type === 'superplasticizer') {
      return materials.filter(m => m.type === '减水剂' || m.type === '外加剂')
    }
    return materials.filter(m => m.type === materialTypes[type])
  }

  const displayResult = adjustedResult || calculationResult

  return (
    <div>
      <div className="mb-lg">
        <h2 className="page-title">配合比设计</h2>
        <p className="page-subtitle">根据JGJ 55-2011标准计算混凝土配合比</p>
      </div>

      <div className="mb-lg">
        <Card className="custom-card" title="设计目标参数">
          <Form form={form} layout="vertical" initialValues={{ calculationMethod: 'absolute', targetDensity: 2400, projectType: 'civil', flyAshDosage: 20, slagDosage: 10, sandRatio: 35 }}>
            <div className="grid-2-col">
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

      <div className="mb-lg">
        <Card className="custom-card" title="原材料选择">
          <Form form={form} layout="vertical">
            <div className="grid-2-col">
              <Form.Item name="cement" label="水泥" rules={[{ required: true, message: '请选择水泥' }]}>
                <Select placeholder="请选择水泥" style={{ width: '100%' }}>
                  {getMaterialsByType('cement').map(material => (
                    <Option key={material.id} value={material.id}>{material.name}</Option>
                  ))}
                </Select>
              </Form.Item>
              
              <Form.Item name="flyAsh" label="粉煤灰">
                <Select placeholder="请选择粉煤灰" style={{ width: '100%' }}>
                  {getMaterialsByType('flyAsh').map(material => (
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
          {displayResult ? (
            <Card className="custom-card" title="计算结果">
              <Table
                dataSource={buildCalculationResult()}
                columns={columns}
                pagination={false}
                className="custom-table"
                aria-label="配合比计算结果"
              />
              <div style={{ marginTop: 24, padding: '16px', background: 'var(--bg-ash)', borderRadius: '8px' }} role="region" aria-label="配合比参数">
                <h4 style={{ marginBottom: 16, fontSize: '14px', fontWeight: '600' }}>配合比参数</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <p>配置强度f_cu,0: <strong>{String(displayResult.targetStrength || 0)} MPa</strong></p>
                  <p>水胶比: <strong>{String(displayResult.waterRatio || 0)}</strong></p>
                  <p>砂率: <strong>{String((displayResult.sandRatio || 0) * 100)}%</strong></p>
                  <p>容重: <strong>{String(displayResult.density || 0)} kg/m³</strong></p>
                  <p>减水剂掺量: <strong>{String(displayResult.superplasticizerDosage || 0)}%</strong></p>
                  <p>减水率: <strong>{String(displayResult.waterReducingRate || 0)}%</strong></p>
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
          {displayResult && displayResult.materialCosts && (
            <Card className="custom-card" title="成本分析" role="region" aria-label="成本分析">
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <p>水泥成本: <strong>{String((displayResult.materialCosts.cement || 0).toFixed(2))} 元/m³</strong></p>
                  <p>粉煤灰成本: <strong>{String((displayResult.materialCosts.flyAsh || 0).toFixed(2))} 元/m³</strong></p>
                  <p>矿渣粉成本: <strong>{String((displayResult.materialCosts.slag || 0).toFixed(2))} 元/m³</strong></p>
                  
                  {/* 处理多种细骨料的成本 */}
                  {Object.keys(displayResult.materialCosts).filter(key => key.startsWith('sand_')).map((key, index) => {
                    const materialId = key.replace('sand_', '')
                    const material = materials.find(m => m && String(m.id) === String(materialId)) || { name: `细骨料${index + 1}` }
                    return (
                      <p key={key}>{`砂 - ${material.name} 成本:`} <strong>{String((displayResult.materialCosts[key] || 0).toFixed(2))} 元/m³</strong></p>
                    )
                  })}
                  
                  {/* 处理单一细骨料的成本 */}
                  {!Object.keys(displayResult.materialCosts).some(key => key.startsWith('sand_')) && (
                    <p>砂成本: <strong>{String((displayResult.materialCosts.sand || 0).toFixed(2))} 元/m³</strong></p>
                  )}
                  
                  {/* 处理多种粗骨料的成本 */}
                  {Object.keys(displayResult.materialCosts).filter(key => key.startsWith('stone_')).map((key, index) => {
                    const materialId = key.replace('stone_', '')
                    const material = materials.find(m => m && String(m.id) === String(materialId)) || { name: `粗骨料${index + 1}` }
                    return (
                      <p key={key}>{`石 - ${material.name} 成本:`} <strong>{String((displayResult.materialCosts[key] || 0).toFixed(2))} 元/m³</strong></p>
                    )
                  })}
                  
                  {/* 处理单一粗骨料的成本 */}
                  {!Object.keys(displayResult.materialCosts).some(key => key.startsWith('stone_')) && (
                    <p>石成本: <strong>{String((displayResult.materialCosts.stone || 0).toFixed(2))} 元/m³</strong></p>
                  )}
                  
                  <p>减水剂成本: <strong>{String((displayResult.materialCosts.superplasticizer || 0).toFixed(2))} 元/m³</strong></p>
                </div>
                <Divider />
                <p style={{ fontSize: '16px', fontWeight: 'bold', textAlign: 'right' }}>总成本: <strong style={{ color: '#1890ff' }}>{String((displayResult.totalCost || 0).toFixed(2))} 元/m³</strong></p>
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
          <Divider orientation="left">细骨料参数</Divider>
          <Form.Item name="targetFinenessModulusBase" label="C30 基准目标细度模数">
            <InputNumber style={{ width: '100%' }} placeholder="默认 2.7" min={1.0} max={4.0} precision={2} />
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
                    <th style={{ padding: '12px', textAlign: 'right' }}>水泥</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>粉煤灰</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>矿渣粉</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>细骨料</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>粗骨料</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>水</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>减水剂</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>砂率</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>目标 FM</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>成本</th>
                  </tr>
                </thead>
                <tbody>
                  {seriesResults.map((item) => {
                    // 检查是否有多种细骨料
                    const sandKeys = Object.keys(item.data.materials || {}).filter(key => key.startsWith('sand_'))
                    const stoneKeys = Object.keys(item.data.materials || {}).filter(key => key.startsWith('stone_'))
                    const hasMultipleSand = sandKeys.length > 1
                    const hasMultipleStone = stoneKeys.length > 1

                    return (
                      <React.Fragment key={item.strength}>
                        <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '12px', fontWeight: 'bold' }}>{item.strength}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.cement || 0).toFixed(1)}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.flyAsh || 0).toFixed(1)}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.slag || 0).toFixed(1)}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            {hasMultipleSand ? (
                              <span style={{ color: '#1890ff', cursor: 'pointer' }} title="点击查看详情">
                                {(item.data.materials.sand || 0).toFixed(1)} (共{ sandKeys.length}种)
                              </span>
                            ) : (
                              (item.data.materials.sand || 0).toFixed(1)
                            )}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            {hasMultipleStone ? (
                              <span style={{ color: '#1890ff', cursor: 'pointer' }} title="点击查看详情">
                                {(item.data.materials.stone || 0).toFixed(1)} (共{stoneKeys.length}种)
                              </span>
                            ) : (
                              (item.data.materials.stone || 0).toFixed(1)
                            )}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.water || 0).toFixed(1)}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.materials.superplasticizer || 0).toFixed(1)}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.sandRatio * 100).toFixed(1)}</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>{(item.data.targetFinenessModulus || 0).toFixed(2)}</td>
                          <td style={{ padding: '12px', textAlign: 'right', color: '#1890ff' }}>{(item.data.totalCost || 0).toFixed(2)}</td>
                        </tr>
                        {/* 细骨料详细用量行 */}
                        {hasMultipleSand && (
                          <tr style={{ borderBottom: '1px solid #f0f0f0', backgroundColor: '#fafafa' }}>
                            <td colSpan={4} style={{ padding: '8px 12px', fontWeight: 'bold', color: '#666' }}>
                              细骨料明细：
                            </td>
                            <td colSpan={7} style={{ padding: '8px 12px' }}>
                              <Space size="large">
                                {sandKeys.map(key => {
                                  const materialId = key.replace('sand_', '')
                                  const material = materials.find(m => String(m.id) === String(materialId))
                                  return (
                                    <span key={key}>
                                      <span style={{ color: '#1890ff' }}>{material?.name || `细骨料${materialId}`}</span>
                                      : {(item.data.materials[key] || 0).toFixed(1)} kg/m³
                                      {item.data.fineAggregateBreakdown?.find(b => String(b.id) === String(materialId)) &&
                                        ` (${(item.data.fineAggregateBreakdown.find(b => String(b.id) === String(materialId)).ratio * 100).toFixed(1)}%)`
                                      }
                                    </span>
                                  )
                                })}
                              </Space>
                            </td>
                          </tr>
                        )}
                        {/* 粗骨料详细用量行 */}
                        {hasMultipleStone && (
                          <tr style={{ borderBottom: '1px solid #f0f0f0', backgroundColor: '#fafafa' }}>
                            <td colSpan={5} style={{ padding: '8px 12px', fontWeight: 'bold', color: '#666' }}>
                              粗骨料明细：
                            </td>
                            <td colSpan={6} style={{ padding: '8px 12px' }}>
                              <Space size="large">
                                {stoneKeys.map(key => {
                                  const materialId = key.replace('stone_', '')
                                  const material = materials.find(m => String(m.id) === String(materialId))
                                  return (
                                    <span key={key}>
                                      <span style={{ color: '#1890ff' }}>{material?.name || `粗骨料${materialId}`}</span>
                                      : {(item.data.materials[key] || 0).toFixed(1)} kg/m³
                                    </span>
                                  )
                                })}
                              </Space>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* 保存方案弹窗 */}
      <Modal
        className="custom-modal"
        title={seriesResults && seriesResults.length > 0 ? '批量保存系列配合比方案' : '保存配合比方案'}
        open={saveModalVisible}
        onOk={saveMixDesign}
        onCancel={closeSaveModal}
        width={600}
      >
        {seriesResults && seriesResults.length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px', backgroundColor: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 4 }}>
            <p style={{ margin: 0, color: '#0050b3' }}>
              即将批量保存 <strong>{seriesResults.length}</strong> 个系列配合比方案（C15-C60）
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#666' }}>
              每个方案将使用相同的材料配置和参数，强度等级各不相同。
            </p>
          </div>
        )}
        <Form className="custom-form" form={saveForm} layout="vertical">
          <Form.Item name="name" label="方案名称" rules={[{ required: true, message: '请输入方案名称' }]}>
            <Input placeholder={seriesResults && seriesResults.length > 0 ? '请输入方案名称前缀（如：某工程 C15-C60 系列）' : '请输入方案名称'} />
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

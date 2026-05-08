import React, { useState } from 'react'
import { Button, Upload, Form, InputNumber, Row, Col, Divider, Select, Table, Alert, Card, Tabs } from 'antd'
import { DownloadOutlined, UploadOutlined, DeleteOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import * as XLSX from 'xlsx'

// 从材料完整对象中提取AI分析所需的关键参数
export const extractMaterialInfo = (material) => {
  if (!material) return null
  const common = {
    name: material.name,
    type: material.type,
    price: material.price,
    density: material.density,
    specification: material.specification,
    manufacturer: material.manufacturer,
  }
  const type = material.type
  if (type === '水泥') {
    return {
      ...common,
      specificSurfaceArea: material.specificSurfaceArea,
      standardConsistency: material.standardConsistency,
      stability: material.stability,
      compressiveStrength3d: material.compressiveStrength3d,
      compressiveStrength28d: material.compressiveStrength28d,
      flexuralStrength3d: material.flexuralStrength3d,
      flexuralStrength28d: material.flexuralStrength28d,
      initialSettingTime: material.initialSettingTime,
      finalSettingTime: material.finalSettingTime,
      cementHeat3d: material.cementHeat3d,
      cementHeat7d: material.cementHeat7d,
      fineness: material.fineness,
      waterContent: material.waterContent,
    }
  }
  if (type === '粉煤灰') {
    return {
      ...common,
      fineness: material.fineness,
      waterDemandRatio: material.waterDemandRatio,
      lossOnIgnition: material.lossOnIgnition,
      activityIndex7d: material.activityIndex7d,
      activityIndex28d: material.activityIndex28d,
      influenceFactor_10: material.influenceFactor_10,
      influenceFactor_20: material.influenceFactor_20,
      influenceFactor_30: material.influenceFactor_30,
      influenceFactor_40: material.influenceFactor_40,
      influenceFactor_50: material.influenceFactor_50,
    }
  }
  if (type === '矿渣粉') {
    return {
      ...common,
      specificSurfaceArea: material.specificSurfaceArea,
      fluidityRatio: material.fluidityRatio,
      lossOnIgnition: material.lossOnIgnition,
      activityIndex7d: material.activityIndex7d,
      activityIndex28d: material.activityIndex28d,
      influenceFactor_10: material.influenceFactor_10,
      influenceFactor_20: material.influenceFactor_20,
      influenceFactor_30: material.influenceFactor_30,
      influenceFactor_40: material.influenceFactor_40,
      influenceFactor_50: material.influenceFactor_50,
    }
  }
  if (type === '锂渣') {
    return {
      ...common,
      specificSurfaceArea: material.specificSurfaceArea,
      fineness: material.fineness,
      lossOnIgnition: material.lossOnIgnition,
      waterDemandRatio: material.waterDemandRatio,
      activityIndex7d: material.activityIndex7d,
      activityIndex28d: material.activityIndex28d,
    }
  }
  if (type === '复合粉') {
    return {
      ...common,
      specificSurfaceArea: material.specificSurfaceArea,
      fineness: material.fineness,
      lossOnIgnition: material.lossOnIgnition,
      fluidityRatio: material.fluidityRatio,
      activityIndex7d: material.activityIndex7d,
      activityIndex28d: material.activityIndex28d,
    }
  }
  if (type === '细骨料') {
    return {
      ...common,
      finenessModulus: material.finenessModulus,
      mudContent: material.mudContent,
      clayLumpContent: material.clayLumpContent,
      mbValue: material.mbValue,
      sieve_4_75: material.sieve_4_75,
      sieve_2_36: material.sieve_2_36,
      sieve_1_18: material.sieve_1_18,
      sieve_0_60: material.sieve_0_60,
      sieve_0_30: material.sieve_0_30,
      sieve_0_15: material.sieve_0_15,
    }
  }
  if (type === '粗骨料') {
    return {
      ...common,
      grading: material.grading,
      needleFlakeContent: material.needleFlakeContent,
      crushingValue: material.crushingValue,
      mudContent: material.mudContent,
      sieve_37_5: material.sieve_37_5,
      sieve_31_5: material.sieve_31_5,
      sieve_26_5: material.sieve_26_5,
      sieve_19_0: material.sieve_19_0,
      sieve_16_0: material.sieve_16_0,
      sieve_9_50: material.sieve_9_50,
    }
  }
  if (type === '外加剂' || type === '减水剂') {
    return {
      ...common,
      waterReducingRate: material.waterReducingRate,
      solidContent: material.solidContent,
      recommendedDosage: material.recommendedDosage,
      airContent: material.airContent,
    }
  }
  return common
}

// 材料类型映射：Excel中的材料字段 -> 数据库中的材料类型
export const MATERIAL_TYPE_MAP = {
  cement: '水泥',
  flyAsh: '粉煤灰',
  slag: '矿渣粉',
  lithiumSlag: '锂渣',
  compositePowder: '复合粉',
  fineAggregate1: '细骨料',
  fineAggregate2: '细骨料',
  coarseAggregate: '粗骨料',
  waterReducer: '外加剂',
}

export const parseExcelFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })

        const sheet1Name = workbook.SheetNames.find(name => name === '配合比数据')
        const sheet1 = sheet1Name ? workbook.Sheets[sheet1Name] : null
        if (!sheet1) {
          throw new Error('未找到"配合比数据"工作表，请检查Excel文件格式')
        }
        const sheet1Data = XLSX.utils.sheet_to_json(sheet1)

        const sheet2Name = workbook.SheetNames.find(name => name === '试验结果')
        const sheet2 = sheet2Name ? workbook.Sheets[sheet2Name] : null
        const sheet2Data = sheet2 ? XLSX.utils.sheet_to_json(sheet2) : []

        if (!sheet2 || sheet2Data.length === 0) {
          console.warn('警告: 未找到"试验结果"工作表或工作表为空，试验结果将全部为零')
        }

        let unmatchedCount = 0
        const mergedData = sheet1Data.map((row1) => {
          const row2 = sheet2Data.find((r) => r['编号'] === row1['编号']) || {}
          if (Object.keys(row2).length === 0 && sheet2Data.length > 0) {
            unmatchedCount++
          }

          return {
            id: String(row1['编号'] || ''),
            strengthGrade: String(row1['强度等级'] || ''),
            water: Number(row1['用水量']) || 0,
            cement: Number(row1['水泥用量']) || 0,
            slag: Number(row1['矿渣粉用量']) || 0,
            flyAsh: Number(row1['粉煤灰用量']) || 0,
            compositePowder: Number(row1['复合粉用量']) || 0,
            lithiumSlag: Number(row1['锂渣用量']) || 0,
            fineAggregate1: Number(row1['砂1用量']) || 0,
            fineAggregate2: Number(row1['砂2用量']) || 0,
            coarseAggregate: Number(row1['碎石用量']) || 0,
            waterReducerDosage: Number(row1['减水剂掺量']) || 0,
            waterReducerAmount: Number(row1['减水剂用量']) || 0,
            waterBinderRatio: Number(row1['水胶比']) || 0,
            materials: {
              cement: String(row1['材料-水泥'] || ''),
              flyAsh: String(row1['材料-粉煤灰'] || ''),
              slag: String(row1['材料-矿渣粉'] || ''),
              lithiumSlag: String(row1['材料-锂渣'] || ''),
              compositePowder: String(row1['材料-复合粉'] || ''),
              fineAggregate1: String(row1['材料-砂1'] || ''),
              fineAggregate2: String(row1['材料-砂2'] || ''),
              coarseAggregate: String(row1['材料-碎石'] || ''),
              waterReducer: String(row1['材料-减水剂'] || ''),
            },
            testResults: {
              apparentDensity: Number(row2['表观密度']) || 0,
              initialSlump: Number(row2['初始坍落度']) || 0,
              initialSlumpFlow: Number(row2['初始扩展度']) || 0,
              initialT500: Number(row2['初始T500']) || 0,
              slump1h: Number(row2['1h坍落度']) || 0,
              slumpFlow1h: Number(row2['1h扩展度']) || 0,
              t5001h: Number(row2['1hT500']) || 0,
              slump2h: Number(row2['2h坍落度']) || 0,
              slumpFlow2h: Number(row2['2h扩展度']) || 0,
              t5002h: Number(row2['2hT500']) || 0,
              strengthR3: Number(row2['R3强度']) || 0,
              strengthR7: Number(row2['R7强度']) || 0,
              strengthR28: Number(row2['R28强度']) || 0,
              strengthR60: Number(row2['R60强度']) || 0,
            },
          }
        })

        if (unmatchedCount > 0) {
          console.warn(`警告: 有 ${unmatchedCount} 条配合比数据在试验结果中未找到匹配的编号，试验结果将为零`)
        }

        resolve(mergedData)
      } catch (error) {
        reject(error)
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

// 将分析数据格式化为 Markdown 文档
export const formatDataAsMarkdown = (data) => {
  let md = '# 配合比分析数据（上传至AI的内容）\n\n'

  md += '## 数据摘要\n\n'
  md += `| 项目 | 数值 |\n|------|------|\n`
  md += `| 配合比总数 | ${data.summary.totalMixDesigns} |\n`
  md += `| 强度等级 | ${data.summary.strengthGrades.join(', ')} |\n`
  md += `| 材料数量 | ${data.summary.totalMaterials} |\n\n`

  md += '## 分组统计（按强度等级）\n\n'
  md += '```json\n' + JSON.stringify(data.groupedStatistics, null, 2) + '\n```\n\n'

  md += '## 配合比详情\n\n'
  md += '```json\n' + JSON.stringify(data.mixDesigns, null, 2) + '\n```\n\n'

  md += '## 分析要求\n\n'
  md += '```json\n' + JSON.stringify(data.analysisRequirements, null, 2) + '\n```\n\n'

  if (data._customPrompt) {
    md += '## 用户额外提示词\n\n'
    md += data._customPrompt + '\n\n'
  }

  md += '## 完整JSON数据\n\n'
  md += '```json\n' + JSON.stringify(data, null, 2) + '\n```\n'

  return md
}

// 分组统计：按强度等级分组，计算各组试验结果的均值、极值
export const calculateGroupedStatistics = (data) => {
  const grouped = {}

  data.forEach(item => {
    const grade = item.strengthGrade
    if (!grouped[grade]) {
      grouped[grade] = {
        count: 0,
        testResults: {
          apparentDensity: { values: [] },
          initialSlump: { values: [] },
          initialSlumpFlow: { values: [] },
          initialT500: { values: [] },
          slump1h: { values: [] },
          slumpFlow1h: { values: [] },
          t5001h: { values: [] },
          slump2h: { values: [] },
          slumpFlow2h: { values: [] },
          t5002h: { values: [] },
          strengthR3: { values: [] },
          strengthR7: { values: [] },
          strengthR28: { values: [] },
          strengthR60: { values: [] }
        }
      }
    }

    grouped[grade].count++

    const tr = item.testResults || {}
    if (tr.apparentDensity) grouped[grade].testResults.apparentDensity.values.push(tr.apparentDensity)
    if (tr.initialSlump) grouped[grade].testResults.initialSlump.values.push(tr.initialSlump)
    if (tr.initialSlumpFlow) grouped[grade].testResults.initialSlumpFlow.values.push(tr.initialSlumpFlow)
    if (tr.initialT500) grouped[grade].testResults.initialT500.values.push(tr.initialT500)
    if (tr.slump1h) grouped[grade].testResults.slump1h.values.push(tr.slump1h)
    if (tr.slumpFlow1h) grouped[grade].testResults.slumpFlow1h.values.push(tr.slumpFlow1h)
    if (tr.t5001h) grouped[grade].testResults.t5001h.values.push(tr.t5001h)
    if (tr.slump2h) grouped[grade].testResults.slump2h.values.push(tr.slump2h)
    if (tr.slumpFlow2h) grouped[grade].testResults.slumpFlow2h.values.push(tr.slumpFlow2h)
    if (tr.t5002h) grouped[grade].testResults.t5002h.values.push(tr.t5002h)
    if (tr.strengthR3) grouped[grade].testResults.strengthR3.values.push(tr.strengthR3)
    if (tr.strengthR7) grouped[grade].testResults.strengthR7.values.push(tr.strengthR7)
    if (tr.strengthR28) grouped[grade].testResults.strengthR28.values.push(tr.strengthR28)
    if (tr.strengthR60) grouped[grade].testResults.strengthR60.values.push(tr.strengthR60)
  })

  Object.keys(grouped).forEach(grade => {
    Object.keys(grouped[grade].testResults).forEach(key => {
      const values = grouped[grade].testResults[key].values
      if (values.length > 0) {
        grouped[grade].testResults[key] = {
          min: Math.min(...values),
          max: Math.max(...values),
          mean: values.reduce((a, b) => a + b, 0) / values.length
        }
      } else {
        delete grouped[grade].testResults[key]
      }
    })
  })

  return grouped
}

// 默认全选的分析项
export const DEFAULT_ANALYSIS_REQUIREMENTS = {
  analyzeMaterialInfluences: true,
  analyzeMixDesignInfluences: true,
  generateOptimalMixDesign: true,
  provideSuggestions: true,
  furtherTestSuggestions: true,
}

// 构建发送给AI的分析数据
export const buildAnalysisData = (mixDesigns, currentMaterialMapping, selectedSections = null) => {
  const analysisRequirements = selectedSections || DEFAULT_ANALYSIS_REQUIREMENTS
  return {
    summary: {
      totalMixDesigns: mixDesigns.length,
      strengthGrades: [...new Set(mixDesigns.map(m => m.strengthGrade))],
      totalMaterials: Object.keys(currentMaterialMapping).length
    },
    groupedStatistics: calculateGroupedStatistics(mixDesigns),
    mixDesigns: mixDesigns.map((m) => {
      const totalAggregate = (m.fineAggregate1 || 0) + (m.fineAggregate2 || 0) + (m.coarseAggregate || 0)
      const sandRate = totalAggregate > 0
        ? parseFloat((((m.fineAggregate1 || 0) + (m.fineAggregate2 || 0)) / totalAggregate).toFixed(4))
        : 0

      const costItems = [
        { key: 'cement', usage: m.cement },
        { key: 'flyAsh', usage: m.flyAsh },
        { key: 'slag', usage: m.slag },
        { key: 'lithiumSlag', usage: m.lithiumSlag },
        { key: 'compositePowder', usage: m.compositePowder },
        { key: 'fineAggregate1', usage: m.fineAggregate1 },
        { key: 'fineAggregate2', usage: m.fineAggregate2 },
        { key: 'coarseAggregate', usage: m.coarseAggregate },
        { key: 'waterReducer', usage: m.waterReducerAmount },
      ]
      let costPerCubicMeter = 0
      const costDetail = {}
      for (const { key, usage } of costItems) {
        const material = currentMaterialMapping[m.id]?.[key]
        const price = material?.price
        if (usage && price) {
          const itemCost = parseFloat((usage * price / 1000).toFixed(2))
          costPerCubicMeter += itemCost
          costDetail[key] = { usage, price, cost: itemCost }
        }
      }
      costPerCubicMeter = parseFloat(costPerCubicMeter.toFixed(2))

      return {
        id: m.id,
        strengthGrade: m.strengthGrade,
        waterBinderRatio: m.waterBinderRatio,
        cement: m.cement,
        water: m.water,
        slag: m.slag,
        flyAsh: m.flyAsh,
        compositePowder: m.compositePowder,
        lithiumSlag: m.lithiumSlag,
        fineAggregate1: m.fineAggregate1,
        fineAggregate2: m.fineAggregate2,
        coarseAggregate: m.coarseAggregate,
        waterReducerDosage: m.waterReducerDosage,
        waterReducerAmount: m.waterReducerAmount,
        sandRate: sandRate,
        costPerCubicMeter: costPerCubicMeter,
        costDetail: costDetail,
        materials: Object.fromEntries(
          (() => {
            const allKeys = new Set([
              ...Object.keys(m.materials || {}),
              ...Object.keys(currentMaterialMapping[m.id] || {})
            ])
            return [...allKeys].map(key => {
              const value = m.materials?.[key] || ''
              const mapped = currentMaterialMapping[m.id]?.[key]
              if (mapped) {
                const info = extractMaterialInfo(mapped)
                info.name = value || info.name
                return [key, info]
              }
              return [key, { name: value }]
            })
          })()
        ),
        testResults: m.testResults || {}
      }
    }),
    analysisRequirements
  }
}

// 下载Excel模板
export const handleDownloadTemplate = () => {
  const { message } = require('antd')
  try {
    const templateData = [
      {
        '编号': 'M001',
        '强度等级': 'C30',
        '用水量': 165,
        '水泥用量': 280,
        '粉煤灰用量': 60,
        '矿渣粉用量': 0,
        '复合粉用量': 0,
        '锂渣用量': 0,
        '砂1用量': 700,
        '砂2用量': 100,
        '碎石用量': 1050,
        '减水剂掺量': 1.8,
        '减水剂用量': 6.12,
        '水胶比': 0.49,
        '材料-水泥': 'P.O 42.5',
        '材料-粉煤灰': 'I级粉煤灰',
        '材料-矿渣粉': '',
        '材料-锂渣': '',
        '材料-复合粉': '',
        '材料-砂1': '河砂',
        '材料-砂2': '机制砂',
        '材料-碎石': '5-25mm',
        '材料-减水剂': '聚羧酸减水剂'
      },
      {
        '编号': 'M002',
        '强度等级': 'C30',
        '用水量': 160,
        '水泥用量': 260,
        '粉煤灰用量': 80,
        '矿渣粉用量': 0,
        '复合粉用量': 0,
        '锂渣用量': 0,
        '砂1用量': 680,
        '砂2用量': 120,
        '碎石用量': 1060,
        '减水剂掺量': 2.0,
        '减水剂用量': 6.8,
        '水胶比': 0.47,
        '材料-水泥': 'P.O 42.5',
        '材料-粉煤灰': 'II级粉煤灰',
        '材料-矿渣粉': '',
        '材料-锂渣': '',
        '材料-复合粉': '',
        '材料-砂1': '河砂',
        '材料-砂2': '机制砂',
        '材料-碎石': '5-25mm',
        '材料-减水剂': '聚羧酸减水剂'
      }
    ]

    const testResultData = [
      {
        '编号': 'M001',
        '表观密度': 2380,
        '初始坍落度': 200,
        '初始扩展度': 500,
        '初始T500': 5,
        '1h坍落度': 190,
        '1h扩展度': 460,
        '1hT500': 6,
        '2h坍落度': 180,
        '2h扩展度': 420,
        '2hT500': 8,
        'R3强度': 25.5,
        'R7强度': 32.8,
        'R28强度': 42.5,
        'R60强度': 48.2
      },
      {
        '编号': 'M002',
        '表观密度': 2390,
        '初始坍落度': 210,
        '初始扩展度': 520,
        '初始T500': 4.5,
        '1h坍落度': 200,
        '1h扩展度': 480,
        '1hT500': 5.5,
        '2h坍落度': 185,
        '2h扩展度': 440,
        '2hT500': 7,
        'R3强度': 27.2,
        'R7强度': 35.1,
        'R28强度': 44.8,
        'R60强度': 50.5
      }
    ]

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(templateData)
    XLSX.utils.book_append_sheet(wb, ws1, '配合比数据')
    const ws2 = XLSX.utils.json_to_sheet(testResultData)
    XLSX.utils.book_append_sheet(wb, ws2, '试验结果')
    XLSX.writeFile(wb, '配合比分析模板.xlsx')
    message.success('模板已下载：配合比分析模板.xlsx')
  } catch (error) {
    message.error('模板下载失败')
  }
}

// 自动匹配材料
export const autoMatchMaterials = (mixDesignsData, materials) => {
  const newMapping = {}
  const unmatchedMaterials = new Set()

  for (const mix of mixDesignsData) {
    const mapping = {}
    for (const [key, materialName] of Object.entries(mix.materials)) {
      if (materialName) {
        const type = MATERIAL_TYPE_MAP[key]
        if (type) {
          const matched = matchMaterialByName(materials, type, materialName)
          if (matched) {
            mapping[key] = matched
          } else {
            unmatchedMaterials.add(`${materialName}(${type})`)
            mapping[key] = null
          }
        }
      }
    }
    newMapping[mix.id] = mapping
  }

  return { newMapping, unmatchedMaterials }
}

/**
 * AI分析页面 - 数据导入/处理部分
 * 包含：Excel导入、手动输入、数据列表、数据处理
 */
const AIAnalysisPage_Upload = ({
  mixDesigns,
  setMixDesigns,
  materials,
  setMaterials,
  materialMapping,
  setMaterialMapping,
  loading,
  setLoading,
  processedData,
  setProcessedData,
  processingData,
  setProcessingData,
  selectedSections,
  setSelectedSections,
  customPrompt,
  setCustomPrompt,
  onProcessData,
  showDataListOnly,
  showDataProcessingOnly,
}) => {
  const [form] = Form.useForm()
  const [internalActiveKey, setInternalActiveKey] = useState('data-import')

  // Determine which tab to show
  const activeKey = showDataListOnly ? 'data-list' : showDataProcessingOnly ? 'data-processing' : internalActiveKey

  // 处理Excel导入
  const handleImportExcel = async (file) => {
    const { message } = require('antd')
    const isExcel = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel'
    if (!isExcel) {
      message.error('只能上传 Excel 文件 (.xlsx, .xls)')
      return false
    }

    setLoading(true)
    try {
      const data = await parseExcelFile(file)
      setMixDesigns(data)
      // 自动匹配材料
      const { newMapping, unmatchedMaterials } = autoMatchMaterials(data, materials)
      setMaterialMapping(newMapping)
      if (unmatchedMaterials.size > 0) {
        message.warning(`有 ${unmatchedMaterials.size} 种材料未能自动匹配：${Array.from(unmatchedMaterials).join('、')}`)
      }
      message.success(`成功导入 ${data.length} 条配合比数据`)
    } catch (error) {
      message.error('Excel文件解析失败：' + error.message)
    } finally {
      setLoading(false)
    }
    return false
  }

  // 处理材料选择变化
  const handleMaterialChange = (mixDesignId, materialKey, materialId) => {
    const material = materials.find(m => m.id === materialId)
    setMaterialMapping(prev => ({
      ...prev,
      [mixDesignId]: {
        ...prev[mixDesignId],
        [materialKey]: material || null
      }
    }))
  }

  // 手动添加配合比数据
  const handleManualAdd = (values) => {
    const { message } = require('antd')
    const newMixDesign = {
      id: `manual-${Date.now()}`,
      strengthGrade: values.strengthGrade || 'C30',
      water: values.water || 0,
      cement: values.cement || 0,
      slag: values.slag || 0,
      flyAsh: values.flyAsh || 0,
      compositePowder: values.compositePowder || 0,
      lithiumSlag: values.lithiumSlag || 0,
      fineAggregate1: values.fineAggregate1 || 0,
      fineAggregate2: values.fineAggregate2 || 0,
      coarseAggregate: values.coarseAggregate || 0,
      waterReducerDosage: values.waterReducerDosage || 0,
      waterReducerAmount: values.waterReducerAmount || 0,
      waterBinderRatio: values.waterBinderRatio || 0,
      materials: {
        cement: values.materialCement || '',
        flyAsh: values.materialFlyAsh || '',
        slag: values.materialSlag || '',
        lithiumSlag: values.materialLithiumSlag || '',
        compositePowder: values.materialCompositePowder || '',
        fineAggregate1: values.materialFineAggregate1 || '',
        fineAggregate2: values.materialFineAggregate2 || '',
        coarseAggregate: values.materialCoarseAggregate || '',
        waterReducer: values.materialWaterReducer || ''
      },
      testResults: {
        apparentDensity: values.apparentDensity || 0,
        initialSlump: values.initialSlump || 0,
        initialSlumpFlow: values.initialSlumpFlow || 0,
        initialT500: values.initialT500 || 0,
        slump1h: values.slump1h || 0,
        slumpFlow1h: values.slumpFlow1h || 0,
        t5001h: values.t5001h || 0,
        slump2h: values.slump2h || 0,
        slumpFlow2h: values.slumpFlow2h || 0,
        t5002h: values.t5002h || 0,
        strengthR3: values.strengthR3 || 0,
        strengthR7: values.strengthR7 || 0,
        strengthR28: values.strengthR28 || 0,
        strengthR60: values.strengthR60 || 0
      }
    }

    setMixDesigns([...mixDesigns, newMixDesign])
    message.success('配合比数据添加成功')
    form.resetFields()
  }

  const handleDeleteRow = (id) => {
    const { message } = require('antd')
    setMixDesigns(prev => prev.filter(item => item.id !== id))
    setMaterialMapping(prev => {
      const updated = { ...prev }
      delete updated[id]
      return updated
    })
    message.success('已删除该条数据')
  }

  // 数据列表列定义
  const materialKeys = [
    { key: 'cement', label: '水泥', type: '水泥' },
    { key: 'flyAsh', label: '粉煤灰', type: '粉煤灰' },
    { key: 'slag', label: '矿渣粉', type: '矿渣粉' },
    { key: 'lithiumSlag', label: '锂渣', type: '锂渣' },
    { key: 'compositePowder', label: '复合粉', type: '复合粉' },
    { key: 'fineAggregate1', label: '砂1', type: '细骨料' },
    { key: 'fineAggregate2', label: '砂2', type: '细骨料' },
    { key: 'coarseAggregate', label: '碎石', type: '粗骨料' },
    { key: 'waterReducer', label: '减水剂', type: '外加剂' },
  ]

  const dataListColumns = [
    {
      title: '编号',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '强度等级',
      dataIndex: 'strengthGrade',
      key: 'strengthGrade',
      width: 100,
    },
    {
      title: '水胶比',
      dataIndex: 'waterBinderRatio',
      key: 'waterBinderRatio',
      width: 80,
    },
    ...materialKeys.map(({ key, label, type }) => ({
      title: label,
      key: `material_${key}`,
      width: 180,
      render: (_, record) => {
        const mapping = materialMapping[record.id] || {}
        const currentMaterial = mapping[key]
        const options = getMaterialsByType(materials, type)

        return (
          <Select
            value={currentMaterial?.id}
            onChange={(value) => handleMaterialChange(record.id, key, value)}
            placeholder={`选择${label}`}
            allowClear
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="children"
            filterOption={(input, option) =>
              option.children?.toLowerCase?.().includes?.(input.toLowerCase()) ?? true
            }
            options={options.map(mat => ({
              value: mat.id,
              label: `${mat.name} - ${mat.manufacturer || '未知厂家'}`
            }))}
          />
        )
      }
    })),
    {
      title: '水泥用量',
      dataIndex: 'cement',
      key: 'cement',
      width: 100,
    },
    {
      title: '矿渣粉用量',
      dataIndex: 'slag',
      key: 'slag',
      width: 100,
    },
    {
      title: '锂渣用量',
      dataIndex: 'lithiumSlag',
      key: 'lithiumSlag',
      width: 100,
    },
    {
      title: '复合粉用量',
      dataIndex: 'compositePowder',
      key: 'compositePowder',
      width: 100,
    },
    {
      title: '粉煤灰用量',
      dataIndex: 'flyAsh',
      key: 'flyAsh',
      width: 100,
    },
    {
      title: '砂1用量',
      dataIndex: 'fineAggregate1',
      key: 'fineAggregate1',
      width: 100,
    },
    {
      title: '砂2用量',
      dataIndex: 'fineAggregate2',
      key: 'fineAggregate2',
      width: 100,
    },
    {
      title: '碎石用量',
      dataIndex: 'coarseAggregate',
      key: 'coarseAggregate',
      width: 100,
    },
    {
      title: '减水剂用量',
      dataIndex: 'waterReducerAmount',
      key: 'waterReducerAmount',
      width: 100,
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_, record) => (
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => handleDeleteRow(record.id)}
        />
      ),
    },
  ]

  const tabItems = [
    {
      key: 'data-import',
      label: '数据导入',
      children: (
        <div className="p-lg">
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownloadTemplate}
            style={{ marginBottom: '16px' }}
          >
            下载Excel模板
          </Button>

          <div style={{ marginTop: '16px' }}>
            <Upload
              accept=".xlsx,.xls"
              showUploadList={true}
              beforeUpload={handleImportExcel}
            >
              <Button icon={<UploadOutlined />} loading={loading}>选择Excel文件</Button>
            </Upload>
          </div>

          {mixDesigns.length > 0 && (
            <div style={{ marginTop: '16px', color: '#52c41a' }}>
              已导入 {mixDesigns.length} 条数据
            </div>
          )}

          <Divider>或手动输入配合比数据</Divider>

          <Form
            className="custom-form"
            layout="vertical"
            form={form}
            onFinish={handleManualAdd}
            initialValues={{
              strengthGrade: 'C30',
              water: 165,
              cement: 280,
              slag: 0,
              flyAsh: 0,
              compositePowder: 0,
              lithiumSlag: 0,
              fineAggregate1: 700,
              fineAggregate2: 0,
              coarseAggregate: 1050,
              waterReducerDosage: 1.8,
              waterReducerAmount: 6.12,
              waterBinderRatio: 0.49,
              apparentDensity: 2380,
              initialSlump: 200,
              initialSlumpFlow: 500,
              initialT500: 5,
              slump1h: 190,
              slumpFlow1h: 460,
              t5001h: 6,
              slump2h: 180,
              slumpFlow2h: 420,
              t5002h: 8,
              strengthR3: 27,
              strengthR7: 35,
              strengthR28: 43,
              strengthR60: 50
            }}
          >
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="strengthGrade" label="强度等级">
                  <Select options={[
                    { value: 'C20', label: 'C20' },
                    { value: 'C25', label: 'C25' },
                    { value: 'C30', label: 'C30' },
                    { value: 'C35', label: 'C35' },
                    { value: 'C40', label: 'C40' },
                    { value: 'C45', label: 'C45' },
                    { value: 'C50', label: 'C50' },
                  ]} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="water" label="用水量 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="cement" label="水泥用量 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name="flyAsh" label="粉煤灰 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="slag" label="矿渣粉 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="compositePowder" label="复合粉 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="lithiumSlag" label="锂渣 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="fineAggregate1" label="砂1用量 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="fineAggregate2" label="砂2用量 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="coarseAggregate" label="碎石用量 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="waterReducerDosage" label="减水剂掺量 (%)">
                  <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="waterReducerAmount" label="减水剂用量 (kg/m³)">
                  <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="waterBinderRatio" label="水胶比">
                  <InputNumber min={0} max={1} precision={3} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Divider>试验结果</Divider>

            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name="apparentDensity" label="表观密度 (kg/m³)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="initialSlump" label="初始坍落度 (mm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="initialSlumpFlow" label="初始扩展度 (mm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="initialT500" label="初始T500 (s)">
                  <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="slump1h" label="1h坍落度 (mm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="slumpFlow1h" label="1h扩展度 (mm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="t5001h" label="1h T500 (s)">
                  <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="slump2h" label="2h坍落度 (mm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="slumpFlow2h" label="2h扩展度 (mm)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="t5002h" label="2h T500 (s)">
                  <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name="strengthR3" label="R3强度 (MPa)">
                  <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="strengthR7" label="R7强度 (MPa)">
                  <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="strengthR28" label="R28强度 (MPa)" rules={[{ required: true, message: '请输入R28强度' }]}>
                  <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="strengthR60" label="R60强度 (MPa)">
                  <InputNumber min={0} precision={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                添加配合比
              </Button>
            </Form.Item>
          </Form>
        </div>
      ),
    },
    {
      key: 'data-list',
      label: '数据列表',
      children: (
        <div>
          {mixDesigns.length > 0 ? (
            <Table
              className="custom-table"
              columns={dataListColumns}
              dataSource={mixDesigns}
              rowKey="id"
              scroll={{ x: 1600 }}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`
              }}
            />
          ) : (
            <p style={{ color: '#999' }}>请先在"数据导入"标签页导入Excel文件</p>
          )}
        </div>
      ),
    },
    {
      key: 'data-processing',
      label: '数据处理',
      children: (
        <div>
          <div className="mb-m">
            <Button
              type="primary"
              size="large"
              onClick={onProcessData}
              loading={processingData}
              disabled={mixDesigns.length === 0}
            >
              {processingData ? '处理中...' : '处理数据'}
            </Button>
            {mixDesigns.length === 0 && (
              <span className="ml-m text-tertiary">
                请先在"数据导入"中导入配合比数据
              </span>
            )}
          </div>
          {processedData ? (
            <Card className="custom-card" title="处理后数据预览">
              <div className="markdown-body">
                <ReactMarkdown>{processedData}</ReactMarkdown>
              </div>
            </Card>
          ) : (
            <Alert
              type="info"
              showIcon
              message={'点击"处理数据"按钮，查看将要上传给AI的完整数据内容'}
              description={'数据处理会将当前配合比数据、材料信息、成本计算等内容提取为与发送给AI一致的格式。'}
            />
          )}
        </div>
      ),
    },
  ]

  // 数据列表部分
  const DataListContent = () => (
    <div>
      {mixDesigns.length > 0 ? (
        <Table
          className="custom-table"
          columns={dataListColumns}
          dataSource={mixDesigns}
          rowKey="id"
          scroll={{ x: 1600 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`
          }}
        />
      ) : (
        <p style={{ color: '#999' }}>请先在"数据导入"标签页导入Excel文件</p>
      )}
    </div>
  )

  // 数据处理部分
  const DataProcessingContent = () => (
    <div>
      <div className="mb-m">
        <Button
          type="primary"
          size="large"
          onClick={onProcessData}
          loading={processingData}
          disabled={mixDesigns.length === 0}
        >
          {processingData ? '处理中...' : '处理数据'}
        </Button>
        {mixDesigns.length === 0 && (
          <span className="ml-m text-tertiary">
            请先在"数据导入"中导入配合比数据
          </span>
        )}
      </div>
      {processedData ? (
        <Card className="custom-card" title="处理后数据预览">
          <div className="markdown-body">
            <ReactMarkdown>{processedData}</ReactMarkdown>
          </div>
        </Card>
      ) : (
        <Alert
          type="info"
          showIcon
          message={'点击"处理数据"按钮，查看将要上传给AI的完整数据内容'}
          description={'数据处理会将当前配合比数据、材料信息、成本计算等内容提取为与发送给AI一致的格式。'}
        />
      )}
    </div>
  )

  // 如果指定了只显示某个部分
  if (showDataListOnly) {
    return <DataListContent />
  }
  if (showDataProcessingOnly) {
    return <DataProcessingContent />
  }

  return (
    <div className="upload-section">
      <Tabs
        activeKey={activeKey}
        onChange={(key) => setInternalActiveKey(key)}
        items={tabItems}
        size="large"
      />
    </div>
  )
}

export default AIAnalysisPage_Upload
/**
 * 配合比数据解析工具（从 AIAnalysisPage_Upload 迁移）
 *
 * 提供 Excel 解析、材料自动匹配、构建 AI 分析数据等能力。
 * 供 SmartDesignChat 处理 Excel 附件时使用。
 */

import * as XLSX from 'xlsx'
import { matchMaterialByName } from '../services/MaterialService'

// === 内部辅助函数 ===

/**
 * 从材料完整对象中提取关键参数（按材料类型分别抽取）
 */
function extractMaterialInfo(material) {
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

/**
 * 分组统计：按强度等级分组，计算各组试验结果的均值、极值
 */
function calculateGroupedStatistics(data) {
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
          slumpFlow1h: { values: [] },
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
    if (tr.slumpFlow1h) grouped[grade].testResults.slumpFlow1h.values.push(tr.slumpFlow1h)
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

// === 导出常量 ===

/**
 * 材料类型映射：Excel 中的材料字段 → 数据库中的材料类型
 */
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

/**
 * 默认全选的分析项
 */
export const DEFAULT_ANALYSIS_REQUIREMENTS = {
  analyzeMaterialInfluences: true,
  analyzeMixDesignInfluences: true,
  generateOptimalMixDesign: true,
  provideSuggestions: true,
  furtherTestSuggestions: true,
}

// === 导出函数 ===

/**
 * 解析 Excel 配合比数据文件
 * 期望包含"配合比数据"和"试验结果"两个工作表，按"编号"关联
 */
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

/**
 * 构建发送给 AI 的分析数据
 */
export const buildAnalysisData = (mixDesigns, currentMaterialMapping, selectedSections = null) => {
  const analysisRequirements = selectedSections || DEFAULT_ANALYSIS_REQUIREMENTS
  return {
    summary: {
      totalMixDesigns: mixDesigns.length,
      strengthGrades: [...new Set(mixDesigns.map(m => m.strengthGrade))],
      totalMaterials: Object.keys(currentMaterialMapping).length
    },
    groupedStatistics: calculateGroupedStatistics(mixDesigns),
    materialMapping: currentMaterialMapping,
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

/**
 * 自动匹配材料：按 mixDesignsData 中的材料名 + 类型，从 materials 中找匹配项
 * @returns {{ newMapping: Object, unmatchedMaterials: Set<string> }}
 */
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

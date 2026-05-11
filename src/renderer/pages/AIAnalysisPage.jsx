import React, { useState, useEffect, useRef } from 'react'
import { Tabs, Button, message, Upload, Table, Select, Space, Card, Tag, Alert, Descriptions, Divider, Form, InputNumber, Row, Col, Input, List, Avatar, Checkbox } from 'antd'
import { DownloadOutlined, UploadOutlined, ExperimentOutlined, SettingOutlined, SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, DeleteOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import * as XLSX from 'xlsx'
import { getMaterialsByType, getAllMaterials, matchMaterialByName } from '../services/MaterialService'
import ToolCallBubble from '../components/ToolCallBubble'
import MixDesignResultCard from '../components/MixDesignResultCard'
import OptimizationResultCard from '../components/OptimizationResultCard'
import MaterialCompareCard from '../components/MaterialCompareCard'
import DiagnosisResultCard from '../components/DiagnosisResultCard'
import SmartDesignChat from '../components/SmartDesignChat'
import StandardsManager from '../components/StandardsManager'
import AIAnalysisPage_Upload from './AIAnalysisPage_Upload'
import AIAnalysisPage_Results from './AIAnalysisPage_Results'

// 从材料完整对象中提取AI分析所需的关键参数
const extractMaterialInfo = (material) => {
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
const MATERIAL_TYPE_MAP = {
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

// 将分析数据格式化为 Markdown 文档
const formatDataAsMarkdown = (data) => {
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
const calculateGroupedStatistics = (data) => {
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
const DEFAULT_ANALYSIS_REQUIREMENTS = {
  analyzeMaterialInfluences: true,
  analyzeMixDesignInfluences: true,
  generateOptimalMixDesign: true,
  provideSuggestions: true,
  furtherTestSuggestions: true,
}

// 构建发送给AI的分析数据
const buildAnalysisData = (mixDesigns, currentMaterialMapping, selectedSections = null) => {
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

// AI分析报告组件
const AnalysisReport = ({ result }) => {
  if (!result) return null
  const isFlatMaterial = result.materialInfluenceAnalysis?.length > 0 && !result.materialInfluenceAnalysis[0].findings
  const isFlatMix = result.mixDesignInfluenceAnalysis?.length > 0 && !result.mixDesignInfluenceAnalysis[0].findings

  return (
    <div className="analysis-report fade-in">
      {result.materialInfluenceAnalysis && result.materialInfluenceAnalysis.length > 0 && (
        <Card className="custom-card mb-m" title={<><ExperimentOutlined /> 材料性能影响分析</>}>
          {isFlatMaterial
            ? result.materialInfluenceAnalysis.map((item, index) => (
                <Alert
                  key={index}
                  type={item.direction === '正相关' ? 'success' : 'warning'}
                  showIcon
                  icon={<SettingOutlined />}
                  message={
                    <span>
                      <Tag color={item.direction === '正相关' ? 'green' : 'orange'}>{item.direction}</Tag>
                      <strong>{item.material}</strong> - {item.parameter}
                      <span className="ml-m">→ 影响{item.affectedProperty}</span>
                    </span>
                  }
                  description={item.description}
                  className="mb-alert"
                />
              ))
            : result.materialInfluenceAnalysis.map((group, gIdx) => (
                <div key={gIdx} className="mb-m">
                  <Divider orientation="left">
                    <Space>
                      <Tag color="blue">{group.strengthGrade}</Tag>
                      <Tag color="purple">{group.analysisPath}</Tag>
                    </Space>
                  </Divider>
                  {group.materialComparison && (
                    <Alert type="info" showIcon message="材料选择对比" description={group.materialComparison} className="mb-sm" />
                  )}
                  {group.findings && group.findings.map((item, fIdx) => (
                    <Alert
                      key={fIdx}
                      type={item.direction === '正相关' ? 'success' : 'warning'}
                      showIcon
                      message={
                        <span>
                          <Tag color={item.direction === '正相关' ? 'green' : 'orange'}>{item.direction}</Tag>
                          <strong>{item.material}</strong> - {item.parameter}
                          <span className="ml-m">→ 影响{item.affectedProperty}</span>
                          {item.influence != null && <span className="ml-m">（程度: {item.influence}）</span>}
                        </span>
                      }
                      description={
                        <div>
                          {item.materialNameA && item.materialNameB && (
                            <p><strong>{item.materialNameA}</strong> vs <strong>{item.materialNameB}</strong>：{item.difference}</p>
                          )}
                          <p>{item.description}</p>
                        </div>
                      }
                      className="mb-alert"
                    />
                  ))}
                </div>
              ))}
        </Card>
      )}

      {result.mixDesignInfluenceAnalysis && result.mixDesignInfluenceAnalysis.length > 0 && (
        <Card className="custom-card mb-m" title="配合比参数影响分析">
          {isFlatMix
            ? result.mixDesignInfluenceAnalysis.map((item, index) => (
                <Alert
                  key={index}
                  type={item.direction === '正相关' ? 'success' : 'warning'}
                  showIcon
                  message={
                    <span>
                      <Tag color={item.direction === '正相关' ? 'green' : 'orange'}>{item.direction}</Tag>
                      <strong>{item.param}</strong>
                      <span className="ml-m">→ 影响{item.affectedProperty}</span>
                    </span>
                  }
                  description={item.description}
                  className="mb-alert"
                />
              ))
            : result.mixDesignInfluenceAnalysis.map((group, gIdx) => (
                <div key={gIdx} className="mb-m">
                  <Divider orientation="left">
                    <Tag color="blue">{group.strengthGrade}</Tag>
                  </Divider>
                  {group.findings && group.findings.map((item, fIdx) => (
                    <Alert
                      key={fIdx}
                      type={item.direction === '正相关' ? 'success' : 'warning'}
                      showIcon
                      message={
                        <span>
                          <Tag color={item.direction === '正相关' ? 'green' : 'orange'}>{item.direction}</Tag>
                          <strong>{item.param}</strong>
                          <span className="ml-m">→ 影响{item.affectedProperty}</span>
                          {item.influence != null && <span className="ml-m">（程度: {item.influence}）</span>}
                        </span>
                      }
                      description={
                        <div>
                          <p>{item.description}</p>
                          {item.quantification && <p><strong>量化关系：</strong>{item.quantification}</p>}
                          {item.crossGradeComparison && <p><strong>跨等级对比：</strong>{item.crossGradeComparison}</p>}
                        </div>
                      }
                      className="mb-alert"
                    />
                  ))}
                </div>
              ))}
        </Card>
      )}

      {result.optimalMixDesignRecommendation && (
        <Card className="custom-card mb-m" title="最优配合比设计（预测）">
          {result.optimalMixDesignRecommendation.configurationStrength && (
            <Alert type="info" showIcon message="配制强度" description={result.optimalMixDesignRecommendation.configurationStrength} style={{ marginBottom: 12 }} />
          )}
          {result.optimalMixDesignRecommendation.optimizationGoal && (
            <Alert type="info" showIcon message="优化目标" description={result.optimalMixDesignRecommendation.optimizationGoal} style={{ marginBottom: 12 }} />
          )}
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="强度等级" span={2}>
              <Tag color="blue">{result.optimalMixDesignRecommendation.strengthGrade}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="用水量">{result.optimalMixDesignRecommendation.mixDesign?.water} kg/m³</Descriptions.Item>
            <Descriptions.Item label="水泥用量">{result.optimalMixDesignRecommendation.mixDesign?.cement} kg/m³</Descriptions.Item>
            <Descriptions.Item label="粉煤灰">{result.optimalMixDesignRecommendation.mixDesign?.flyAsh} kg/m³</Descriptions.Item>
            <Descriptions.Item label="矿渣粉">{result.optimalMixDesignRecommendation.mixDesign?.slag} kg/m³</Descriptions.Item>
            <Descriptions.Item label="锂渣">{result.optimalMixDesignRecommendation.mixDesign?.lithiumSlag} kg/m³</Descriptions.Item>
            <Descriptions.Item label="复合粉">{result.optimalMixDesignRecommendation.mixDesign?.compositePowder} kg/m³</Descriptions.Item>
            <Descriptions.Item label="砂1">{result.optimalMixDesignRecommendation.mixDesign?.fineAggregate1} kg/m³</Descriptions.Item>
            <Descriptions.Item label="砂2">{result.optimalMixDesignRecommendation.mixDesign?.fineAggregate2} kg/m³</Descriptions.Item>
            <Descriptions.Item label="碎石">{result.optimalMixDesignRecommendation.mixDesign?.coarseAggregate} kg/m³</Descriptions.Item>
            <Descriptions.Item label="减水剂掺量">{result.optimalMixDesignRecommendation.mixDesign?.waterReducerDosage}%</Descriptions.Item>
            <Descriptions.Item label="减水剂用量">{result.optimalMixDesignRecommendation.mixDesign?.waterReducerAmount} kg/m³</Descriptions.Item>
            <Descriptions.Item label="水胶比">{result.optimalMixDesignRecommendation.mixDesign?.waterBinderRatio}</Descriptions.Item>
            <Descriptions.Item label="砂率">{result.optimalMixDesignRecommendation.mixDesign?.sandRate}</Descriptions.Item>
            <Descriptions.Item label="预期坍落度">{result.optimalMixDesignRecommendation.expectedPerformance?.slump} mm</Descriptions.Item>
            <Descriptions.Item label="预期扩展度">{result.optimalMixDesignRecommendation.expectedPerformance?.slumpFlow} mm</Descriptions.Item>
            <Descriptions.Item label="预期28d强度">{result.optimalMixDesignRecommendation.expectedPerformance?.strength28d} MPa</Descriptions.Item>
            <Descriptions.Item label="预期成本" span={2}>¥{result.optimalMixDesignRecommendation.expectedPerformance?.costPerCubicMeter}/m³</Descriptions.Item>
          </Descriptions>

          {result.optimalMixDesignRecommendation.predictionBasis && (
            <>
              <Divider />
              <Alert type="info" showIcon message="预测依据" description={result.optimalMixDesignRecommendation.predictionBasis} />
            </>
          )}

          {result.optimalMixDesignRecommendation.optimizationRationale && (
            <>
              <Divider />
              <Alert type="info" showIcon message="优化依据" description={result.optimalMixDesignRecommendation.optimizationRationale} />
            </>
          )}

          {result.optimalMixDesignRecommendation.comparisonWithExisting && (
            <>
              <Divider orientation="left">与现有配合比对比</Divider>
              {result.optimalMixDesignRecommendation.comparisonWithExisting.map((comp, index) => (
                <Alert
                  key={index}
                  type="success"
                  showIcon
                  message={`配合比 ${comp.id}`}
                  description={`28d强度: ${comp.strength28d} MPa | 成本: ¥${comp.cost}/m³ | ${comp.advantage}`}
                  className="mb-sm"
                />
              ))}
            </>
          )}

          {result.optimalMixDesignRecommendation.feasibilityNote && (
            <>
              <Divider />
              <Alert type="warning" showIcon message="可行性说明" description={result.optimalMixDesignRecommendation.feasibilityNote} />
            </>
          )}
        </Card>
      )}

      {result.adjustmentSuggestions && result.adjustmentSuggestions.length > 0 && (
        <Card className="custom-card mb-m" title="参数调整建议">
          {result.adjustmentSuggestions.map((item, index) => (
            <Alert
              key={index}
              type={item.severity === '严重' ? 'error' : 'warning'}
              showIcon
              message={
                <span>
                  <Tag color={item.priority === '高' ? 'red' : item.priority === '中' ? 'orange' : 'default'}>
                    {item.priority || '未标注'}优先级
                  </Tag>
                  <Tag color={item.severity === '严重' ? 'red' : 'orange'}>{item.severity || item.category}</Tag>
                  {item.problem || item.category}
                </span>
              }
              description={
                <div>
                  {item.cause && <p><strong>问题原因：</strong>{item.cause}</p>}
                  {(item.currentValue || item.targetValue) && (
                    <p><strong>调整：</strong>{item.currentValue && `从 ${item.currentValue}`}{item.targetValue && ` → ${item.targetValue}`}</p>
                  )}
                  <p><strong>方案：</strong>{item.suggestion}</p>
                  {item.expectedEffect && <p><strong>预期效果：</strong>{item.expectedEffect}</p>}
                  {item.reason && <p><strong>依据：</strong>{item.reason}</p>}
                </div>
              }
              style={{ marginBottom: 12 }}
            />
          ))}
        </Card>
      )}

      {(result.furtherTestSuggestions || result.comprehensiveEvaluation) && (
        <Card className="custom-card mb-m" title="进一步试验建议">
          {(() => {
            const fts = result.furtherTestSuggestions || result.comprehensiveEvaluation
            return (
              <>
                {fts.testPurpose && (
                  <Alert type="info" showIcon message="试验目的" description={fts.testPurpose} style={{ marginBottom: 12 }} />
                )}
                {fts.dataGaps && fts.dataGaps.length > 0 && (
                  <>
                    <Divider orientation="left">数据缺口</Divider>
                    {fts.dataGaps.map((gap, i) => (
                      <Alert key={i} type="warning" showIcon message={gap} style={{ marginBottom: 8 }} />
                    ))}
                  </>
                )}
                {fts.verificationTests && fts.verificationTests.length > 0 && (
                  <>
                    <Divider orientation="left">验证性试验</Divider>
                    {fts.verificationTests.map((test, i) => (
                      <Alert
                        key={i}
                        type="success"
                        showIcon
                        message={`验证目标：${test.objective}`}
                        description={
                          <div>
                            {test.testMixDesign && <p>待验证配合比：{JSON.stringify(test.testMixDesign)}</p>}
                            {test.benchmark && <p>对照组：{test.benchmark}</p>}
                            {test.expectedOutcome && <p>预期结果：{test.expectedOutcome}</p>}
                            {test.evaluationCriteria && <p>评价指标：{test.evaluationCriteria.join('、')}</p>}
                          </div>
                        }
                        style={{ marginBottom: 12 }}
                      />
                    ))}
                  </>
                )}
                {fts.exploratoryTests && fts.exploratoryTests.length > 0 && (
                  <>
                    <Divider orientation="left">探索性试验</Divider>
                    {fts.exploratoryTests.map((test, i) => (
                      <Alert
                        key={i}
                        type="warning"
                        showIcon
                        message={`探索目标：${test.objective}`}
                        description={
                          <div>
                            {test.variable && <p>试验变量：{test.variable}，范围：{test.range}，步长：{test.step}</p>}
                            {test.expectedTrend && <p>预期趋势：{test.expectedTrend}</p>}
                          </div>
                        }
                        style={{ marginBottom: 12 }}
                      />
                    ))}
                  </>
                )}
                {fts.testMatrix && fts.testMatrix.length > 0 && (
                  <>
                    <Divider orientation="left">试验矩阵</Divider>
                    <Table
                      className="custom-table"
                      dataSource={fts.testMatrix}
                      rowKey={(_, i) => i}
                      columns={[
                        { title: '编号', dataIndex: 'id', width: 80 },
                        { title: '变量说明', dataIndex: 'variableDescription', width: 120 },
                        { title: '水泥', dataIndex: 'cement', width: 70 },
                        { title: '粉煤灰', dataIndex: 'flyAsh', width: 70 },
                        { title: '矿渣粉', dataIndex: 'slag', width: 70 },
                        { title: '水胶比', dataIndex: 'waterBinderRatio', width: 70 },
                        { title: '预期R28', dataIndex: 'expectedR28', width: 80 },
                        { title: '预期成本', dataIndex: 'expectedCost', width: 80 },
                      ]}
                      scroll={{ x: 640 }}
                      pagination={false}
                      size="small"
                    />
                  </>
                )}
                {fts.priorityAndResources && (
                  <Alert type="info" showIcon message="优先级与资源建议" description={fts.priorityAndResources} style={{ marginBottom: 12 }} />
                )}
                {fts.alternativeDirections && fts.alternativeDirections.length > 0 && (
                  <>
                    <Divider orientation="left">可选试验方向</Divider>
                    {fts.alternativeDirections.map((dir, i) => (
                      <Alert key={i} type="info" showIcon message={dir} style={{ marginBottom: 8 }} />
                    ))}
                  </>
                )}
              </>
            )
          })()}
        </Card>
      )}
    </div>
  )
}

const AIAnalysisPage = () => {
  const [mixDesigns, setMixDesigns] = useState([])
  const [materials, setMaterials] = useState([])
  const [materialMapping, setMaterialMapping] = useState({})
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef(null)
  const [processedData, setProcessedData] = useState('')
  const [processingData, setProcessingData] = useState(false)
  const [selectedSections, setSelectedSections] = useState({
    analyzeMaterialInfluences: true,
    analyzeMixDesignInfluences: true,
    generateOptimalMixDesign: true,
    provideSuggestions: true,
    furtherTestSuggestions: true,
  })
  const [customPrompt, setCustomPrompt] = useState('')

  // 加载所有材料
  const loadMaterials = async () => {
    try {
      const allMaterials = await getAllMaterials()
      setMaterials(allMaterials)
    } catch (error) {
      console.error('加载材料失败:', error)
    }
  }

  useEffect(() => {
    loadMaterials()
  }, [])

  // 处理数据：提取为上传给AI的格式并显示
  const handleProcessData = async () => {
    if (mixDesigns.length === 0) {
      message.warning('请先导入配合比数据')
      return
    }

    setProcessingData(true)
    setProcessedData('')
    try {
      const latestMaterials = await getAllMaterials()
      let currentMaterialMapping = materialMapping
      if (latestMaterials.length > 0) {
        setMaterials(latestMaterials)
        const refreshedMapping = {}
        for (const mix of mixDesigns) {
          const mapping = {}
          const allKeys = new Set([
            ...Object.keys(mix.materials || {}),
            ...Object.keys(materialMapping[mix.id] || {})
          ])
          for (const key of allKeys) {
            const materialName = mix.materials?.[key] || ''
            const type = MATERIAL_TYPE_MAP[key]
            if (!type) continue
            const userSelected = materialMapping[mix.id]?.[key]
            if (userSelected) {
              const refreshed = latestMaterials.find(m => m.id === userSelected.id)
              mapping[key] = refreshed || userSelected
            } else if (materialName) {
              const matched = matchMaterialByName(latestMaterials, type, materialName)
              mapping[key] = matched || null
            }
          }
          refreshedMapping[mix.id] = mapping
        }
        setMaterialMapping(refreshedMapping)
        currentMaterialMapping = refreshedMapping
      }

      const data = buildAnalysisData(mixDesigns, currentMaterialMapping, selectedSections)
      if (customPrompt.trim()) {
        data._customPrompt = customPrompt.trim()
      }
      const md = formatDataAsMarkdown(data)
      setProcessedData(md)
      message.success('数据处理完成')
    } catch (error) {
      message.error('数据处理失败: ' + error.message)
    } finally {
      setProcessingData(false)
    }
  }

  // 开始AI分析
  const handleAnalyze = async () => {
    if (mixDesigns.length === 0) {
      message.warning('请先导入配合比数据')
      return
    }

    setAnalyzing(true)
    setAnalysisResult(null)
    try {
      const latestMaterials = await getAllMaterials()
      if (latestMaterials.length > 0) {
        setMaterials(latestMaterials)
        const refreshedMapping = {}
        for (const mix of mixDesigns) {
          const mapping = {}
          const allKeys = new Set([
            ...Object.keys(mix.materials || {}),
            ...Object.keys(materialMapping[mix.id] || {})
          ])
          for (const key of allKeys) {
            const materialName = mix.materials?.[key] || ''
            const type = MATERIAL_TYPE_MAP[key]
            if (!type) continue
            const userSelected = materialMapping[mix.id]?.[key]
            if (userSelected) {
              const refreshed = latestMaterials.find(m => m.id === userSelected.id)
              mapping[key] = refreshed || userSelected
            } else if (materialName) {
              const matched = matchMaterialByName(latestMaterials, type, materialName)
              mapping[key] = matched || null
            }
          }
          refreshedMapping[mix.id] = mapping
        }
        setMaterialMapping(refreshedMapping)
        var currentMaterialMapping = refreshedMapping
      } else {
        var currentMaterialMapping = materialMapping
      }

      const data = buildAnalysisData(mixDesigns, currentMaterialMapping, selectedSections)
      const result = await window.electronAPI.invoke('aiAnalysis:analyze', { data, customPrompt })
      setAnalysisResult(result)
      message.success('AI分析完成')
    } catch (error) {
      message.error('AI分析失败: ' + error.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // 从结果卡片保存方案
  const handleSaveFromCard = async (cardData) => {
    try {
      const bestSol = cardData.bestSolution || {}
      const saveData = {
        strengthGrade: cardData.strength,
        slump: cardData.slump,
        waterBinderRatio: cardData.waterRatio || bestSol.waterRatio,
        sandRatio: cardData.sandRatio || bestSol.sandRatio,
        status: 'AI生成'
      }
      await window.electronAPI.invoke('createMixDesign', saveData)
      message.success('方案已保存')
    } catch (error) {
      message.error('保存失败: ' + error.message)
    }
  }

  // 发送聊天消息
  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return

    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)

    try {
      const compactMixDesigns = mixDesigns.map(m => ({
        id: m.id,
        strengthGrade: m.strengthGrade,
        waterBinderRatio: m.waterBinderRatio,
        strengthR28: m.testResults?.strengthR28 || 0
      }))
      const context = {
        mixDesignsCount: mixDesigns.length,
        analysisResult: analysisResult,
        mixDesigns: compactMixDesigns
      }

      const result = await window.electronAPI.invoke('aiAnalysis:chat', {
        message: userMessage,
        context: context
      })

      const chatMsg = {
        role: 'assistant',
        content: result.reply,
        toolCalls: null
      }

      if (result.messages) {
        const toolMsgs = result.messages.filter(m => m.role === 'tool')
        for (const toolMsg of toolMsgs) {
          try {
            const parsed = JSON.parse(toolMsg.content)
            if (parsed.success && parsed.materials && parsed.materials.length > 0) {
              const materialType = parsed.materials[0]?.type
              if (materialType) {
                chatMsg.materialPicker = { materials: parsed.materials }
              }
            }
          } catch (_) { /* ignore */ }
        }
        if (toolMsgs.length > 0) {
          const lastToolResult = toolMsgs[toolMsgs.length - 1]
          try {
            const parsed = JSON.parse(lastToolResult.content)
            if (parsed.type) {
              chatMsg.toolCall = {
                status: parsed.success ? 'done' : 'error',
                type: parsed.type,
                data: parsed.data || parsed
              }
            }
          } catch (_) { /* ignore */ }
        }
      }

      setChatMessages(prev => [...prev, chatMsg])
    } catch (error) {
      message.error('发送消息失败: ' + error.message)
      setChatMessages(prev => prev.slice(0, -1))
    } finally {
      setChatLoading(false)
    }
  }

  // 清空聊天历史
  const handleClearChat = async () => {
    try {
      await window.electronAPI.invoke('aiAnalysis:clearHistory')
      setChatMessages([])
      message.success('对话已清空')
    } catch (error) {
      console.error('清空对话失败:', error)
    }
  }

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // 计算属性和回调传递给 Upload 和 Results 组件
  const uploadProps = {
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
    onProcessData: handleProcessData,
  }

  const resultsProps = {
    analysisResult,
    setAnalysisResult,
    analyzing,
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    chatLoading,
    setChatLoading,
    mixDesigns,
    selectedSections,
    setSelectedSections,
    customPrompt,
    setCustomPrompt,
    onAnalyze: handleAnalyze,
    onSendChat: handleSendChat,
    onClearChat: handleClearChat,
    onSaveFromCard: handleSaveFromCard,
  }

  // 智能解析的子 Tab items
  const analysisItems = [
    {
      key: 'data-import',
      label: '数据导入',
      children: <AIAnalysisPage_Upload {...uploadProps} />,
    },
    {
      key: 'data-list',
      label: '数据列表',
      children: <AIAnalysisPage_Upload {...uploadProps} showDataListOnly />,
    },
    {
      key: 'data-processing',
      label: '数据处理',
      children: <AIAnalysisPage_Upload {...uploadProps} showDataProcessingOnly />,
    },
    {
      key: 'analysis-report',
      label: '分析报告',
      children: <AIAnalysisPage_Results {...resultsProps} />,
    },
  ]

  const smartItems = [
    {
      key: 'smart-design',
      label: '智能设计',
      children: <SmartDesignChat />,
    },
    {
      key: 'smart-analysis',
      label: '智能解析',
      children: <Tabs items={analysisItems} defaultActiveKey="data-import" size="large" />,
    },
    {
      key: 'standards',
      label: '规范管理',
      children: <StandardsManager />,
    },
  ]

  return (
    <div className="page-container">
      <div className="custom-card">
        <Tabs
          items={smartItems}
          defaultActiveKey="smart-design"
          size="large"
        />
      </div>
    </div>
  )
}

export default AIAnalysisPage
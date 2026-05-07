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
import MaterialPicker from '../components/MaterialPicker'
import DiagnosisResultCard from '../components/DiagnosisResultCard'
import SmartDesignChat from '../components/SmartDesignChat'

// 从材料完整对象中提取AI分析所需的关键参数
const extractMaterialInfo = (material) => {
  if (!material) return null
  const common = {
    name: material.name,
    type: material.type,
    price: material.price,       // 元/吨
    density: material.density,   // 密度
    specification: material.specification,
    manufacturer: material.manufacturer,
  }
  // 按材料类型提取性能参数
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
  waterReducer: '外加剂', // 兼容'外加剂'和'减水剂'两种类型
}

// AI分析报告组件
const AnalysisReport = ({ result }) => {
  if (!result) return null

  // 判断是否为扁平旧格式（兼容历史分析结果）
  const isFlatMaterial = result.materialInfluenceAnalysis?.length > 0 && !result.materialInfluenceAnalysis[0].findings
  const isFlatMix = result.mixDesignInfluenceAnalysis?.length > 0 && !result.mixDesignInfluenceAnalysis[0].findings

  return (
    <div className="analysis-report fade-in">
      {/* 材料性能影响分析 */}
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

      {/* 配合比参数影响分析 */}
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

      {/* 最优配合比设计 */}
      {result.optimalMixDesignRecommendation && (
        <Card className="custom-card mb-m" title="最优配合比设计（预测）">
          {result.optimalMixDesignRecommendation.configurationStrength && (
            <Alert
              type="info"
              showIcon
              message="配制强度"
              description={result.optimalMixDesignRecommendation.configurationStrength}
              style={{ marginBottom: 12 }}
            />
          )}
          {result.optimalMixDesignRecommendation.optimizationGoal && (
            <Alert
              type="info"
              showIcon
              message="优化目标"
              description={result.optimalMixDesignRecommendation.optimizationGoal}
              style={{ marginBottom: 12 }}
            />
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
              <Alert
                type="info"
                showIcon
                message="预测依据"
                description={result.optimalMixDesignRecommendation.predictionBasis}
              />
            </>
          )}

          {result.optimalMixDesignRecommendation.optimizationRationale && (
            <>
              <Divider />
              <Alert
                type="info"
                showIcon
                message="优化依据"
                description={result.optimalMixDesignRecommendation.optimizationRationale}
              />
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
              <Alert
                type="warning"
                showIcon
                message="可行性说明"
                description={result.optimalMixDesignRecommendation.feasibilityNote}
              />
            </>
          )}
        </Card>
      )}

      {/* 参数调整建议 */}
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

      {/* 进一步试验建议 */}
      {(result.furtherTestSuggestions || result.comprehensiveEvaluation) && (
        <Card className="custom-card mb-m" title="进一步试验建议">
          {(() => {
            const fts = result.furtherTestSuggestions || result.comprehensiveEvaluation
            return (
              <>
                {fts.testPurpose && (
                  <Alert
                    type="info"
                    showIcon
                    message="试验目的"
                    description={fts.testPurpose}
                    style={{ marginBottom: 12 }}
                  />
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
                  <Alert
                    type="info"
                    showIcon
                    message="优先级与资源建议"
                    description={fts.priorityAndResources}
                    style={{ marginBottom: 12 }}
                  />
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

const parseExcelFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })

        // Parse Sheet1: 配合比数据
        const sheet1Name = workbook.SheetNames.find(name => name === '配合比数据')
        const sheet1 = sheet1Name ? workbook.Sheets[sheet1Name] : null
        if (!sheet1) {
          throw new Error('未找到"配合比数据"工作表，请检查Excel文件格式')
        }
        const sheet1Data = XLSX.utils.sheet_to_json(sheet1)

        // Parse Sheet2: 试验结果
        const sheet2Name = workbook.SheetNames.find(name => name === '试验结果')
        const sheet2 = sheet2Name ? workbook.Sheets[sheet2Name] : null
        const sheet2Data = sheet2 ? XLSX.utils.sheet_to_json(sheet2) : []

        // Check if sheet2 has data
        if (!sheet2 || sheet2Data.length === 0) {
          message.warning('警告: 未找到"试验结果"工作表或工作表为空，试验结果将全部为零')
        }

        // Merge data by 编号
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

        // Warn about unmatched items
        if (unmatchedCount > 0) {
          message.warning(`警告: 有 ${unmatchedCount} 条配合比数据在试验结果中未找到匹配的编号，试验结果将为零`)
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

// 构建发送给AI的分析数据（纯同步函数，不涉及异步材料加载）
// 默认全选的分析项
const DEFAULT_ANALYSIS_REQUIREMENTS = {
  analyzeMaterialInfluences: true,
  analyzeMixDesignInfluences: true,
  generateOptimalMixDesign: true,
  provideSuggestions: true,
  furtherTestSuggestions: true,
}

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
            // 合并 Excel 中的材料名 和 用户手动选择的材料（避免遗漏锂渣/复合粉等）
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

const AIAnalysisPage = () => {
  const [mixDesigns, setMixDesigns] = useState([])
  const [materials, setMaterials] = useState([])
  const [materialMapping, setMaterialMapping] = useState({}) // { [mixDesignId]: { cement: materialObj, ... } }
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [chatMessages, setChatMessages] = useState([]) // [{role: 'user'|'assistant', content: string}]
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

  // 自动匹配材料
  const autoMatchMaterials = (mixDesignsData) => {
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

    setMaterialMapping(newMapping)

    if (unmatchedMaterials.size > 0) {
      message.warning(`有 ${unmatchedMaterials.size} 种材料未能自动匹配：${Array.from(unmatchedMaterials).join('、')}`)
    }
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

  // 分组统计：按强度等级分组，计算各组试验结果的均值、极值
  const handleDownloadTemplate = () => {
    try {
      // 创建配合比分析模板数据
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

      // 试验结果模板（第二张Sheet）
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

      // 创建工作簿
      const wb = XLSX.utils.book_new()

      // 第一个Sheet：配合比数据
      const ws1 = XLSX.utils.json_to_sheet(templateData)
      XLSX.utils.book_append_sheet(wb, ws1, '配合比数据')

      // 第二个Sheet：试验结果
      const ws2 = XLSX.utils.json_to_sheet(testResultData)
      XLSX.utils.book_append_sheet(wb, ws2, '试验结果')

      // 下载文件
      XLSX.writeFile(wb, '配合比分析模板.xlsx')
      message.success('模板已下载：配合比分析模板.xlsx')
    } catch (error) {
      message.error('模板下载失败')
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
      // 重新从数据库加载最新材料数据，确保性能参数和价格是最新的
      const latestMaterials = await getAllMaterials()
      if (latestMaterials.length > 0) {
        setMaterials(latestMaterials)

        // 以用户当前选择的材料为基础，用最新数据库数据刷新
        // 保留用户手动选择的材料，只对未选择的做自动匹配
        const refreshedMapping = {}
        for (const mix of mixDesigns) {
          const mapping = {}

          // 收集所有需要处理的材料key：Excel中的材料名 + 用户手动选择的材料
          const allKeys = new Set([
            ...Object.keys(mix.materials || {}),
            ...Object.keys(materialMapping[mix.id] || {})
          ])

          for (const key of allKeys) {
            const materialName = mix.materials?.[key] || ''
            const type = MATERIAL_TYPE_MAP[key]
            if (!type) continue

            // 检查用户是否已在数据列表中手动选择了材料
            const userSelected = materialMapping[mix.id]?.[key]
            if (userSelected) {
              // 保留用户选择，但从最新数据库中刷新该材料的数据（价格、性能参数等）
              const refreshed = latestMaterials.find(m => m.id === userSelected.id)
              mapping[key] = refreshed || userSelected
            } else if (materialName) {
              // 用户未选择，尝试自动匹配
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

  // 发送聊天消息
  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return

    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)

    try {
      // 构建上下文数据——用紧凑摘要格式传递所有配合比
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

      // 构建消息对象，包含 toolCall 信息
      const chatMsg = {
        role: 'assistant',
        content: result.reply,
        toolCalls: null
      }

      // 解析后端返回的 tool_call 数据
      if (result.messages) {
        const toolMsgs = result.messages.filter(m => m.role === 'tool')
        for (const toolMsg of toolMsgs) {
          try {
            const parsed = JSON.parse(toolMsg.content)
            // 如果调用了 list_available_materials，渲染 MaterialPicker
            if (parsed.success && parsed.materials && parsed.materials.length > 0) {
              const materialType = parsed.materials[0]?.type
              if (materialType) {
                chatMsg.materialPicker = { materials: parsed.materials }
              }
            }
          } catch (_) { /* ignore */ }
        }
        // 最后一个 tool 结果决定 toolCall 卡片
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
      // 移除失败的用户消息
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

  // 手动添加配合比数据
  const handleManualAdd = (values) => {
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
  }

  const handleDeleteRow = (id) => {
    setMixDesigns(prev => prev.filter(item => item.id !== id))
    setMaterialMapping(prev => {
      const updated = { ...prev }
      delete updated[id]
      return updated
    })
    message.success('已删除该条数据')
  }

  const handleImportExcel = async (file) => {
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
      autoMatchMaterials(data)
      message.success(`成功导入 ${data.length} 条配合比数据`)
    } catch (error) {
      message.error('Excel文件解析失败：' + error.message)
    } finally {
      setLoading(false)
    }
    return false
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

  const analysisItems = [
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
              onClick={handleProcessData}
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
    {
      key: 'analysis-report',
      label: '分析报告',
      children: (
        <div>
          <Card className="custom-card mb-m" title="分析内容选择" size="small">
            <Checkbox.Group
              value={Object.entries(selectedSections).filter(([, v]) => v).map(([k]) => k)}
              onChange={(checked) => {
                setSelectedSections({
                  analyzeMaterialInfluences: checked.includes('analyzeMaterialInfluences'),
                  analyzeMixDesignInfluences: checked.includes('analyzeMixDesignInfluences'),
                  generateOptimalMixDesign: checked.includes('generateOptimalMixDesign'),
                  provideSuggestions: checked.includes('provideSuggestions'),
                  furtherTestSuggestions: checked.includes('furtherTestSuggestions'),
                })
              }}
            >
              <Row gutter={[16, 8]}>
                <Col span={8}><Checkbox value="analyzeMaterialInfluences">材料性能影响分析</Checkbox></Col>
                <Col span={8}><Checkbox value="analyzeMixDesignInfluences">配合比参数影响分析</Checkbox></Col>
                <Col span={8}><Checkbox value="generateOptimalMixDesign">最优配合比设计</Checkbox></Col>
                <Col span={8}><Checkbox value="provideSuggestions">参数调整建议</Checkbox></Col>
                <Col span={8}><Checkbox value="furtherTestSuggestions">进一步试验建议</Checkbox></Col>
              </Row>
            </Checkbox.Group>
            <Divider style={{ margin: '12px 0' }} />
            <div>
              <div style={{ marginBottom: 8, color: '#666' }}>额外提示词（可选，将追加到AI分析指令中）</div>
              <Input.TextArea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="例如：请重点关注锂渣对强度的影响、请输出各强度等级的成本对比表..."
                rows={3}
                maxLength={2000}
                showCount
              />
            </div>
          </Card>
          <div className="mb-m">
            <Button
              type="primary"
              size="large"
              onClick={handleAnalyze}
              loading={analyzing}
              disabled={mixDesigns.length === 0}
            >
              {analyzing ? '分析中...' : '开始AI分析'}
            </Button>
            {mixDesigns.length === 0 && (
              <span className="ml-m text-tertiary">
                请先在"数据导入"中导入配合比数据
              </span>
            )}
          </div>
          {analysisResult?.parameterDiagnosis && (
            <DiagnosisResultCard data={analysisResult.parameterDiagnosis} />
          )}
          <AnalysisReport result={analysisResult} />

          {/* 继续与AI对话 */}
          <Card
            className="custom-card mt-l"
            title={
              <Space>
                <RobotOutlined />
                <span>继续与AI对话</span>
              </Space>
            }
            extra={
              <Button
                icon={<ClearOutlined />}
                onClick={handleClearChat}
                disabled={chatMessages.length === 0}
                size="small"
              >
                清空对话
              </Button>
            }
          >
            <div className="chat-container">
              {chatMessages.length === 0 ? (
                <Alert
                  type="info"
                  showIcon
                  message="暂无对话记录"
                  description="完成AI分析后，可以在这里继续与AI讨论相关问题"
                />
              ) : (
                <List
                  dataSource={chatMessages}
                  renderItem={(item) => (
                    <List.Item
                      className={item.role === 'user' ? 'chat-item-user' : 'chat-item-assistant'}
                    >
                      <Space align="start">
                        {item.role === 'assistant' && (
                          <Avatar icon={<RobotOutlined />} className="chat-avatar" />
                        )}
                        <div className={`chat-message ${item.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}>
                          {item.role === 'assistant' ? (
                            <>
                              {item.toolCall && item.toolCall.status === 'done' && (
                                <>
                                  {item.toolCall.type === 'mix_design' && (
                                    <MixDesignResultCard data={item.toolCall.data} onSave={handleSaveFromCard} />
                                  )}
                                  {item.toolCall.type === 'optimization' && (
                                    <OptimizationResultCard data={item.toolCall.data} onSave={handleSaveFromCard} />
                                  )}
                                  {item.toolCall.type === 'material_compare' && (
                                    <MaterialCompareCard data={item.toolCall.data} />
                                  )}
                                  {item.toolCall.type === 'parameter_diagnosis' && (
                                    <DiagnosisResultCard data={item.toolCall.data} />
                                  )}
                                </>
                              )}
                              {item.materialPicker && (
                                <MaterialPicker
                                  materials={item.materialPicker.materials}
                                  onSelect={(material) => {
                                    setChatInput(`我选择 ${material.name}`)
                                  }}
                                />
                              )}
                              {item.toolCall?.status === 'loading' && (
                                <ToolCallBubble status="loading" toolName={item.toolCall.type} />
                              )}
                              <ReactMarkdown>{item.content}</ReactMarkdown>
                            </>
                          ) : (
                            item.content
                          )}
                        </div>
                        {item.role === 'user' && (
                          <Avatar icon={<UserOutlined />} className="chat-avatar-user" />
                        )}
                      </Space>
                    </List.Item>
                  )}
                />
              )}
              <div ref={chatEndRef} />
            </div>

            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="输入您的问题，与AI讨论配合比相关问题..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onPressEnter={handleSendChat}
                disabled={chatLoading}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSendChat}
                loading={chatLoading}
                disabled={!chatInput.trim()}
              >
                发送
              </Button>
            </Space.Compact>
          </Card>
        </div>
      ),
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
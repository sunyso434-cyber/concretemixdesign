import React, { useState } from 'react'
import { Button, Checkbox, Row, Col, Divider, Input, Alert, Card, List, Avatar, Space, Tabs, Table, Select, Empty } from 'antd'
import { RobotOutlined, UserOutlined, ClearOutlined, SendOutlined, SettingOutlined, ExperimentOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import ReactECharts from 'echarts-for-react'
import MixDesignResultCard from '../components/MixDesignResultCard'
import OptimizationResultCard from '../components/OptimizationResultCard'
import MaterialCompareCard from '../components/MaterialCompareCard'
import DiagnosisResultCard from '../components/DiagnosisResultCard'
import ToolCallBubble from '../components/ToolCallBubble'
import MaterialPicker from '../components/MaterialPicker'

// 趋势分析 Tab 组件
const TrendAnalysisTab = ({ result }) => {
  const [selectedParam, setSelectedParam] = useState(null)
  const [selectedMetric, setSelectedMetric] = useState(null)

  const preprocessed = result.preprocessedData?.trend
  const trendResult = result.trendAnalysis

  if (!preprocessed) {
    return <Empty description="暂无趋势分析数据" />
  }

  const regressions = preprocessed.regressions || []
  const sensitivity = preprocessed.sensitivity || []
  const chartData = preprocessed.chartData || {}

  const params = [...new Set(regressions.map(r => r.param))]
  const currentParam = selectedParam || params[0]
  const paramRegs = regressions.filter(r => r.param === currentParam)
  const metrics = [...new Set(paramRegs.map(r => r.performance))]
  const currentMetric = selectedMetric || metrics[0]

  const currentReg = paramRegs.find(r => r.performance === currentMetric)
  const currentChartKey = `${currentParam}__${currentMetric}`
  const currentChartPoints = chartData[currentChartKey] || []

  const chartOption = {
    xAxis: { name: currentParam, type: 'value' },
    yAxis: { name: currentMetric, type: 'value' },
    series: [
      { name: '数据点', type: 'scatter', data: currentChartPoints.map(p => [p.x, p.y]) }
    ]
  }

  if (currentReg && currentChartPoints.length >= 2) {
    const xMin = Math.min(...currentChartPoints.map(p => p.x))
    const xMax = Math.max(...currentChartPoints.map(p => p.x))
    chartOption.series.push({
      name: '回归线',
      type: 'line',
      data: [[xMin, currentReg.slope * xMin + currentReg.intercept], [xMax, currentReg.slope * xMax + currentReg.intercept]],
      lineStyle: { type: 'dashed' }
    })
  }

  const regressionColumns = [
    { title: '参数', dataIndex: 'param', key: 'param' },
    { title: '性能', dataIndex: 'performance', key: 'performance' },
    { title: '回归方程', dataIndex: 'equation', key: 'equation' },
    { title: 'R²', dataIndex: 'r2', key: 'r2', render: (val) => val.toFixed(3), sorter: (a, b) => b.r2 - a.r2 }
  ]
  const visibleRegs = regressions.filter(r => r.r2 >= 0.6)

  const sensitivityOption = {
    xAxis: { type: 'value', name: '影响度 (avg R²)' },
    yAxis: { type: 'category', data: sensitivity.map(s => s.param).reverse() },
    series: [{
      type: 'bar',
      data: sensitivity.map(s => s.influence).reverse(),
      label: { show: true, position: 'right', formatter: (p) => p.value.toFixed(2) }
    }]
  }

  return (
    <>
      <Card className="custom-card mb-m" size="small">
        <Row gutter={16}>
          <Col span={12}>
            <span style={{ marginRight: 8 }}>变化参数:</span>
            <Select value={currentParam} onChange={p => { setSelectedParam(p); setSelectedMetric(null) }} style={{ width: 200 }}
              options={params.map(p => ({ value: p, label: p }))} />
          </Col>
          <Col span={12}>
            <span style={{ marginRight: 8 }}>对比指标:</span>
            <Select value={currentMetric} onChange={setSelectedMetric} style={{ width: 200 }}
              options={metrics.map(m => ({ value: m, label: m }))} />
          </Col>
        </Row>
      </Card>

      <Card className="custom-card mb-m" title="趋势图表">
        {currentReg && (
          <Alert type="info" message={`${currentReg.equation}，R²=${currentReg.r2.toFixed(3)}${currentReg.r2 < 0.6 ? '（相关性较弱）' : ''}`} style={{ marginBottom: 16 }} />
        )}
        {currentChartPoints.length >= 2
          ? <ReactECharts option={chartOption} style={{ height: 300 }} />
          : <Empty description="数据点不足，无法绘制趋势图" />
        }
      </Card>

      <Card className="custom-card mb-m" title="回归方程总览（R²≥0.6）">
        {visibleRegs.length > 0
          ? <Table dataSource={visibleRegs} columns={regressionColumns} rowKey={(r) => `${r.param}_${r.performance}`} pagination={false} size="small" />
          : <Empty description="无R²≥0.6的回归关系" />
        }
      </Card>

      {sensitivity.length > 0 && (
        <Card className="custom-card mb-m" title="参数敏感度排序">
          <ReactECharts option={sensitivityOption} style={{ height: 200 }} />
        </Card>
      )}

      {trendResult && (
        <Card className="custom-card mb-m" title="规律总结">
          <ReactMarkdown>{trendResult.patternSummary || '（无内容）'}</ReactMarkdown>
          {trendResult.keyFindings?.length > 0 && (
            <List dataSource={trendResult.keyFindings} renderItem={(item, i) => <List.Item>{i + 1}. {item}</List.Item>} />
          )}
        </Card>
      )}
    </>
  )
}

// 材料对比 Tab 组件
const ContrastAnalysisTab = ({ result }) => {
  const preprocessed = result.preprocessedData?.contrast
  const contrastResult = result.contrastAnalysis

  if (!preprocessed) {
    return <Empty description="暂无材料对比数据" />
  }

  const { materialParamsDiff = [], performanceDiff = [], admixtureImpact } = preprocessed

  const diffColumns = [
    { title: '参数', dataIndex: 'field', key: 'field' },
    { title: 'A组', dataIndex: 'valueA', key: 'valueA', render: (v) => typeof v === 'number' ? v.toFixed(2) : String(v) },
    { title: 'B组', dataIndex: 'valueB', key: 'valueB', render: (v) => typeof v === 'number' ? v.toFixed(2) : String(v) },
    { title: '差异', dataIndex: 'difference', key: 'difference', render: (v) => typeof v === 'number' ? v.toFixed(2) : String(v) },
    { title: '差异%', dataIndex: 'percent', key: 'percent' }
  ]

  const perfColumns = [
    { title: '指标', dataIndex: 'metric', key: 'metric' },
    { title: 'A组均值', dataIndex: 'groupA', key: 'groupA', render: (v) => typeof v === 'number' ? v.toFixed(1) : String(v) },
    { title: 'B组均值', dataIndex: 'groupB', key: 'groupB', render: (v) => typeof v === 'number' ? v.toFixed(1) : String(v) },
    { title: '差异', dataIndex: 'difference', key: 'difference',
      render: (v, record) => typeof v === 'number' ? `${v.toFixed(1)} (${record.percent}%)` : String(v) }
  ]

  return (
    <>
      {materialParamsDiff.map((matDiff, idx) => (
        <Card key={idx} className="custom-card mb-m" title={`材料参数差异：${matDiff.materialNameA} vs ${matDiff.materialNameB}`}>
          <Table dataSource={matDiff.rows} columns={diffColumns} rowKey="field" pagination={false} size="small" />
        </Card>
      ))}

      {performanceDiff.length > 0 && (
        <Card className="custom-card mb-m" title="性能对比分析">
          <Table dataSource={performanceDiff} columns={perfColumns} rowKey="metric" pagination={false} size="small" />
        </Card>
      )}

      {admixtureImpact?.difference && (
        <Card className="custom-card mb-m" title="外加剂掺量影响">
          <Alert type="warning" message={admixtureImpact.difference.description} showIcon />
          {Object.entries(admixtureImpact.groups).map(([key, val]) => (
            <div key={key} style={{ marginTop: 8 }}>
              <strong>{key}:</strong> 平均掺量 {val.meanDosage?.toFixed(2)}%，范围 [{val.minDosage?.toFixed(2)}% - {val.maxDosage?.toFixed(2)}%]
            </div>
          ))}
        </Card>
      )}

      {contrastResult?.reasonAnalysis && (
        <Card className="custom-card mb-m" title="原因分析"><ReactMarkdown>{contrastResult.reasonAnalysis}</ReactMarkdown></Card>
      )}
      {contrastResult?.selectionAdvice && (
        <Card className="custom-card mb-m" title="选择建议"><ReactMarkdown>{contrastResult.selectionAdvice}</ReactMarkdown></Card>
      )}
    </>
  )
}

// AI分析报告组件（导出供 SmartDesignChat 复用）
export const AnalysisReport = ({ result }) => {
  const [activeTab, setActiveTab] = useState(result.analysisModes?.[0] || 'general')

  if (!result) return null

  const isFlatMaterial = result.materialInfluenceAnalysis?.length > 0 && !result.materialInfluenceAnalysis[0].findings
  const isFlatMix = result.mixDesignInfluenceAnalysis?.length > 0 && !result.mixDesignInfluenceAnalysis[0].findings

  const renderGeneralContent = () => (
    <>
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
                      <span style={{ color: item.direction === '正相关' ? 'green' : 'orange' }}>{item.direction}</span>
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
                      <span style={{ color: '#1890ff' }}>{group.strengthGrade}</span>
                      <span style={{ color: '#722ed1' }}>{group.analysisPath}</span>
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
                          <span style={{ color: item.direction === '正相关' ? 'green' : 'orange' }}>{item.direction}</span>
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
                      <span style={{ color: item.direction === '正相关' ? 'green' : 'orange' }}>{item.direction}</span>
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
                    <span style={{ color: '#1890ff' }}>{group.strengthGrade}</span>
                  </Divider>
                  {group.findings && group.findings.map((item, fIdx) => (
                    <Alert
                      key={fIdx}
                      type={item.direction === '正相关' ? 'success' : 'warning'}
                      showIcon
                      message={
                        <span>
                          <span style={{ color: item.direction === '正相关' ? 'green' : 'orange' }}>{item.direction}</span>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
            <div><strong>强度等级：</strong>{result.optimalMixDesignRecommendation.strengthGrade}</div>
            <div><strong>用水量：</strong>{result.optimalMixDesignRecommendation.mixDesign?.water} kg/m³</div>
            <div><strong>水泥用量：</strong>{result.optimalMixDesignRecommendation.mixDesign?.cement} kg/m³</div>
            <div><strong>粉煤灰：</strong>{result.optimalMixDesignRecommendation.mixDesign?.flyAsh} kg/m³</div>
            <div><strong>矿渣粉：</strong>{result.optimalMixDesignRecommendation.mixDesign?.slag} kg/m³</div>
            <div><strong>锂渣：</strong>{result.optimalMixDesignRecommendation.mixDesign?.lithiumSlag} kg/m³</div>
            <div><strong>复合粉：</strong>{result.optimalMixDesignRecommendation.mixDesign?.compositePowder} kg/m³</div>
            <div><strong>砂1：</strong>{result.optimalMixDesignRecommendation.mixDesign?.fineAggregate1} kg/m³</div>
            <div><strong>砂2：</strong>{result.optimalMixDesignRecommendation.mixDesign?.fineAggregate2} kg/m³</div>
            <div><strong>碎石：</strong>{result.optimalMixDesignRecommendation.mixDesign?.coarseAggregate} kg/m³</div>
            <div><strong>减水剂掺量：</strong>{result.optimalMixDesignRecommendation.mixDesign?.waterReducerDosage}%</div>
            <div><strong>减水剂用量：</strong>{result.optimalMixDesignRecommendation.mixDesign?.waterReducerAmount} kg/m³</div>
            <div><strong>水胶比：</strong>{result.optimalMixDesignRecommendation.mixDesign?.waterBinderRatio}</div>
            <div><strong>砂率：</strong>{result.optimalMixDesignRecommendation.mixDesign?.sandRate}</div>
            <div><strong>预期坍落度：</strong>{result.optimalMixDesignRecommendation.expectedPerformance?.slump} mm</div>
            <div><strong>预期扩展度：</strong>{result.optimalMixDesignRecommendation.expectedPerformance?.slumpFlow} mm</div>
            <div><strong>预期28d强度：</strong>{result.optimalMixDesignRecommendation.expectedPerformance?.strength28d} MPa</div>
            <div><strong>预期成本：</strong>¥{result.optimalMixDesignRecommendation.expectedPerformance?.costPerCubicMeter}/m³</div>
          </div>

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
                  <span style={{ color: item.priority === '高' ? 'red' : item.priority === '中' ? 'orange' : '#999' }}>
                    {item.priority || '未标注'}优先级
                  </span>
                  <span style={{ color: item.severity === '严重' ? 'red' : 'orange' }}>{item.severity || item.category}</span>
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
    </>
  )

  // Build tab items if analysis modes are present
  const hasAnalysisModes = result.analysisModes && result.analysisModes.length > 0
  const tabItems = []

  if (hasAnalysisModes && result.analysisModes.includes('param_trend')) {
    tabItems.push({ key: 'param_trend', label: '趋势分析', children: <TrendAnalysisTab result={result} /> })
  }
  if (hasAnalysisModes && result.analysisModes.includes('material_contrast')) {
    tabItems.push({ key: 'material_contrast', label: '材料对比', children: <ContrastAnalysisTab result={result} /> })
  }
  tabItems.push({ key: 'general', label: '综合分析', children: renderGeneralContent() })

  if (!hasAnalysisModes) {
    // Backward compat: render existing 5-module layout directly (no Tabs wrapper)
    return (
      <div className="analysis-report fade-in">
        {renderGeneralContent()}
      </div>
    )
  }

  return (
    <div className="analysis-report fade-in">
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </div>
  )
}

/**
 * AI分析页面 - 结果展示部分
 * 包含：分析报告、AI对话、材料选择卡片等
 */
const AIAnalysisPage_Results = ({
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
  onAnalyze,
  onSendChat,
  onClearChat,
}) => {
  return (
    <div className="results-section">
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
          onClick={onAnalyze}
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
            onClick={onClearChat}
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
                                <MixDesignResultCard data={item.toolCall.data} onSave={() => {}} />
                              )}
                              {item.toolCall.type === 'optimization' && (
                                <OptimizationResultCard data={item.toolCall.data} onSave={() => {}} />
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
        </div>

        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="输入您的问题，与AI讨论配合比相关问题..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onPressEnter={onSendChat}
            disabled={chatLoading}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={onSendChat}
            loading={chatLoading}
            disabled={!chatInput.trim()}
          >
            发送
          </Button>
        </Space.Compact>
      </Card>
    </div>
  )
}

export default AIAnalysisPage_Results
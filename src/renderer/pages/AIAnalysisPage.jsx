import React, { useState, useEffect, useRef } from 'react'
import { Tabs, Button, message, Upload, Table, Select, Space, Card, Tag, Alert, Descriptions, Divider, Form, InputNumber, Row, Col, Input, List, Avatar } from 'antd'
import { DownloadOutlined, UploadOutlined, ExperimentOutlined, SettingOutlined, SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, DeleteOutlined } from '@ant-design/icons'
import * as XLSX from 'xlsx'
import { getMaterialsByType, getAllMaterials, matchMaterialByName } from '../services/MaterialService'
import ToolCallBubble from '../components/ToolCallBubble'
import MixDesignResultCard from '../components/MixDesignResultCard'
import OptimizationResultCard from '../components/OptimizationResultCard'
import MaterialCompareCard from '../components/MaterialCompareCard'
import MaterialPicker from '../components/MaterialPicker'

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

  return (
    <div className="analysis-report fade-in">
      {/* 材料性能影响分析 */}
      {result.materialInfluenceAnalysis && result.materialInfluenceAnalysis.length > 0 && (
        <Card className="custom-card mb-m" title={<><ExperimentOutlined /> 材料性能影响分析</>}>
          {result.materialInfluenceAnalysis.map((item, index) => (
            <Alert
              key={index}
              type={item.direction === '正相关' ? 'success' : 'warning'}
              showIcon
              icon={<SettingOutlined />}
              message={
                <span>
                  <Tag color={item.direction === '正相关' ? 'green' : 'orange'}>
                    {item.direction}
                  </Tag>
                  <strong>{item.material}</strong> - {item.parameter}
                  <span className="ml-m">→ 影响{item.affectedProperty}</span>
                </span>
              }
              description={item.description}
              className="mb-alert"
            />
          ))}
        </Card>
      )}

      {/* 配合比参数影响分析 */}
      {result.mixDesignInfluenceAnalysis && result.mixDesignInfluenceAnalysis.length > 0 && (
        <Card className="custom-card mb-m" title="配合比参数影响分析">
          {result.mixDesignInfluenceAnalysis.map((item, index) => (
            <Alert
              key={index}
              type={item.direction === '正相关' ? 'success' : 'warning'}
              showIcon
              message={
                <span>
                  <Tag color={item.direction === '正相关' ? 'green' : 'orange'}>
                    {item.direction}
                  </Tag>
                  <strong>{item.param}</strong>
                  <span className="ml-m">→ 影响{item.affectedProperty}</span>
                </span>
              }
              description={item.description}
              className="mb-alert"
            />
          ))}
        </Card>
      )}

      {/* 最优配合比设计 */}
      {result.optimalMixDesignRecommendation && (
        <Card className="custom-card mb-m" title="最优配合比设计">
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="强度等级" span={2}>
              <Tag color="blue">{result.optimalMixDesignRecommendation.strengthGrade}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="用水量">{result.optimalMixDesignRecommendation.mixDesign?.water} kg/m³</Descriptions.Item>
            <Descriptions.Item label="水泥用量">{result.optimalMixDesignRecommendation.mixDesign?.cement} kg/m³</Descriptions.Item>
            <Descriptions.Item label="粉煤灰">{result.optimalMixDesignRecommendation.mixDesign?.flyAsh} kg/m³</Descriptions.Item>
            <Descriptions.Item label="矿渣粉">{result.optimalMixDesignRecommendation.mixDesign?.slag} kg/m³</Descriptions.Item>
            <Descriptions.Item label="砂1">{result.optimalMixDesignRecommendation.mixDesign?.fineAggregate1} kg/m³</Descriptions.Item>
            <Descriptions.Item label="砂2">{result.optimalMixDesignRecommendation.mixDesign?.fineAggregate2} kg/m³</Descriptions.Item>
            <Descriptions.Item label="碎石">{result.optimalMixDesignRecommendation.mixDesign?.coarseAggregate} kg/m³</Descriptions.Item>
            <Descriptions.Item label="减水剂掺量">{result.optimalMixDesignRecommendation.mixDesign?.waterReducerDosage}%</Descriptions.Item>
            <Descriptions.Item label="水胶比">{result.optimalMixDesignRecommendation.mixDesign?.waterBinderRatio}</Descriptions.Item>
            <Descriptions.Item label="预期坍落度">{result.optimalMixDesignRecommendation.expectedPerformance?.slump} mm</Descriptions.Item>
            <Descriptions.Item label="预期扩展度">{result.optimalMixDesignRecommendation.expectedPerformance?.slumpFlow} mm</Descriptions.Item>
            <Descriptions.Item label="预期28d强度">{result.optimalMixDesignRecommendation.expectedPerformance?.strength28d} MPa</Descriptions.Item>
            <Descriptions.Item label="预期成本">¥{result.optimalMixDesignRecommendation.expectedPerformance?.costPerCubicMeter}/m³</Descriptions.Item>
          </Descriptions>

          <Divider />

          <Alert
            type="info"
            showIcon
            message="优化依据"
            description={result.optimalMixDesignRecommendation.optimizationRationale}
          />

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
        </Card>
      )}

      {/* 参数调整建议 */}
      {result.adjustmentSuggestions && result.adjustmentSuggestions.length > 0 && (
        <Card className="custom-card mb-m" title="参数调整建议">
          {result.adjustmentSuggestions.map((item, index) => (
            <Alert
              key={index}
              type="warning"
              showIcon
              message={item.category}
              description={
                <div>
                  <p><strong>建议：</strong>{item.suggestion}</p>
                  <p><strong>原因：</strong>{item.reason}</p>
                </div>
              }
              style={{ marginBottom: 12 }}
            />
          ))}
        </Card>
      )}

      {/* 综合评价 */}
      {result.comprehensiveEvaluation && (
        <Card className="custom-card mb-m" title="综合评价">
          {result.comprehensiveEvaluation.withinSameGrade && (
            <>
              <Divider orientation="left">同强度等级内评价</Divider>
              {Object.entries(result.comprehensiveEvaluation.withinSameGrade).map(([grade, eval_]) => (
                <Alert
                  key={grade}
                  type="success"
                  showIcon
                  message={<><Tag color="blue">{grade}</Tag> 最优配合比: {eval_.optimalMixDesign} (评分: {eval_.score})</>}
                  description={
                    <div>
                      <p>{eval_.summary}</p>
                      <p>原因: {eval_.reasons?.join('、')}</p>
                    </div>
                  }
                  style={{ marginBottom: 12 }}
                />
              ))}
            </>
          )}

          {result.comprehensiveEvaluation.acrossGrades && (
            <>
              <Divider orientation="left">跨强度等级评价</Divider>
              <Alert
                type="info"
                showIcon
                message="综合评价"
                description={
                  <div>
                    <p>{result.comprehensiveEvaluation.acrossGrades.summary}</p>
                    {result.comprehensiveEvaluation.acrossGrades.materialRecommendations?.map((rec, i) => (
                      <p key={i}>• {rec}</p>
                    ))}
                  </div>
                }
              />
            </>
          )}
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

      // 收集试验结果数值
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

    // 计算统计值
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
      // 准备发送给AI的数据
      const data = {
        summary: {
          totalMixDesigns: mixDesigns.length,
          strengthGrades: [...new Set(mixDesigns.map(m => m.strengthGrade))],
          totalMaterials: Object.keys(materialMapping).length
        },
        groupedStatistics: calculateGroupedStatistics(mixDesigns),
        mixDesigns: mixDesigns.map((m, index) => ({
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
          materials: Object.fromEntries(
            Object.entries(m.materials || {}).map(([key, value]) => {
              const mapped = materialMapping[m.id]?.[key]
              return [key, mapped ? { ...mapped, name: value } : { name: value }]
            })
          ),
          testResults: m.testResults || {}
        })),
        analysisRequirements: {
          analyzeMaterialInfluences: true,
          analyzeMixDesignInfluences: true,
          generateOptimalMixDesign: true,
          provideSuggestions: true,
          comprehensiveEvaluation: true
        }
      }

      const result = await window.electronAPI.invoke('aiAnalysis:analyze', data)
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
      // 构建上下文数据
      const context = {
        mixDesignsCount: mixDesigns.length,
        analysisResult: analysisResult,
        mixDesigns: mixDesigns.slice(0, 5) // 只传前5条作为上下文
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

  const items = [
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
      key: 'analysis-report',
      label: '分析报告',
      children: (
        <div>
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
                              {item.content}
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

  return (
    <div className="page-container">

      <div className="custom-card">
        <Tabs
          items={items}
          defaultActiveKey="data-import"
          size="large"
        />
      </div>
    </div>
  )
}

export default AIAnalysisPage
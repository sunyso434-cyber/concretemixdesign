// src/renderer/pages/massConcrete/StressTab.jsx
import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, InputNumber, message, Divider, Alert, Tag } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setStressData } from '../../../store/massConcreteSlice'
import StressChart from '../../components/charts/StressChart'
import CrackRiskGauge from './CrackRiskGauge'

const { Option } = Select

/**
 * 温度应力计算标签页组件
 * 用于计算大体积混凝土的温度应力和裂缝风险评估
 * @param {Function} onCalculate - 计算完成后的回调函数
 * @param {Function} onNavigate - 导航到指定标签页的回调函数
 */
const StressTab = ({ onCalculate, onNavigate }) => {
  const dispatch = useDispatch()
  const stressData = useSelector(state => state.massConcrete.stressData)
  const adiabaticTempData = useSelector(state => state.massConcrete.adiabaticTempData)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [crackRiskResult, setCrackRiskResult] = useState(null)

  // 调试用：追踪 stressData 变化
  useEffect(() => {
    console.log('[StressTab] stressData 变化:', stressData ? {
      keys: Object.keys(stressData),
      selfConstraintStressLength: stressData.selfConstraintStress?.length,
      maxSelfStress: stressData.maxSelfStress
    } : null)
  }, [stressData])

  // 直接计算图表数据
  const selfConstraintStressData = stressData?.selfConstraintStress?.map(item => ({ time: item.day, stress: item.stress })) || []
  const externalConstraintStressData = stressData?.externalConstraintStress?.map(item => ({ time: item.day, stress: item.stress })) || []
  const totalStressData = stressData?.totalStress?.map(item => ({ time: item.day, stress: item.total })) || []

  console.log('[StressTab] 直接计算图表数据:', {
    selfLength: selfConstraintStressData.length,
    selfFirst3: selfConstraintStressData.slice(0, 3)
  })

  // 计算裂缝风险
  const calculateCrackRisk = async (stressResult) => {
    try {
      // 从温度差曲线计算温降速率
      const tempDiffCurve = adiabaticTempData?.tempDiffCurveData || []
      const tempGradientData = tempDiffCurve.map((d, idx) => {
        const prevDiff = idx > 0 ? tempDiffCurve[idx - 1].tempDiff : d.tempDiff
        const gradient = idx > 0 ? Math.abs(d.tempDiff - prevDiff) / 0.5 : 0
        return { day: d.day, gradient }
      })

      const crackRiskResponse = await window.electron.ipcRenderer.invoke('mc_calculateCrackRisk', {
        maxStress: stressResult.maxTotalStress || stressResult.maxSelfStress || 0,
        allowableStress: stressResult.allowableStress || 2.01,
        tempGradientData,
        exceedDuration: 0,
        crackResistanceCoeff: 1.15,
        strengthGrade: form.getFieldValue('strengthGrade') || 'C30'
      })

      if (crackRiskResponse.success) {
        setCrackRiskResult(crackRiskResponse.data)
      }
    } catch (error) {
      console.error('裂缝风险计算失败:', error)
    }
  }

  // 计算温度应力
  const calculateStress = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      const params = {
        // === 强度等级：从上游继承 ===
        strengthGrade: adiabaticTempData?.strengthGrade || 'C30',

        // === 掺量比例：传递给后端计算 beta ===
        flyAshRatio: adiabaticTempData?.flyAshRatio || 0,
        slagRatio: adiabaticTempData?.slagRatio || 0,

        // === 构件参数：从上游继承 ===
        concreteThickness: adiabaticTempData?.concreteThickness || 2,
        concreteLength: adiabaticTempData?.concreteLength || 50,

        // === 温度数据：关键输入 ===
        tempDiffCurveData: adiabaticTempData?.tempDiffCurveData || [],

        // === 最大温升：用于温控校验 ===
        maxAdiabaticTemp: adiabaticTempData?.maxAdiabaticTemp || 0,

        // === 蠕变系数：用户可调 ===
        relaxationCoefficient: values.relaxationCoefficient || 0.5
      }

      console.log('[StressTab] 调用应力计算，参数:', JSON.stringify({
        ...params,
        tempDiffCurveData: params.tempDiffCurveData?.length ? `Array(${params.tempDiffCurveData.length})` : []
      }))

      const result = await window.electron.ipcRenderer.invoke('mc_calculateStress', params)

      console.log('[StressTab] 应力计算结果:', result.success ? {
        hasData: !!result.data,
        dataKeys: result.data ? Object.keys(result.data) : [],
        selfConstraintStressLength: result.data?.selfConstraintStress?.length,
        externalConstraintStressLength: result.data?.externalConstraintStress?.length,
        totalStressLength: result.data?.totalStress?.length,
        maxSelfStress: result.data?.maxSelfStress,
        maxExternalStress: result.data?.maxExternalStress,
        maxTotalStress: result.data?.maxTotalStress
      } : result.error)

      if (result.success) {
        console.log('[StressTab] dispatch 前，result.data.selfConstraintStress 存在:', !!result.data.selfConstraintStress, '长度:', result.data.selfConstraintStress?.length)

        // === 添加温控指标校验 ===
        const maxInternalTemp = adiabaticTempData?.maxAdiabaticTemp || 0
        const tempDiffCurve = adiabaticTempData?.tempDiffCurveData || []
        const maxTempDiff = tempDiffCurve.length > 0 ? Math.max(...tempDiffCurve.map(d => d.tempDiff)) : 0

        // 计算降温速率（取最大降温阶段的速率）
        let coolingRate = 2.0 // 默认值
        if (tempDiffCurve.length > 1) {
          let maxCoolingRate = 0
          for (let i = 1; i < tempDiffCurve.length; i++) {
            const dayDiff = tempDiffCurve[i].day - tempDiffCurve[i - 1].day
            if (dayDiff > 0) {
              const rate = Math.abs(tempDiffCurve[i].tempDiff - tempDiffCurve[i - 1].tempDiff) / dayDiff
              if (rate > maxCoolingRate) maxCoolingRate = rate
            }
          }
          coolingRate = maxCoolingRate
        }

        const tempControlCheck = {
          maxInternalTempOk: maxInternalTemp <= 70,
          tempDiffOk: maxTempDiff <= 25,
          coolingRateOk: coolingRate <= 2,
          allPassed: maxInternalTemp <= 70 && maxTempDiff <= 25 && coolingRate <= 2
        }

        // 合并温控校验结果到 stressData
        const stressDataWithCheck = {
          ...result.data,
          tempControlCheck,
          _coolingRate: coolingRate, // 保存降温速率供显示用
          // 同时保存上游数据引用，方便下游使用
          _upstreamData: {
            strengthGrade: params.strengthGrade,
            concreteThickness: params.concreteThickness,
            concreteLength: params.concreteLength
          }
        }

        dispatch(setStressData(stressDataWithCheck))
        console.log('[StressTab] dispatch 完成')
        message.success('温度应力计算成功')
        // 计算裂缝风险
        await calculateCrackRisk(stressDataWithCheck)
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

  return (
    <div>
      <Card className="custom-card" title="应力计算参数">
        <Alert
          message="参数说明"
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>强度等级、构件尺寸等参数已从温升计算结果自动继承，无需重复输入</li>
              <li>仅蠕变系数 H 需要调整（影响松弛效应），默认值 0.5</li>
            </ul>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {/* 上游数据只读显示 */}
        <div className="grid-2-col" style={{ marginBottom: 16 }}>
          <div>
            <span style={{ color: '#666' }}>强度等级：</span>
            <span style={{ fontWeight: 500 }}>{adiabaticTempData?.strengthGrade || '-'}</span>
          </div>
          <div>
            <span style={{ color: '#666' }}>构件尺寸：</span>
            <span style={{ fontWeight: 500 }}>
              {adiabaticTempData?.concreteLength || '-'} m × {adiabaticTempData?.concreteThickness || '-'} m
            </span>
          </div>
        </div>

        <Form
          form={form}
          layout="vertical"
          initialValues={{
            relaxationCoefficient: 0.5
          }}
        >
          <Form.Item
            name="relaxationCoefficient"
            label="蠕变系数 H"
            extra="用于计算应力松弛效应，值越大松弛越明显"
            rules={[{ required: true, message: '请输入蠕变系数' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0.1}
              max={1.0}
              precision={2}
              placeholder="如 0.5"
            />
          </Form.Item>
        </Form>

        <div style={{ marginTop: 24 }}>
          <Button
            type="primary"
            className="custom-btn"
            onClick={calculateStress}
            loading={loading}
            disabled={!adiabaticTempData}
          >
            计算温度应力
          </Button>
          {!adiabaticTempData && (
            <span style={{ marginLeft: 16, color: '#ff4d4f' }}>
              请先在温度升幅标签页计算温度数据
            </span>
          )}
        </div>
      </Card>

      {/* 计算结果图表展示 */}
      {stressData && (
        <>
          {/* 温控指标校验结果 */}
          {stressData.tempControlCheck && (
            <Card className="custom-card" title="温控指标校验" style={{ marginTop: 16 }}>
              <div className="grid-3-col">
                <div style={{ textAlign: 'center' }}>
                  <Tag color={stressData.tempControlCheck.maxInternalTempOk ? 'green' : 'red'} style={{ fontSize: 16, padding: '4px 12px' }}>
                    {stressData.tempControlCheck.maxInternalTempOk ? '✓' : '✗'}
                  </Tag>
                  <div style={{ marginTop: 8 }}>内部最高温度 ≤ 70°C</div>
                  <div style={{ color: '#666', fontSize: 12 }}>
                    当前: {adiabaticTempData?.maxAdiabaticTemp?.toFixed(1) || '-'} °C
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Tag color={stressData.tempControlCheck.tempDiffOk ? 'green' : 'red'} style={{ fontSize: 16, padding: '4px 12px' }}>
                    {stressData.tempControlCheck.tempDiffOk ? '✓' : '✗'}
                  </Tag>
                  <div style={{ marginTop: 8 }}>里表温差 ≤ 25°C</div>
                  <div style={{ color: '#666', fontSize: 12 }}>
                    当前: {Math.max(...(adiabaticTempData?.tempDiffCurveData || []).map(d => d.tempDiff)).toFixed(1) || '-'} °C
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Tag color={stressData.tempControlCheck.coolingRateOk ? 'green' : 'red'} style={{ fontSize: 16, padding: '4px 12px' }}>
                    {stressData.tempControlCheck.coolingRateOk ? '✓' : '✗'}
                  </Tag>
                  <div style={{ marginTop: 8 }}>降温速率 ≤ 2°C/d</div>
                  <div style={{ color: '#666', fontSize: 12 }}>
                    当前: {stressData._coolingRate?.toFixed(2) || '-'} °C/d
                  </div>
                </div>
              </div>
              {!stressData.tempControlCheck.allPassed && (
                <Alert
                  message="温控指标未全部通过，建议返回上游调整参数"
                  description={
                    <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                      <li><a onClick={() => onNavigate?.('mixdesign')}>配合比设计</a> — 降低水泥用量，增加粉煤灰/矿渣粉</li>
                      <li><a onClick={() => onNavigate?.('temprise')}>温升计算</a> — 降低入模温度，增加保温</li>
                    </ul>
                  }
                  type="warning"
                  showIcon
                  style={{ marginTop: 16 }}
                />
              )}
            </Card>
          )}

          <Card className="custom-card" title="应力变化曲线" style={{ marginTop: 16 }}>
            <StressChart
              selfConstraintStress={selfConstraintStressData}
              externalConstraintStress={externalConstraintStressData}
              totalStress={totalStressData}
              tensileStrength={stressData.ftk || form.getFieldValue('tensileStrength')}
              title="温度应力-时间曲线"
            />
          </Card>

          <Card className="custom-card" title="应力计算结果" style={{ marginTop: 16 }}>
            <div className="grid-2-col">
              <div>
                <h4>应力参数</h4>
                <ul>
                  <li>最大自约束应力: {stressData.maxSelfStress ? stressData.maxSelfStress.toFixed(2) : '-'} MPa</li>
                  <li>最大外约束应力: {stressData.maxExternalStress ? stressData.maxExternalStress.toFixed(2) : '-'} MPa</li>
                  <li>最大总应力: {stressData.maxTotalStress ? stressData.maxTotalStress.toFixed(2) : '-'} MPa</li>
                </ul>
              </div>
              <div>
                <h4>裂缝风险评估</h4>
                <ul>
                  <li>抗拉强度: {stressData.ftk || '-'} MPa</li>
                  <li>应力安全系数: {stressData.correctedSafetyFactor ? stressData.correctedSafetyFactor.toFixed(2) : '-'}</li>
                  <li>允许应力: {stressData.allowableStress ? stressData.allowableStress.toFixed(2) : '-'} MPa</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* 裂缝风险仪表盘 */}
          {crackRiskResult && (
            <CrackRiskGauge result={crackRiskResult} />
          )}
        </>
      )}
    </div>
  )
}

export default StressTab
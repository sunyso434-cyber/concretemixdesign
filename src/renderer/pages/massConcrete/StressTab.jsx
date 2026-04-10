// src/renderer/pages/massConcrete/StressTab.jsx
import React, { useState } from 'react'
import { Card, Form, Input, Select, Button, InputNumber, message } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setStressData } from '../../../store/massConcreteSlice'
import StressChart from '../../components/charts/StressChart'

const { Option } = Select

/**
 * 温度应力计算标签页组件
 * 用于计算大体积混凝土的温度应力和裂缝风险评估
 * @param {Function} onCalculate - 计算完成后的回调函数
 */
const StressTab = ({ onCalculate }) => {
  const dispatch = useDispatch()
  const stressData = useSelector(state => state.massConcrete.stressData)
  const adiabaticTempData = useSelector(state => state.massConcrete.adiabaticTempData)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  // 计算温度应力
  const calculateStress = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      const params = {
        elasticModulus: values.elasticModulus || 3.0e10,
        tensileStrength: values.tensileStrength || 2.5,
        thermalCoefficient: values.thermalCoefficient || 1.0e-5,
        creepCoefficient: values.creepCoefficient || 0.5,
        tempRiseData: adiabaticTempData || {}
      }

      const result = await window.electron.ipcRenderer.invoke('mc_calculateStress', params)

      if (result.success) {
        dispatch(setStressData(result.data))
        message.success('温度应力计算成功')
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

  // 格式化图表数据
  const getSelfConstraintStressData = () => {
    if (!stressData?.selfConstraintStress) return []
    return stressData.selfConstraintStress.map(item => ({
      time: item.time,
      stress: item.stress
    }))
  }

  const getExternalConstraintStressData = () => {
    if (!stressData?.externalConstraintStress) return []
    return stressData.externalConstraintStress.map(item => ({
      time: item.time,
      stress: item.stress
    }))
  }

  const getTotalStressData = () => {
    if (!stressData?.totalStress) return []
    return stressData.totalStress.map(item => ({
      time: item.time,
      stress: item.stress
    }))
  }

  return (
    <div>
      <Card className="custom-card" title="应力计算参数">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            elasticModulus: 3.0e10,
            tensileStrength: 2.5,
            thermalCoefficient: 1.0e-5,
            creepCoefficient: 0.5
          }}
        >
          <div className="grid-2-col">
            <Form.Item
              name="elasticModulus"
              label="弹性模量 (Pa)"
              rules={[{ required: true, message: '请输入弹性模量' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 3.0e10"
                min={1.0e9}
                max={1.0e12}
                precision={0}
              />
            </Form.Item>

            <Form.Item
              name="tensileStrength"
              label="抗拉强度 (MPa)"
              rules={[{ required: true, message: '请输入抗拉强度' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 2.5"
                min={0.5}
                max={5}
                precision={2}
              />
            </Form.Item>

            <Form.Item
              name="thermalCoefficient"
              label="热膨胀系数 (1/°C)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 1.0e-5"
                min={0.5e-5}
                max={2.0e-5}
                precision={6}
              />
            </Form.Item>

            <Form.Item
              name="creepCoefficient"
              label="蠕变系数"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 0.5"
                min={0}
                max={2}
                precision={2}
              />
            </Form.Item>
          </div>
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
          <Card className="custom-card" title="应力变化曲线" style={{ marginTop: 16 }}>
            <StressChart
              selfConstraintStress={getSelfConstraintStressData()}
              externalConstraintStress={getExternalConstraintStressData()}
              totalStress={getTotalStressData()}
              tensileStrength={stressData.tensileStrength || form.getFieldValue('tensileStrength')}
              title="温度应力-时间曲线"
            />
          </Card>

          <Card className="custom-card" title="应力计算结果" style={{ marginTop: 16 }}>
            <div className="grid-2-col">
              <div>
                <h4>应力参数</h4>
                <ul>
                  <li>最大自约束应力: {stressData.maxSelfConstraintStress ? stressData.maxSelfConstraintStress.toFixed(2) : '-'} MPa</li>
                  <li>最大外约束应力: {stressData.maxExternalConstraintStress ? stressData.maxExternalConstraintStress.toFixed(2) : '-'} MPa</li>
                  <li>最大总应力: {stressData.maxTotalStress ? stressData.maxTotalStress.toFixed(2) : '-'} MPa</li>
                </ul>
              </div>
              <div>
                <h4>裂缝风险评估</h4>
                <ul>
                  <li>抗拉强度: {stressData.tensileStrength || '-'} MPa</li>
                  <li>应力安全系数: {stressData.safetyFactor ? stressData.safetyFactor.toFixed(2) : '-'}</li>
                  <li>裂缝风险: {stressData.crackingRisk || '-'}</li>
                </ul>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

export default StressTab
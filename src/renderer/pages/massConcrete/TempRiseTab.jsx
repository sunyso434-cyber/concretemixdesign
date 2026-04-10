// src/renderer/pages/massConcrete/TempRiseTab.jsx
import React, { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, InputNumber, message } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setAdiabaticTempData } from '../../../store/massConcreteSlice'
import TempRiseChart from '../../components/charts/TempRiseChart'
import TempDistributionChart from '../../components/charts/TempDistributionChart'

const { Option } = Select

/**
 * 温度升幅计算标签页组件
 * 用于计算大体积混凝土的绝热温升和温度场分布
 * @param {Function} onCalculate - 计算完成后的回调函数
 */
const TempRiseTab = ({ onCalculate }) => {
  const dispatch = useDispatch()
  const adiabaticTempData = useSelector(state => state.massConcrete.adiabaticTempData)
  const mixDesignData = useSelector(state => state.massConcrete.mixDesignData)

  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  // 计算绝热温升
  const calculateAdiabaticTemp = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()

      const params = {
        cementConsumption: values.cementConsumption,
        flyAshDosage: values.flyAshDosage || 0,
        slagDosage: values.slagDosage || 0,
        ambientTemp: values.ambientTemp || 20,
        initialTemp: values.initialTemp || 20,
        placementTemp: values.placementTemp || 25,
        memberSize: {
          length: values.memberLength || 10,
          width: values.memberWidth || 5,
          height: values.memberHeight || 2
        }
      }

      const result = await window.electron.ipcRenderer.invoke('mc_calculateAdiabaticTemp', params)

      if (result.success) {
        dispatch(setAdiabaticTempData(result.data))
        message.success('温度升幅计算成功')
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
  const getTempCurveData = () => {
    if (!adiabaticTempData?.tempCurve) return []
    return adiabaticTempData.tempCurve.map(item => ({
      time: item.time,
      temperature: item.temperature
    }))
  }

  const getTempDiffCurveData = () => {
    if (!adiabaticTempData?.tempDiffCurve) return []
    return adiabaticTempData.tempDiffCurve.map(item => ({
      time: item.time,
      temperature: item.temperature
    }))
  }

  return (
    <div>
      <Card className="custom-card" title="温度计算参数">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            cementConsumption: mixDesignData?.materials?.cement || 280,
            flyAshDosage: mixDesignData?.flyAshDosage || 20,
            slagDosage: mixDesignData?.slagDosage || 10,
            ambientTemp: 20,
            initialTemp: 20,
            placementTemp: 25,
            memberLength: 10,
            memberWidth: 5,
            memberHeight: 2
          }}
        >
          <div className="grid-2-col">
            <Form.Item
              name="cementConsumption"
              label="水泥用量 (kg/m³)"
              rules={[{ required: true, message: '请输入水泥用量' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 280"
                min={150}
                max={500}
                precision={0}
              />
            </Form.Item>

            <Form.Item
              name="flyAshDosage"
              label="粉煤灰掺量 (%)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 20"
                min={0}
                max={50}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="slagDosage"
              label="矿渣粉掺量 (%)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 10"
                min={0}
                max={60}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="ambientTemp"
              label="环境温度 (°C)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 20"
                min={-20}
                max={50}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="initialTemp"
              label="混凝土入模温度 (°C)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 20"
                min={0}
                max={40}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="placementTemp"
              label="浇筑温度 (°C)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 25"
                min={0}
                max={40}
                precision={1}
              />
            </Form.Item>
          </div>

          <div className="grid-3-col" style={{ marginTop: 16 }}>
            <Form.Item
              name="memberLength"
              label="构件长度 (m)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 10"
                min={1}
                max={100}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="memberWidth"
              label="构件宽度 (m)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 5"
                min={1}
                max={100}
                precision={1}
              />
            </Form.Item>

            <Form.Item
              name="memberHeight"
              label="构件高度 (m)"
            >
              <InputNumber
                style={{ width: '100%' }}
                placeholder="如 2"
                min={0.5}
                max={10}
                precision={1}
              />
            </Form.Item>
          </div>
        </Form>

        <div style={{ marginTop: 24 }}>
          <Button
            type="primary"
            className="custom-btn"
            onClick={calculateAdiabaticTemp}
            loading={loading}
          >
            计算温度升幅
          </Button>
        </div>
      </Card>

      {/* 计算结果图表展示 */}
      {adiabaticTempData && (
        <>
          <Card className="custom-card" title="温度升幅曲线" style={{ marginTop: 16 }}>
            <TempRiseChart
              tempCurveData={getTempCurveData()}
              tempDiffCurveData={getTempDiffCurveData()}
              title="温度-时间曲线"
            />
          </Card>

          <Card className="custom-card" title="温度分布" style={{ marginTop: 16 }}>
            <TempDistributionChart
              tempDistributionData={adiabaticTempData.tempDistribution || []}
              title="温度场分布"
            />
          </Card>

          <Card className="custom-card" title="温度计算结果" style={{ marginTop: 16 }}>
            <div className="grid-2-col">
              <div>
                <h4>温升参数</h4>
                <ul>
                  <li>最高温度: {adiabaticTempData.maxTemp ? adiabaticTempData.maxTemp.toFixed(1) : '-'} °C</li>
                  <li>最终温升: {adiabaticTempData.finalTempRise ? adiabaticTempData.finalTempRise.toFixed(1) : '-'} °C</li>
                  <li>温升速率: {adiabaticTempData.tempRiseRate ? adiabaticTempData.tempRiseRate.toFixed(2) : '-'} °C/d</li>
                </ul>
              </div>
              <div>
                <h4>时间参数</h4>
                <ul>
                  <li>到达最高温度时间: {adiabaticTempData.timeToPeak || '-'} d</li>
                  <li>升温期: {adiabaticTempData.heatingPeriod || '-'} d</li>
                  <li>降温期: {adiabaticTempData.coolingPeriod || '-'} d</li>
                </ul>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

export default TempRiseTab
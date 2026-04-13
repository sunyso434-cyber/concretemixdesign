// src/renderer/components/charts/TemperatureFieldChart.jsx
import React from 'react'
import { Row, Col } from 'antd'
import IsothermChart from './IsothermChart'
import TempPosCurveChart from './TempPosCurveChart'
import TempTimeCurveChart from './TempTimeCurveChart'
import TempDiffCurveChart from './TempDiffCurveChart'

/**
 * 温度场综合图表组件
 * 包含等温线图、温度-位置曲线、温度-时间曲线、内外温差曲线
 * @param {Object} temperatureFieldData - 温度场数据
 */
const TemperatureFieldChart = ({ temperatureFieldData }) => {
  if (!temperatureFieldData) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        color: '#666',
        background: '#f5f5f5',
        borderRadius: 4
      }}>
        暂无温度场数据
      </div>
    )
  }

  const { temperatureField, centerHistory, surfaceHistory, tempDiffHistory } = temperatureFieldData

  return (
    <Row gutter={16}>
      <Col span={12}>
        <IsothermChart data={temperatureField} />
      </Col>
      <Col span={12}>
        <TempPosCurveChart data={temperatureField} />
      </Col>
      <Col span={12}>
        <TempTimeCurveChart
          centerHistory={centerHistory}
          surfaceHistory={surfaceHistory}
        />
      </Col>
      <Col span={12}>
        <TempDiffCurveChart
          interiorSurfaceDiffData={tempDiffHistory.time.map((t, i) => ({
            day: t,
            tempDiff: tempDiffHistory.tempDiff[i]
          }))}
        />
      </Col>
    </Row>
  )
}

export default TemperatureFieldChart
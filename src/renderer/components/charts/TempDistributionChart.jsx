// src/renderer/components/charts/TempDistributionChart.jsx
import React from 'react'
import { Card, Radio } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 温度分布图表组件
 * 支持两种视图：
 * 1. 时间-温度曲线：X轴=时间，Y轴=温度，不同位置=不同曲线
 * 2. 位置-温度曲线：X轴=位置（百分比），Y轴=温度，不同时间=不同曲线
 * @param {Array} tempFieldData - 温度场数据 [{day, position, distance, temperature}]
 * @param {string} title - 图表标题
 */
const TempDistributionChart = ({
  tempFieldData = [],
  title = '温度场分布'
}) => {
  // viewMode: 'time' 表示时间-温度视图，'position' 表示位置-温度视图
  const [viewMode, setViewMode] = React.useState('time')

  // 获取唯一的时间点
  const uniqueDays = React.useMemo(() => {
    if (!tempFieldData || tempFieldData.length === 0) return []
    const days = [...new Set(tempFieldData.map(d => d.day))].sort((a, b) => a - b)
    return days
  }, [tempFieldData])

  // 获取唯一的位置点
  const uniquePositions = React.useMemo(() => {
    if (!tempFieldData || tempFieldData.length === 0) return []
    const positions = [...new Set(tempFieldData.map(d => d.position))].sort((a, b) => a - b)
    return positions
  }, [tempFieldData])

  // 根据视图模式准备图表数据
  const chartData = React.useMemo(() => {
    if (!tempFieldData || tempFieldData.length === 0) return []

    if (viewMode === 'time') {
      // 视图1：X轴=时间，Y轴=温度，不同位置=不同曲线
      return tempFieldData.map(item => ({
        time: item.day,
        temperature: item.temperature,
        series: `位置${item.position.toFixed(0)}%`
      }))
    } else {
      // 视图2：X轴=位置（百分比），Y轴=温度，不同时间=不同曲线
      return tempFieldData.map(item => ({
        position: item.position,
        temperature: item.temperature,
        series: `${item.day}d`
      }))
    }
  }, [tempFieldData, viewMode])

  const config = {
    data: chartData,
    xField: viewMode === 'time' ? 'time' : 'position',
    yField: 'temperature',
    smooth: true,
    seriesField: 'series',
    point: {
      size: 3,
      shape: 'circle',
      style: {
        fill: 'white',
        stroke: '#52c41a',
        lineWidth: 2,
      },
    },
    meta: {
      time: { alias: '时间' },
      position: { alias: '位置' },
      temperature: { alias: '温度' },
    },
    xAxis: {
      title: {
        text: viewMode === 'time' ? '时间 (d)' : '距中心距离 (%)',
        style: { fontSize: 12, fill: '#666' },
      },
      grid: {
        line: {
          style: { stroke: '#e8e8e8', lineDash: [4, 4] },
        },
      },
    },
    yAxis: {
      title: {
        text: '温度 (°C)',
        style: { fontSize: 12, fill: '#666' },
      },
      grid: {
        line: {
          style: { stroke: '#e8e8e8', lineDash: [4, 4] },
        },
      },
    },
    title: {
      text: title,
      style: { fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
    },
    color: ['#1890ff', '#52c41a', '#fa8c16', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#000'],
    lineStyle: { lineWidth: 2 },
    tooltip: {
      showCrosshairs: true,
      crosshairs: {
        line: {
          style: { stroke: '#52c41a', lineDash: [4, 4] },
        },
      },
    },
    legend: {
      position: 'top-right',
    },
    animation: {
      appear: { animation: 'wave-in', duration: 1000 },
    },
  }

  return (
    <Card size="small">
      <div style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Radio.Group value={viewMode} onChange={e => setViewMode(e.target.value)}>
          <Radio.Button value="time">时间-温度曲线</Radio.Button>
          <Radio.Button value="position">位置-温度曲线</Radio.Button>
        </Radio.Group>
        {viewMode === 'time' && (
          <span style={{ color: '#666', fontSize: 12 }}>
            显示{uniquePositions.length}个位置的温度随时间变化
          </span>
        )}
        {viewMode === 'position' && (
          <span style={{ color: '#666', fontSize: 12 }}>
            显示{uniqueDays.length}个时刻的温度沿位置分布
          </span>
        )}
      </div>
      <Line {...config} style={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default TempDistributionChart
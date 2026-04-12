// src/renderer/components/charts/TempTimeCurveChart.jsx
import React from 'react'
import ReactECharts from 'echarts-for-react'
import {
  colors,
  createXAxis,
  createYAxis,
  tooltipConfig,
  legendConfig,
} from './chartConfig'

/**
 * 温度-时间曲线组件
 * 展示中心点和表面点温度随时间变化
 * @param {Object} centerHistory - 中心点温度历史 {time: number[], temp: number[]}
 * @param {Object} surfaceHistory - 表面点温度历史 {time: number[], temp: number[]}
 */
const TempTimeCurveChart = ({
  centerHistory = { time: [], temp: [] },
  surfaceHistory = { time: [], temp: [] }
}) => {
  // 处理中心点数据
  const centerData = []
  if (Array.isArray(centerHistory.time) && Array.isArray(centerHistory.temp)) {
    centerHistory.time.forEach((day, i) => {
      centerData.push([day, centerHistory.temp[i]])
    })
  }

  // 处理表面点数据
  const surfaceData = []
  if (Array.isArray(surfaceHistory.time) && Array.isArray(surfaceHistory.temp)) {
    surfaceHistory.time.forEach((day, i) => {
      surfaceData.push([day, surfaceHistory.temp[i]])
    })
  }

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipConfig,
      formatter: function(params) {
        const data = params[0]
        return `时间: ${data.axisValue} d<br/>温度: ${data.value[1]} °C`
      }
    },
    legend: legendConfig(['中心点', '表面点']),
    xAxis: createXAxis('时间 (d)'),
    yAxis: createYAxis('温度 (°C)'),
    series: [
      {
        name: '中心点',
        type: 'line',
        data: centerData,
        smooth: true,
        lineStyle: { width: 2, color: colors.primary },
        itemStyle: { color: colors.primary },
        emphasis: {
          focus: 'series',
          itemStyle: {
            borderWidth: 2,
            borderColor: '#fff',
            shadowBlur: 10,
            shadowColor: 'rgba(0, 212, 255, 0.5)',
          }
        }
      },
      {
        name: '表面点',
        type: 'line',
        data: surfaceData,
        smooth: true,
        lineStyle: { width: 2, color: colors.secondary },
        itemStyle: { color: colors.secondary },
        emphasis: {
          focus: 'series',
          itemStyle: {
            borderWidth: 2,
            borderColor: '#fff',
            shadowBlur: 10,
            shadowColor: 'rgba(24, 144, 255, 0.5)',
          }
        }
      }
    ]
  }

  return (
    <ReactECharts option={option} style={{ width: '100%', height: 300 }} />
  )
}

export default TempTimeCurveChart
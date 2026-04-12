// src/renderer/components/charts/TempRiseChart.jsx
import React from 'react'
import ReactECharts from 'echarts-for-react'
import {
  colors,
  createXAxis,
  createYAxis,
  tooltipConfig,
} from './chartConfig'

/**
 * 温度升幅图表组件
 * 用于显示混凝土内部温度随时间的变化曲线
 * @param {Array} tempCurveData - 温度曲线数据 [{day: number, temperature: number}]
 * @param {string} title - 图表标题
 */
const TempRiseChart = ({
  tempCurveData = [],
  title = '温度升幅曲线'
}) => {
  // 转换数据格式为 [[day, temp], ...]
  const chartData = tempCurveData.map(item => [item.day, item.temperature])

  const option = {
    backgroundColor: 'transparent',
    title: {
      text: title,
      left: 'center',
      textStyle: {
        color: colors.dark,
        fontSize: 14,
        fontWeight: 'bold',
      }
    },
    tooltip: {
      ...tooltipConfig,
      formatter: function(params) {
        const data = params[0]
        return `时间: ${data.axisValue} d<br/>温度: ${data.value[1]} °C`
      }
    },
    xAxis: createXAxis('时间 (d)'),
    yAxis: createYAxis('温度 (°C)'),
    series: [{
      type: 'line',
      data: chartData,
      smooth: true,
      lineStyle: { width: 2, color: colors.primary },
      itemStyle: { color: colors.primary },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(0, 212, 255, 0.3)' },
            { offset: 1, color: 'rgba(0, 212, 255, 0.05)' }
          ]
        }
      },
      emphasis: {
        focus: 'series',
        itemStyle: {
          borderWidth: 2,
          borderColor: '#fff',
          shadowBlur: 10,
          shadowColor: 'rgba(0, 212, 255, 0.5)',
        }
      }
    }]
  }

  return (
    <ReactECharts option={option} style={{ width: '100%', height: 300 }} />
  )
}

export default TempRiseChart

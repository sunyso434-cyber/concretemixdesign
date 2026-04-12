// src/renderer/components/charts/TempPosCurveChart.jsx
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
 * 温度-位置曲线组件
 * 展示不同时刻沿厚度方向的温度分布
 * @param {Object} data - 温度场数据 {nodes: number[], times: number[], temperatures: number[][]}
 */
const TempPosCurveChart = ({ data = {} }) => {
  const { nodes = [], times = [], temperatures = [] } = data

  // 处理数据：每条线代表一个时刻
  const series = times.map((t, ti) => {
    const lineData = nodes.map((n, ni) => [n, temperatures[ti]?.[ni] ?? null])
    return {
      name: `${t.toFixed(1)}d`,
      type: 'line',
      data: lineData,
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
    }
  })

  // 配色循环
  series.forEach((s, i) => {
    const colorList = [colors.primary, colors.secondary, colors.tertiary]
    s.lineStyle.color = colorList[i % colorList.length]
    s.itemStyle.color = colorList[i % colorList.length]
  })

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipConfig,
      formatter: function(params) {
        const p = params[0]
        return `位置: ${p.axisValue}%<br/>温度: ${p.value[1]} °C<br/>时间: ${p.seriesName}`
      }
    },
    legend: legendConfig(times.map(t => `${t.toFixed(1)}d`)),
    xAxis: {
      ...createXAxis('位置 (%)'),
      type: 'value',
    },
    yAxis: createYAxis('温度 (°C)'),
    series,
  }

  return (
    <ReactECharts option={option} style={{ width: '100%', height: 300 }} />
  )
}

export default TempPosCurveChart
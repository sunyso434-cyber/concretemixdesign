// src/renderer/components/charts/TempDiffCurveChart.jsx
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
 * 温差曲线图表组件
 * 显示里表温差和表气温温随时间的变化
 * @param {Array} interiorSurfaceDiffData - 里表温差数据 [{day, tempDiff}]
 * @param {Array} surfaceAirDiffData - 表气温温数据 [{day, tempDiff}]
 * @param {string} title - 图表标题
 */
const TempDiffCurveChart = ({
  interiorSurfaceDiffData = [],
  surfaceAirDiffData = [],
  title = '温差曲线'
}) => {
  // 处理里表温差数据
  const interiorData = interiorSurfaceDiffData.map(item => [item.day, item.tempDiff])
  // 处理表气温温数据
  const surfaceData = surfaceAirDiffData.map(item => [item.day, item.tempDiff])

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
        return `时间: ${data.axisValue} d<br/>温差: ${data.value[1]} °C`
      }
    },
    legend: legendConfig(['里表温差', '表气温温']),
    xAxis: createXAxis('时间 (d)'),
    yAxis: createYAxis('温差 (°C)'),
    series: [
      {
        name: '里表温差',
        type: 'line',
        data: interiorData,
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
        name: '表气温温',
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

export default TempDiffCurveChart
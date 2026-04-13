// src/renderer/components/charts/IsothermChart.jsx
import React from 'react'
import ReactECharts from 'echarts-for-react'
import { colors } from './chartConfig'

/**
 * 等温线图（热力图）组件
 * 展示混凝土温度场分布
 * @param {Object} data - 温度场数据 {nodes: number[], times: number[], temperatures: number[][]}
 */
const IsothermChart = ({ data = {} }) => {
  const { nodes = [], times = [], temperatures = [] } = data

  // 转换数据为热力图格式 [[x, y, value], ...]
  const chartData = []
  times.forEach((t, ti) => {
    nodes.forEach((n, ni) => {
      chartData.push([n, t, temperatures[ti]?.[ni] ?? null])
    })
  })

  // 计算温度范围
  const allTemps = temperatures.flat().filter(t => t !== null)
  const minTemp = Math.min(...allTemps)
  const maxTemp = Math.max(...allTemps)

  const option = {
    backgroundColor: 'transparent',
    title: {
      text: '温度场热力图',
      left: 'center',
      textStyle: {
        color: colors.dark,
        fontSize: 14,
        fontWeight: 'bold',
      }
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(26, 58, 92, 0.9)',
      borderColor: 'transparent',
      borderRadius: 6,
      padding: [8, 12],
      textStyle: {
        color: '#fff',
        fontSize: 12,
      },
      formatter: function(params) {
        return `位置: ${params.value[0]}%<br/>时间: ${params.value[1]}d<br/>温度: ${params.value[2]} °C`
      }
    },
    xAxis: {
      type: 'value',
      name: '位置 (%)',
      nameLocation: 'end',
      nameGap: 8,
      nameTextStyle: {
        color: colors.dark,
        fontSize: 12,
      },
      axisLine: {
        lineStyle: { color: colors.dark }
      },
      axisTick: {
        alignWithLabel: true,
        inside: true,
      },
      axisLabel: {
        color: '#666',
        fontSize: 11,
      },
      splitLine: {
        lineStyle: {
          color: colors.grid,
          type: 'dashed',
        }
      },
    },
    yAxis: {
      type: 'value',
      name: '时间 (d)',
      nameLocation: 'end',
      nameGap: 8,
      nameTextStyle: {
        color: colors.dark,
        fontSize: 12,
      },
      axisLine: {
        lineStyle: { color: colors.dark }
      },
      axisTick: {
        inside: true,
      },
      axisLabel: {
        color: '#666',
        fontSize: 11,
      },
      splitLine: {
        lineStyle: {
          color: colors.grid,
          type: 'dashed',
        }
      },
    },
    visualMap: {
      min: minTemp,
      max: maxTemp,
      calculable: true,
      orient: 'vertical',
      right: 0,
      top: 'center',
      itemHeight: 150,
      itemWidth: 12,
      textStyle: {
        color: colors.dark,
        fontSize: 11,
      },
      inRange: {
        color: [
          '#1890ff',
          '#40a9ff',
          '#69c0ff',
          '#91d5ff',
          '#bae7ff',
          '#d9f0ff',
          '#fff7e6',
          '#ffe58f',
          '#ffd591',
          '#ffc069',
          '#ffa940',
          '#fa8c16',
          '#d46b08',
        ]
      }
    },
    series: [{
      type: 'heatmap',
      data: chartData,
      emphasis: {
        itemStyle: {
          borderColor: '#fff',
          borderWidth: 1,
        }
      }
    }]
  }

  return (
    <ReactECharts option={option} style={{ width: '100%', height: 300 }} />
  )
}

export default IsothermChart
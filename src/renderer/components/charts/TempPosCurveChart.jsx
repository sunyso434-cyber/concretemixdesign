// src/renderer/components/charts/TempPosCurveChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 温度-位置曲线组件
 * 展示不同时刻沿厚度方向的温度分布
 * @param {Object} data - 温度场数据
 */
const TempPosCurveChart = ({ data = {} }) => {
  // 转换数据：提取不同时刻的温度分布曲线
  const chartData = []
  const { temperatureField = [] } = data

  // 按时间分组
  const timeMap = new Map()
  temperatureField.forEach(item => {
    const key = item.time
    if (!timeMap.has(key)) {
      timeMap.set(key, [])
    }
    timeMap.get(key).push(item)
  })

  // 转换为图表数据
  timeMap.forEach((items, time) => {
    items.forEach(item => {
      chartData.push({
        position: item.position,
        temperature: item.temperature,
        time: time
      })
    })
  })

  const config = {
    data: chartData,
    xField: 'position',
    yField: 'temperature',
    seriesField: 'time',
    smooth: true,
    point: {
      size: 3,
      shape: 'circle',
      style: {
        fill: 'white',
        stroke: '#1890ff',
        lineWidth: 1,
      },
    },
    label: {
      style: {
        fontSize: 10,
        fill: '#666',
      },
    },
    meta: {
      position: {
        alias: '位置',
      },
      temperature: {
        alias: '温度 (°C)',
      },
      time: {
        alias: '时间',
      },
    },
    xAxis: {
      title: {
        text: '位置 (m)',
        style: {
          fontSize: 12,
          fill: '#666',
        },
      },
      grid: {
        line: {
          style: {
            stroke: '#e8e8e8',
            lineDash: [4, 4],
          },
        },
      },
    },
    yAxis: {
      title: {
        text: '温度 (°C)',
        style: {
          fontSize: 12,
          fill: '#666',
        },
      },
      grid: {
        line: {
          style: {
            stroke: '#e8e8e8',
            lineDash: [4, 4],
          },
        },
      },
    },
    legend: {
      position: 'top-right',
      title: {
        text: '时间 (d)',
        style: {
          fontSize: 12,
          fill: '#666',
        },
      },
    },
    tooltip: {
      showCrosshairs: true,
      crosshairs: {
        line: {
          style: {
            stroke: '#1890ff',
            lineDash: [4, 4],
          },
        },
      },
    },
    animation: {
      appear: {
        animation: 'wave-in',
        duration: 1000,
      },
    },
  }

  return (
    <Card size="small" title="温度-位置曲线">
      <Line {...config} style={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default TempPosCurveChart
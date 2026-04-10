// src/renderer/components/charts/TempTimeCurveChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 温度-时间曲线组件
 * 展示中心点和表面点温度随时间变化
 * @param {Array} centerHistory - 中心点温度历史 [{day: number, temperature: number}]
 * @param {Array} surfaceHistory - 表面点温度历史 [{day: number, temperature: number}]
 */
const TempTimeCurveChart = ({
  centerHistory = [],
  surfaceHistory = []
}) => {
  // 转换数据：合并中心点和表面点数据
  const chartData = []

  centerHistory.forEach(item => {
    chartData.push({
      day: item.day,
      temperature: item.temperature,
      location: '中心点'
    })
  })

  surfaceHistory.forEach(item => {
    chartData.push({
      day: item.day,
      temperature: item.temperature,
      location: '表面点'
    })
  })

  const config = {
    data: chartData,
    xField: 'day',
    yField: 'temperature',
    seriesField: 'location',
    smooth: true,
    point: {
      size: 4,
      shape: 'circle',
      style: {
        fill: 'white',
        stroke: '#1890ff',
        lineWidth: 2,
      },
    },
    label: {
      style: {
        fontSize: 12,
        fill: '#666',
      },
    },
    meta: {
      day: {
        alias: '时间',
      },
      temperature: {
        alias: '温度 (°C)',
      },
      location: {
        alias: '位置',
      },
    },
    xAxis: {
      title: {
        text: '时间 (d)',
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
        text: '位置',
        style: {
          fontSize: 12,
          fill: '#666',
        },
      },
    },
    color: ['#1890ff', '#ff7a45'],
    lineStyle: {
      lineWidth: 2,
    },
    tooltip: {
      showCrosshairs: true,
      crosshairs: {
        line: {
          style: {
            stroke: '#666',
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
    <Card size="small" title="温度-时间曲线">
      <Line {...config} style={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default TempTimeCurveChart
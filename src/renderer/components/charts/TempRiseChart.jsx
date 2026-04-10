// src/renderer/components/charts/TempRiseChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 温度升幅图表组件
 * 用于显示混凝土内部温度随时间的变化曲线
 * @param {Array} data - 温度数据数组 [{time: number, temperature: number}]
 * @param {string} title - 图表标题
 */
const TempRiseChart = ({ data = [], title = '温度升幅曲线' }) => {
  const config = {
    data,
    xField: 'time',
    yField: 'temperature',
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
      time: {
        alias: '时间 (h)',
      },
      temperature: {
        alias: '温度 (°C)',
      },
    },
    title: {
      text: title,
      style: {
        fontSize: 16,
        fontWeight: 'bold',
        textAlign: 'center',
      },
    },
    color: '#1890ff',
    lineStyle: {
      lineWidth: 2,
    },
    area: {
      style: {
        fill: 'l(270) 0:#1890ff00 1:#1890ff33',
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
    <Card size="small">
      <Line {...config} style={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default TempRiseChart
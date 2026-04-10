// src/renderer/components/charts/IsothermChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Heatmap } from '@ant-design/plots'

/**
 * 等温线图（热力图）组件
 * 展示混凝土温度场分布
 * @param {Array} data - 温度场数据 [{position: number, time: number, temperature: number}]
 */
const IsothermChart = ({ data = [] }) => {
  const config = {
    data,
    xField: 'position',
    yField: 'time',
    colorField: 'temperature',
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
      '#ad4e00',
    ],
    meta: {
      position: {
        alias: '位置',
      },
      time: {
        alias: '时间',
      },
      temperature: {
        alias: '温度 (°C)',
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
    legend: {
      title: {
        text: '温度 (°C)',
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
            stroke: '#666',
            lineDash: [4, 4],
          },
        },
      },
    },
    animation: {
      appear: {
        animation: 'fade-in',
        duration: 800,
      },
    },
  }

  return (
    <Card size="small" title="温度场热力图">
      <Heatmap {...config} style={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default IsothermChart
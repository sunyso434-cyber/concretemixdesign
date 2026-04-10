// src/renderer/components/charts/TempDistributionChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 温度分布图表组件
 * 用于显示混凝土内部温度在不同位置的分布
 * @param {Array} tempDistributionData - 温度分布数据 [{distance: number, temperature: number}]
 * @param {string} title - 图表标题
 */
const TempDistributionChart = ({
  tempDistributionData = [],
  title = '温度分布曲线'
}) => {
  const config = {
    data: tempDistributionData,
    xField: 'distance',
    yField: 'temperature',
    smooth: true,
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
      distance: {
        alias: '距中心距离 (m)',
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
    color: '#52c41a',
    lineStyle: {
      lineWidth: 2,
    },
    area: {
      style: {
        fill: 'l(270) 0:#52c41a00 1:#52c41a33',
      },
    },
    tooltip: {
      showCrosshairs: true,
      crosshairs: {
        line: {
          style: {
            stroke: '#52c41a',
            lineDash: [4, 4],
          },
        },
      },
    },
    annotation: {
      text: [
        {
          position: ['50%', '0%'],
          content: '中心温度最高',
          style: {
            fill: '#666',
            fontSize: 12,
          },
        },
      ],
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

export default TempDistributionChart
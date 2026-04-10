// src/renderer/components/charts/StressChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 应力图表组件
 * 用于显示混凝土内部应力随时间的变化曲线
 * @param {Array} data - 应力数据数组 [{time: number, stress: number}]
 * @param {string} title - 图表标题
 * @param {number} allowableStress - 许用应力值
 */
const StressChart = ({ data = [], title = '应力变化曲线', allowableStress = null }) => {
  const config = {
    data,
    xField: 'time',
    yField: 'stress',
    smooth: true,
    point: {
      size: 4,
      shape: 'circle',
      style: {
        fill: 'white',
        stroke: '#fa8c16',
        lineWidth: 2,
      },
    },
    meta: {
      time: {
        alias: '时间 (d)',
      },
      stress: {
        alias: '应力 (MPa)',
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
    color: '#fa8c16',
    lineStyle: {
      lineWidth: 2,
    },
    area: {
      style: {
        fill: 'l(270) 0:#fa8c1600 1:#fa8c1633',
      },
    },
    tooltip: {
      showCrosshairs: true,
      crosshairs: {
        line: {
          style: {
            stroke: '#fa8c16',
            lineDash: [4, 4],
          },
        },
      },
    },
    legend: allowableStress
      ? {
          position: 'top-right',
        }
      : undefined,
    animation: {
      appear: {
        animation: 'wave-in',
        duration: 1000,
      },
    },
  }

  // 如果提供了许用应力，添加参考线
  if (allowableStress !== null) {
    config.annotations = [
      {
        type: 'line',
        start: ['0%', allowableStress],
        end: ['100%', allowableStress],
        style: {
          stroke: '#ff4d4f',
          lineWidth: 2,
          lineDash: [8, 4],
        },
        text: {
          content: `许用应力: ${allowableStress} MPa`,
          position: 'right',
          style: {
            fill: '#ff4d4f',
            fontSize: 12,
          },
        },
      },
    ]
  }

  return (
    <Card size="small">
      <Line {...config} style={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default StressChart
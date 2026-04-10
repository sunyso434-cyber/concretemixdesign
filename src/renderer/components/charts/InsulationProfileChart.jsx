// src/renderer/components/charts/InsulationProfileChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 保温曲线图表组件
 * 用于显示不同保温措施下的温度变化曲线
 * @param {Array} data - 保温数据数组 [{time: number, temperature: number, type: string}]
 * @param {string} title - 图表标题
 */
const InsulationProfileChart = ({ data = [], title = '保温曲线' }) => {
  const config = {
    data,
    xField: 'time',
    yField: 'temperature',
    smooth: true,
    seriesField: 'type',
    point: {
      size: 3,
      shape: 'circle',
    },
    meta: {
      time: {
        alias: '时间 (h)',
      },
      temperature: {
        alias: '温度 (°C)',
      },
      type: {
        alias: '保温方案',
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
    color: ['#1890ff', '#52c41a', '#fa8c16', '#f5222d'],
    lineStyle: {
      lineWidth: 2,
    },
    tooltip: {
      showCrosshairs: true,
      crosshairs: {
        line: {
          style: {
            lineDash: [4, 4],
          },
        },
      },
    },
    legend: {
      position: 'top-right',
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

export default InsulationProfileChart
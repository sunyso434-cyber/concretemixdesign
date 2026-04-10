// src/renderer/components/charts/TempRiseChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 温度升幅图表组件
 * 用于显示混凝土内部温度随时间的变化曲线
 * @param {Array} tempCurveData - 温度曲线数据 [{day: number, temperature: number}]
 * @param {string} title - 图表标题
 */
const TempRiseChart = ({
  tempCurveData = [],
  title = '温度升幅曲线'
}) => {
  // 转换数据：day转为time（前端统一用time表示横轴）
  const chartData = tempCurveData.map(item => ({
    time: item.day,
    temperature: item.temperature
  }))

  const config = {
    data: chartData,
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
        alias: '时间',
      },
      temperature: {
        alias: '温度',
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
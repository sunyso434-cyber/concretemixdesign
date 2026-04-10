// src/renderer/components/charts/TempDiffCurveChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

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
  // 合并两条曲线数据
  const combinedData = [
    ...interiorSurfaceDiffData.map(item => ({
      time: item.day,
      tempDiff: item.tempDiff,
      series: '里表温差'
    })),
    ...surfaceAirDiffData.map(item => ({
      time: item.day,
      tempDiff: item.tempDiff,
      series: '表气温温'
    }))
  ]

  const config = {
    data: combinedData,
    xField: 'time',
    yField: 'tempDiff',
    smooth: true,
    seriesField: 'series',
    point: {
      size: 4,
      shape: 'circle',
      style: {
        fill: 'white',
        stroke: '#fa8c16',
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
      tempDiff: {
        alias: '温差',
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
        text: '温差 (°C)',
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
    color: ['#fa8c16', '#1890ff'],
    lineStyle: {
      lineWidth: 2,
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

export default TempDiffCurveChart
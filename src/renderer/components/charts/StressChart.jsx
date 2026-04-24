// src/renderer/components/charts/StressChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/plots'

/**
 * 应力图表组件
 * 用于显示混凝土内部应力随时间的变化曲线
 * @param {Array} selfConstraintStress - 自约束应力数据 [{time: number, stress: number}]
 * @param {Array} externalConstraintStress - 外约束应力数据 [{time: number, stress: number}]
 * @param {Array} totalStress - 总应力数据 [{time: number, stress: number}]
 * @param {number} tensileStrength - 抗拉强度值
 * @param {string} title - 图表标题
 */
const StressChart = ({
  selfConstraintStress = [],
  externalConstraintStress = [],
  totalStress = [],
  tensileStrength = null,
  title = '应力变化曲线'
}) => {
  // 过滤掉空数据
  const validSelfData = (selfConstraintStress || []).filter(item => item && typeof item.time === 'number')
  const validExternalData = (externalConstraintStress || []).filter(item => item && typeof item.time === 'number')
  const validTotalData = (totalStress || []).filter(item => item && typeof item.time === 'number')

  // 合并三条曲线数据，添加series字段区分
  const combinedData = [
    ...validSelfData.map(item => ({ ...item, series: '自约束应力' })),
    ...validExternalData.map(item => ({ ...item, series: '外约束应力' })),
    ...validTotalData.map(item => ({ ...item, series: '总应力' }))
  ]

  console.log('[StressChart] 渲染:', {
    validSelfLength: validSelfData.length,
    validExternalLength: validExternalData.length,
    validTotalLength: validTotalData.length,
    combinedDataLength: combinedData.length,
    firstItem: combinedData[0]
  })

  // 如果没有数据，渲染空状态
  if (combinedData.length === 0) {
    return (
      <Card size="small">
        <div style={{ textAlign: 'center', color: '#999', height: 300, lineHeight: '300px' }}>
          暂无数据
        </div>
      </Card>
    )
  }

  const config = {
    data: combinedData,
    xField: 'time',
    yField: 'stress',
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
    meta: {
      time: {
        alias: '时间',
      },
      stress: {
        alias: '应力',
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
        text: '应力 (MPa)',
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
    color: ['#fa8c16', '#1890ff', '#f5222d'],
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

  // 如果提供了抗拉强度，添加参考线（暂时禁用，因为可能导致图表渲染错误）
  // if (tensileStrength !== null) {
  //   config.annotations = [
  //     {
  //       type: 'line',
  //       start: ['0%', tensileStrength],
  //       end: ['100%', tensileStrength],
  //       style: {
  //         stroke: '#ff4d4f',
  //         lineWidth: 2,
  //         lineDash: [8, 4],
  //       },
  //       text: {
  //         content: `抗拉强度: ${tensileStrength} MPa`,
  //         position: 'right',
  //         style: {
  //           fill: '#ff4d4f',
  //           fontSize: 12,
  //         },
  //       },
  //     },
  //   ]
  // }

  return (
    <Card size="small">
      <Line {...config} containerStyle={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default StressChart
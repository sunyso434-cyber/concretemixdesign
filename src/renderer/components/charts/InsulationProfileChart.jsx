// src/renderer/components/charts/InsulationProfileChart.jsx
import React from 'react'
import { Card } from 'antd'
import { Bar } from '@ant-design/plots'

/**
 * 保温曲线图表组件
 * 用于显示不同保温措施下的温度变化曲线
 * @param {Array} insulationLayers - 保温层数据 [{thickness: number, name: string}]
 * @param {number} virtualThickness - 虚拟厚度 (m)
 * @param {number} surfaceTempDiff - 表面温差 (°C)
 * @param {boolean} meetsRequirement - 是否满足要求
 * @param {string} title - 图表标题
 */
const InsulationProfileChart = ({
  insulationLayers = [],
  virtualThickness = 0,
  surfaceTempDiff = 0,
  meetsRequirement = true,
  title = '保温曲线'
}) => {
  // 将保温层数据转换为图表数据
  const data = insulationLayers.map(layer => ({
    thickness: layer.thickness,
    name: layer.name
  }))

  const config = {
    data,
    xField: 'name',
    yField: 'thickness',
    smooth: false,
    point: {
      size: 4,
      shape: 'circle',
    },
    meta: {
      thickness: {
        alias: '保温层厚度 (m)',
      },
      name: {
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

  // 显示虚拟厚度和表面温差信息
  const infoText = `虚拟厚度: ${virtualThickness}m | 表面温差: ${surfaceTempDiff}°C | ${meetsRequirement ? '满足要求' : '不满足要求'}`

  return (
    <Card size="small" title={infoText}>
      <Bar {...config} style={{ width: '100%', height: 300 }} />
    </Card>
  )
}

export default InsulationProfileChart
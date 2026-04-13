// src/renderer/components/charts/InsulationProfileChart.jsx
import React from 'react'
import ReactECharts from 'echarts-for-react'
import { colors } from './chartConfig'

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
  const data = insulationLayers.map(layer => ({
    value: layer.thickness,
    name: layer.name
  }))

  const option = {
    backgroundColor: 'transparent',
    title: {
      text: title,
      left: 'center',
      textStyle: {
        color: colors.dark,
        fontSize: 14,
        fontWeight: 'bold',
      }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
      backgroundColor: 'rgba(26, 58, 92, 0.9)',
      borderColor: 'transparent',
      borderRadius: 6,
      padding: [8, 12],
      textStyle: {
        color: '#fff',
        fontSize: 12,
      },
      formatter: function(params) {
        const data = params[0]
        return `保温方案: ${data.name}<br/>保温层厚度: ${data.value} m`
      }
    },
    xAxis: {
      type: 'category',
      data: data.map(d => d.name),
      name: '保温方案',
      nameLocation: 'end',
      nameGap: 8,
      nameTextStyle: {
        color: colors.dark,
        fontSize: 12,
      },
      axisLine: {
        lineStyle: { color: colors.dark }
      },
      axisTick: {
        inside: true,
      },
      axisLabel: {
        color: '#666',
        fontSize: 11,
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: 'value',
      name: '保温层厚度 (m)',
      nameLocation: 'end',
      nameGap: 8,
      nameTextStyle: {
        color: colors.dark,
        fontSize: 12,
      },
      axisLine: {
        lineStyle: { color: colors.dark }
      },
      axisTick: {
        inside: true,
      },
      axisLabel: {
        color: '#666',
        fontSize: 11,
      },
      splitLine: {
        lineStyle: {
          color: colors.grid,
          type: 'dashed',
        }
      },
    },
    series: [{
      type: 'bar',
      data: data.map(d => d.value),
      barWidth: '50%',
      itemStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: colors.primary },
            { offset: 1, color: colors.secondary }
          ]
        },
        borderRadius: [4, 4, 0, 0],
      },
      emphasis: {
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: colors.secondary },
              { offset: 1, color: colors.primary }
            ]
          },
        }
      }
    }]
  }

  // 显示虚拟厚度和表面温差信息
  const infoText = `虚拟厚度: ${virtualThickness}m | 表面温差: ${surfaceTempDiff}°C | ${meetsRequirement ? '满足要求' : '不满足要求'}`

  return (
    <div>
      <div style={{
        textAlign: 'center',
        marginBottom: 12,
        color: meetsRequirement ? '#52c41a' : '#f5222d',
        fontSize: 12
      }}>
        {infoText}
      </div>
      <ReactECharts option={option} style={{ width: '100%', height: 300 }} />
    </div>
  )
}

export default InsulationProfileChart
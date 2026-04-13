// src/renderer/components/charts/TempDistributionChart.jsx
import React from 'react'
import { Radio } from 'antd'
import ReactECharts from 'echarts-for-react'
import {
  colors,
  createXAxis,
  createYAxis,
  tooltipConfig,
  legendConfig,
} from './chartConfig'

/**
 * 温度分布图表组件
 * 支持两种视图：
 * 1. 时间-温度曲线：X轴=时间，Y轴=温度，不同位置=不同曲线
 * 2. 位置-温度曲线：X轴=位置（百分比），Y轴=温度，不同时间=不同曲线
 * @param {Array} tempFieldData - 温度场数据 [{day, position, distance, temperature}]
 * @param {string} title - 图表标题
 */
const TempDistributionChart = ({
  tempFieldData = [],
  title = '温度场分布'
}) => {
  const [viewMode, setViewMode] = React.useState('time')

  // 获取唯一的时间点和位置点
  const uniqueDays = React.useMemo(() => {
    if (!tempFieldData || tempFieldData.length === 0) return []
    return [...new Set(tempFieldData.map(d => d.day))].sort((a, b) => a - b)
  }, [tempFieldData])

  const uniquePositions = React.useMemo(() => {
    if (!tempFieldData || tempFieldData.length === 0) return []
    return [...new Set(tempFieldData.map(d => d.position))].sort((a, b) => a - b)
  }, [tempFieldData])

  // 准备系列数据
  const series = React.useMemo(() => {
    if (!tempFieldData || tempFieldData.length === 0) return []

    const colorList = [colors.primary, colors.secondary, colors.tertiary, '#52c41a', '#fa8c16']

    if (viewMode === 'time') {
      // 视图1：每条线代表一个位置
      return uniquePositions.map((pos, i) => {
        const data = tempFieldData
          .filter(d => d.position === pos)
          .map(d => [d.day, d.temperature])
        return {
          name: `位置${pos.toFixed(0)}%`,
          type: 'line',
          data,
          smooth: true,
          lineStyle: { width: 2, color: colorList[i % colorList.length] },
          itemStyle: { color: colorList[i % colorList.length] },
          emphasis: {
            focus: 'series',
            itemStyle: {
              borderWidth: 2,
              borderColor: '#fff',
              shadowBlur: 10,
              shadowColor: 'rgba(0, 212, 255, 0.5)',
            }
          }
        }
      })
    } else {
      // 视图2：每条线代表一个时刻
      return uniqueDays.map((day, i) => {
        const data = tempFieldData
          .filter(d => d.day === day)
          .map(d => [d.position, d.temperature])
        return {
          name: `${day}d`,
          type: 'line',
          data,
          smooth: true,
          lineStyle: { width: 2, color: colorList[i % colorList.length] },
          itemStyle: { color: colorList[i % colorList.length] },
          emphasis: {
            focus: 'series',
            itemStyle: {
              borderWidth: 2,
              borderColor: '#fff',
              shadowBlur: 10,
              shadowColor: 'rgba(0, 212, 255, 0.5)',
            }
          }
        }
      })
    }
  }, [tempFieldData, viewMode, uniqueDays, uniquePositions])

  // 计算图例数据
  const legendData = viewMode === 'time'
    ? uniquePositions.map(p => `位置${p.toFixed(0)}%`)
    : uniqueDays.map(d => `${d}d`)

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
      ...tooltipConfig,
      formatter: function(params) {
        const data = params[0]
        const label = viewMode === 'time' ? '时间' : '位置'
        const unit = viewMode === 'time' ? 'd' : '%'
        return `${label}: ${data.axisValue}${unit}<br/>温度: ${data.value[1]} °C<br/>${data.seriesName}`
      }
    },
    legend: legendConfig(legendData),
    xAxis: viewMode === 'time'
      ? createXAxis('时间 (d)')
      : { ...createXAxis('距中心距离 (%)'), type: 'value' },
    yAxis: createYAxis('温度 (°C)'),
    series,
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Radio.Group value={viewMode} onChange={e => setViewMode(e.target.value)}>
          <Radio.Button value="time">时间-温度曲线</Radio.Button>
          <Radio.Button value="position">位置-温度曲线</Radio.Button>
        </Radio.Group>
        {viewMode === 'time' && (
          <span style={{ color: '#666', fontSize: 12 }}>
            显示{uniquePositions.length}个位置的温度随时间变化
          </span>
        )}
        {viewMode === 'position' && (
          <span style={{ color: '#666', fontSize: 12 }}>
            显示{uniqueDays.length}个时刻的温度沿位置分布
          </span>
        )}
      </div>
      <ReactECharts option={option} style={{ width: '100%', height: 300 }} />
    </div>
  )
}

export default TempDistributionChart
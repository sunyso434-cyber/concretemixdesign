// 科技感蓝调配色
export const colors = {
  primary: '#00d4ff',      // 亮青蓝 - 主曲线
  secondary: '#1890ff',    // 经典蓝 - 次曲线
  tertiary: '#2d6a9f',     // 中蓝 - 备用
  dark: '#1a3a5c',         // 深蓝 - 文字/标题
  grid: '#e0e6ed',         // 浅灰蓝 - 网格线
}

// 基础配置
export const baseConfig = {
  backgroundColor: 'transparent',
  animation: true,
  animationDuration: 1000,
}

// X轴配置模板
export const createXAxis = (name = '时间 (d)') => ({
  type: 'value',
  name,
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
    alignWithLabel: true,
    inside: true,  // 刻度朝内
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
})

// Y轴配置模板
export const createYAxis = (name = '温度 (°C)') => ({
  type: 'value',
  name,
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
    inside: true,  // 刻度朝内
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
})

// Tooltip配置 - hover显示单点坐标
export const tooltipConfig = {
  trigger: 'axis',
  axisPointer: {
    type: 'cross',
    crossStyle: {
      color: '#999'
    }
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
    const data = params[0];
    return `时间: ${data.axisValue} d<br/>温度: ${data.value} °C`;
  }
}

// 曲线样式
export const lineStyle = {
  width: 2,
  smooth: true,  // 平滑曲线
}

// 高亮样式
export const emphasisStyle = {
  focus: 'series',
  itemStyle: {
    borderWidth: 2,
    borderColor: '#fff',
    shadowBlur: 10,
    shadowColor: 'rgba(0, 212, 255, 0.5)',
  }
}

// 创建折线系列
export const createLineSeries = (name, data, color, yField = 'value') => ({
  name,
  type: 'line',
  data,
  smooth: true,
  lineStyle: {
    width: 2,
    color,
  },
  itemStyle: {
    color,
  },
  emphasis: emphasisStyle,
  yField,
})

// 图例配置
export const legendConfig = (data = []) => ({
  data,
  top: 0,
  right: 0,
  textStyle: {
    color: colors.dark,
    fontSize: 11,
  },
})
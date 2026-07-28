/**
 * TrialRecordsPage 纯逻辑测试
 *
 * 测试环境为 node（无 jsdom），因此测试组件中的数据转换和判断逻辑，
 * 而非 React 渲染。
 *
 * 覆盖内容：
 * 1. 偏差率阈值判断（±10% 红线）
 * 2. 试配状态筛选
 * 3. 关联方案 ID 判断
 */

// 模拟偏差分析的判断逻辑（与 TrialRecordsPage.jsx 保持一致）
const isDeviationOverThreshold = (deviation, threshold = 10) => {
  if (!deviation || deviation.strengthDeviationPct === null || deviation.strengthDeviationPct === undefined) {
    return false
  }
  return Math.abs(deviation.strengthDeviationPct) > threshold
}

const getDeviationColor = (pct) => {
  if (pct === null || pct === undefined) return 'gray'
  const absPct = Math.abs(pct)
  if (absPct > 10) return 'red'
  if (absPct > 5) return 'orange'
  return 'green'
}

const formatDeviationText = (pct) => {
  if (pct === null || pct === undefined) return '-'
  const prefix = pct > 0 ? '+' : ''
  return `${prefix}${pct.toFixed(1)}%`
}

const getStatusColor = (status) => {
  switch (status) {
    case '已试配': return 'success'
    case '已复核': return 'blue'
    case '驳回': return 'error'
    default: return 'default'
  }
}

const hasAssociatedScheme = (mixDesignId) => {
  return mixDesignId !== null && mixDesignId !== undefined && mixDesignId !== ''
}

describe('TrialRecordsPage - 偏差判断逻辑', () => {
  test('偏差率超过 ±10% 时被判定为超阈值', () => {
    const deviation = { strengthDeviationPct: 12.5 }
    expect(isDeviationOverThreshold(deviation)).toBe(true)
  })

  test('偏差率 -15% 也被判定为超阈值', () => {
    const deviation = { strengthDeviationPct: -15.0 }
    expect(isDeviationOverThreshold(deviation)).toBe(true)
  })

  test('偏差率 8% 不超阈值', () => {
    const deviation = { strengthDeviationPct: 8.0 }
    expect(isDeviationOverThreshold(deviation)).toBe(false)
  })

  test('偏差率为 null 时不超阈值', () => {
    const deviation = { strengthDeviationPct: null }
    expect(isDeviationOverThreshold(deviation)).toBe(false)
  })

  test('无偏差分析时不超阈值', () => {
    expect(isDeviationOverThreshold(null)).toBe(false)
    expect(isDeviationOverThreshold(undefined)).toBe(false)
  })

  test('偏差率正好 ±10.0% 不算超阈值（边界测试）', () => {
    const deviation = { strengthDeviationPct: 10.0 }
    expect(isDeviationOverThreshold(deviation)).toBe(false)
    deviation.strengthDeviationPct = -10.0
    expect(isDeviationOverThreshold(deviation)).toBe(false)
  })
})

describe('TrialRecordsPage - 偏差颜色计算', () => {
  test('偏差 >10% → red', () => {
    expect(getDeviationColor(15)).toBe('red')
    expect(getDeviationColor(-15)).toBe('red')
  })

  test('偏差 5%~10% → orange', () => {
    expect(getDeviationColor(6)).toBe('orange')
    expect(getDeviationColor(-6)).toBe('orange')
  })

  test('偏差 <5% → green', () => {
    expect(getDeviationColor(3)).toBe('green')
    expect(getDeviationColor(-3)).toBe('green')
    expect(getDeviationColor(0)).toBe('green')
  })

  test('null/undefined → gray', () => {
    expect(getDeviationColor(null)).toBe('gray')
    expect(getDeviationColor(undefined)).toBe('gray')
  })
})

describe('TrialRecordsPage - 偏差文字格式化', () => {
  test('正值带 + 号', () => {
    expect(formatDeviationText(5.2)).toBe('+5.2%')
  })

  test('负值带 - 号', () => {
    expect(formatDeviationText(-3.8)).toBe('-3.8%')
  })

  test('零值', () => {
    expect(formatDeviationText(0)).toBe('0.0%')
  })

  test('null 返回占位符', () => {
    expect(formatDeviationText(null)).toBe('-')
  })
})

describe('TrialRecordsPage - 状态颜色映射', () => {
  test('已试配 → success', () => {
    expect(getStatusColor('已试配')).toBe('success')
  })

  test('已复核 → blue', () => {
    expect(getStatusColor('已复核')).toBe('blue')
  })

  test('驳回 → error', () => {
    expect(getStatusColor('驳回')).toBe('error')
  })

  test('未知状态 → default', () => {
    expect(getStatusColor('未知')).toBe('default')
    expect(getStatusColor(undefined)).toBe('default')
    expect(getStatusColor('')).toBe('default')
  })
})

describe('TrialRecordsPage - 关联方案判断', () => {
  test('有 mixDesignId 表示有关联方案', () => {
    expect(hasAssociatedScheme(42)).toBe(true)
    expect(hasAssociatedScheme(0)).toBe(true)
  })

  test('null/undefined/空字符串表示无关联方案', () => {
    expect(hasAssociatedScheme(null)).toBe(false)
    expect(hasAssociatedScheme(undefined)).toBe(false)
    expect(hasAssociatedScheme('')).toBe(false)
  })
})

describe('TrialRecordsPage - 数据筛选逻辑', () => {
  const mockRecords = [
    { id: 1, trialStatus: '已试配', deviationAnalysis: { strengthDeviationPct: 12 } },
    { id: 2, trialStatus: '已复核', deviationAnalysis: { strengthDeviationPct: 3 } },
    { id: 3, trialStatus: '驳回', deviationAnalysis: { strengthDeviationPct: -8 } },
    { id: 4, trialStatus: '已试配', deviationAnalysis: { strengthDeviationPct: null } },
    { id: 5, trialStatus: '已复核', deviationAnalysis: null },
  ]

  test('按状态筛选 - 全部', () => {
    expect(mockRecords.length).toBe(5)
  })

  test('按状态筛选 - 已试配', () => {
    const filtered = mockRecords.filter(r => r.trialStatus === '已试配')
    expect(filtered).toHaveLength(2)
    expect(filtered.every(r => r.trialStatus === '已试配')).toBe(true)
  })

  test('按状态筛选 - 驳回', () => {
    const filtered = mockRecords.filter(r => r.trialStatus === '驳回')
    expect(filtered).toHaveLength(1)
  })

  test('偏差超 10% 的记录统计', () => {
    const overDeviation = mockRecords.filter(r => isDeviationOverThreshold(r.deviationAnalysis))
    expect(overDeviation).toHaveLength(1)
    expect(overDeviation[0].id).toBe(1)
  })

  test('有偏差数据的记录统计', () => {
    const withDeviation = mockRecords.filter(r => r.deviationAnalysis && r.deviationAnalysis.strengthDeviationPct !== null)
    expect(withDeviation).toHaveLength(3)
  })

  test('有关联方案的记录', () => {
    const recordsWithScheme = [
      { id: 1, mixDesignId: 10 },
      { id: 2, mixDesignId: null },
      { id: 3 },
    ]
    const linked = recordsWithScheme.filter(r => hasAssociatedScheme(r.mixDesignId))
    expect(linked).toHaveLength(1)
    expect(linked[0].id).toBe(1)
  })
})

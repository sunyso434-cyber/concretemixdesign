// settingsSlice 单元测试（优化项 5 验收：新 slice 有对应测试，设置页迁移样板）
import reducer, { setActiveTab, setParams, setParamsLoading } from '../settingsSlice'

describe('settingsSlice', () => {
  test('初始状态：默认 LLM管理 页签、空参数、未加载', () => {
    const state = reducer(undefined, { type: '@@INIT' })
    expect(state).toEqual({
      activeTab: 'LLM管理',
      params: [],
      paramsLoading: false,
    })
  })

  test('setActiveTab 切换页签（父组件导航 dispatch 的入口）', () => {
    const s1 = reducer(undefined, setActiveTab('系统设置'))
    expect(s1.activeTab).toBe('系统设置')
    const s2 = reducer(s1, setActiveTab('技能管理'))
    expect(s2.activeTab).toBe('技能管理')
  })

  test('setParams 写入系统参数（空值兜底为空数组）', () => {
    const payload = [
      { name: 'strengthStdDev_C45', value: '5.0', type: 'system' },
      { name: 'targetFinenessModulus', value: '2.7', type: 'system' },
    ]
    const s1 = reducer(undefined, setParams(payload))
    expect(s1.params).toHaveLength(2)
    expect(s1.params[1].name).toBe('targetFinenessModulus')
    const s2 = reducer(s1, setParams(undefined))
    expect(s2.params).toEqual([])
  })

  test('setParamsLoading 切换加载状态', () => {
    const s1 = reducer(undefined, setParamsLoading(true))
    expect(s1.paramsLoading).toBe(true)
    const s2 = reducer(s1, setParamsLoading(false))
    expect(s2.paramsLoading).toBe(false)
    // 非布尔值归一化
    const s3 = reducer(s2, setParamsLoading(0))
    expect(s3.paramsLoading).toBe(false)
  })
})
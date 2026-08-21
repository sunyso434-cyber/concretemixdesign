/**
 * SettingsPage 迁移冒烟测试（优化项 5 验收：设置页完成迁移并验证无回归）
 * @jest-environment jsdom
 *
 * 验证点：
 * 1. 默认渲染 LLM管理 页签（Redux 默认 activeTab）
 * 2. 父组件 ref.switchTab 调用 → Redux dispatch 生效，内容切换（回归旧接口）
 * 3. 参数加载（get-all-params IPC）→ 参数卡片渲染（settingsSlice.params 生效）
 */
import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import settingsReducer from '../../store/settingsSlice'
import SettingsPage from '../SettingsPage'

// antd v5 在 jsdom 下需要的 polyfill
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// 重量级子组件统一 mock 为轻量占位（本测试关注设置页主体状态流，不渲染子面板全量 UI）
jest.mock('../../components/SkillManager', () => () => <div>SkillManager-mock</div>)
jest.mock('../../components/TrainingPanel', () => () => <div>TrainingPanel-mock</div>)
jest.mock('../../components/SalesQuoteSettings', () => () => <div>SalesQuoteSettings-mock</div>)
jest.mock('../../components/ExportWizard', () => () => <div>ExportWizard-mock</div>)
jest.mock('../../components/ImportWizard', () => () => <div>ImportWizard-mock</div>)
jest.mock('../../components/RestoreConfirmModal', () => () => <div>RestoreConfirmModal-mock</div>)
jest.mock('../../components/ParamCard', () => ({ paramName }) => <div className="param-card-mock">{paramName}</div>)

// 模拟 preload API
const mockInvoke = jest.fn(async (channel) => {
  if (channel === 'get-all-params') {
    return { success: true, data: [
      { name: 'strengthStdDev_C45', value: '5.0', type: 'system', description: '强度标准差' },
      { name: 'superplasticizerDosage_C30', value: '1.0', type: 'system', description: 'C30减水剂掺量' },
    ] }
  }
  if (channel === 'get-app-version') return { success: true, data: '0.9.3' }
  return { success: true }
})
beforeEach(() => {
  window.electronAPI = {
    invoke: mockInvoke,
    on: jest.fn(() => 'listener-id'),
    removeListener: jest.fn(),
    llm: {
      list: jest.fn(async () => ({ success: true, data: [], activeId: null, presets: [] })),
      getFull: jest.fn(async () => ({ success: true, data: null })),
      activate: jest.fn(async () => ({ success: true })),
      delete: jest.fn(async () => ({ success: true })),
      test: jest.fn(async () => ({ success: true })),
      save: jest.fn(async () => ({ success: true })),
    },
  }
  mockInvoke.mockClear()
})

const makeStore = () => configureStore({ reducer: { settings: settingsReducer } })

describe('SettingsPage Redux 迁移', () => {
  test('默认渲染 LLM管理 页签（store 初始 activeTab）', async () => {
    render(
      <Provider store={makeStore()}>
        <SettingsPage />
      </Provider>
    )
    // LlmManager 初始 loading → 等其异步加载完成
    expect(await screen.findByText('LLM 配置管理')).toBeTruthy()
  })

  test('父组件 ref.switchTab → Redux dispatch 生效，切换内容', async () => {
    const ref = React.createRef()
    render(
      <Provider store={makeStore()}>
        <SettingsPage ref={ref} />
      </Provider>
    )
    await screen.findByText('LLM 配置管理')
    act(() => {
      ref.current.switchTab('系统设置')
    })
    expect(await screen.findByText('数据管理')).toBeTruthy()
    expect(screen.queryByText('LLM 配置管理')).toBeNull()
  })

  test('参数加载后 JGJ55标准 页签渲染参数卡片（settingsSlice.params）', async () => {
    const store = makeStore()
    const ref = React.createRef()
    render(
      <Provider store={store}>
        <SettingsPage ref={ref} />
      </Provider>
    )
    await screen.findByText('LLM 配置管理')
    act(() => {
      ref.current.switchTab('JGJ55标准')
    })
    // 参数卡片（mock 渲染参数名）
    expect(await screen.findByText('strengthStdDev_C45')).toBeTruthy()
    expect(screen.getByText('superplasticizerDosage_C30')).toBeTruthy()
    // IPC 调用过 get-all-params
    expect(mockInvoke).toHaveBeenCalledWith('get-all-params')
    // store 中参数已写入
    await waitFor(() => {
      expect(store.getState().settings.params).toHaveLength(2)
    })
  })

  test('default export 正常（回归：页面可挂载且不抛错）', async () => {
    render(
      <Provider store={makeStore()}>
        <SettingsPage />
      </Provider>
    )
    expect(await screen.findByText('LLM 配置管理')).toBeTruthy()
  })
})
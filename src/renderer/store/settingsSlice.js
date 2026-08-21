// settingsSlice — 系统设置领域状态（优化项 5 新增，设置页迁移样板）
// - activeTab：当前设置页签（原父组件通过 SettingsPage ref.switchTab 控制，
//   迁移后由导航 dispatch 切换，ref 保留为兼容壳，内部转 dispatch）
// - params：系统参数列表（get-all-params 结果，多设置页签共享）
// - paramsLoading：参数加载中状态
// 页内临时编辑状态（modifiedParams/modalVisible 等）仍保留组件 useState（渐进迁移，不发散）。
import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  activeTab: 'LLM管理',
  params: [],
  paramsLoading: false,
}

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setActiveTab: (state, action) => {
      state.activeTab = action.payload
    },
    setParams: (state, action) => {
      state.params = action.payload || []
    },
    setParamsLoading: (state, action) => {
      state.paramsLoading = !!action.payload
    },
  },
})

export const { setActiveTab, setParams, setParamsLoading } = settingsSlice.actions
export default settingsSlice.reducer
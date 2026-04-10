import { createSlice } from '@reduxjs/toolkit'

// 大体积混凝土的初始状态
const initialState = {
  currentScheme: null,
  schemes: [],
  mixDesignData: null,
  adiabaticTempData: null,
  stressData: null,
  insulationData: null,
  insulationMaterials: [],
  constructionParams: null,
  activeTab: 'schemes'
}

// 创建大体积混凝土的slice
const massConcreteSlice = createSlice({
  name: 'massConcrete',
  initialState,
  reducers: {
    // 设置当前方案
    setCurrentScheme: (state, action) => {
      state.currentScheme = action.payload
    },
    // 设置方案列表
    setSchemes: (state, action) => {
      state.schemes = action.payload
    },
    // 添加方案
    addScheme: (state, action) => {
      state.schemes.push(action.payload)
    },
    // 更新方案列表中的方案
    updateSchemeInList: (state, action) => {
      const index = state.schemes.findIndex(scheme => scheme.id === action.payload.id)
      if (index !== -1) {
        state.schemes[index] = action.payload
      }
    },
    // 删除方案
    removeScheme: (state, action) => {
      state.schemes = state.schemes.filter(scheme => scheme.id !== action.payload)
    },
    // 设置配合比数据
    setMixDesignData: (state, action) => {
      state.mixDesignData = action.payload
    },
    // 设置绝热温升数据
    setAdiabaticTempData: (state, action) => {
      state.adiabaticTempData = action.payload
    },
    // 设置温度应力数据
    setStressData: (state, action) => {
      state.stressData = action.payload
    },
    // 设置保温养护数据
    setInsulationData: (state, action) => {
      state.insulationData = action.payload
    },
    // 设置保温材料列表
    setInsulationMaterials: (state, action) => {
      state.insulationMaterials = action.payload
    },
    // 设置施工参数
    setConstructionParams: (state, action) => {
      state.constructionParams = action.payload
    },
    // 设置当前标签页
    setActiveTab: (state, action) => {
      state.activeTab = action.payload
    },
    // 清除计算结果
    clearCalculationResults: (state) => {
      state.mixDesignData = null
      state.adiabaticTempData = null
      state.stressData = null
      state.insulationData = null
    },
    // 重置状态
    resetState: () => initialState
  }
})

// 导出actions
export const {
  setCurrentScheme,
  setSchemes,
  addScheme,
  updateSchemeInList,
  removeScheme,
  setMixDesignData,
  setAdiabaticTempData,
  setStressData,
  setInsulationData,
  setInsulationMaterials,
  setConstructionParams,
  setActiveTab,
  clearCalculationResults,
  resetState
} = massConcreteSlice.actions

// 导出reducer
export default massConcreteSlice.reducer
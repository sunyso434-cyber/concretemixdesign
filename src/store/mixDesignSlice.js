import { createSlice } from '@reduxjs/toolkit'

// 配合比设计的初始状态
const initialState = {
  mixDesigns: [
    {
      id: 1,
      name: 'C30普通混凝土',
      strength: '30MPa',
      cement: '300kg',
      aggregate: '1200kg',
      water: '180kg',
      admixture: '6kg'
    },
    {
      id: 2,
      name: 'C40高强混凝土',
      strength: '40MPa',
      cement: '380kg',
      aggregate: '1150kg',
      water: '160kg',
      admixture: '7.6kg'
    }
  ],
  currentMixDesign: null,
  // 配合比计算结果缓存
  calculationCache: null,
  // 优化任务状态
  optimizationTask: null
}

// 创建配合比设计的slice
const mixDesignSlice = createSlice({
  name: 'mixDesign',
  initialState,
  reducers: {
    // 添加配合比
    addMixDesign: (state, action) => {
      state.mixDesigns.push(action.payload)
    },
    // 更新配合比
    updateMixDesign: (state, action) => {
      const index = state.mixDesigns.findIndex(mix => mix.id === action.payload.id)
      if (index !== -1) {
        state.mixDesigns[index] = action.payload
      }
    },
    // 删除配合比
    deleteMixDesign: (state, action) => {
      state.mixDesigns = state.mixDesigns.filter(mix => mix.id !== action.payload)
    },
    // 设置当前配合比
    setCurrentMixDesign: (state, action) => {
      state.currentMixDesign = action.payload
    },
    // 设置配合比计算结果缓存
    setCalculationCache: (state, action) => {
      state.calculationCache = action.payload
    },
    // 清除配合比计算结果缓存
    clearCalculationCache: (state) => {
      state.calculationCache = null
    },
    // 设置优化任务
    setOptimizationTask: (state, action) => {
      state.optimizationTask = action.payload
    },
    // 清除优化任务
    clearOptimizationTask: (state) => {
      state.optimizationTask = null
    }
  }
})

// 导出actions
export const { addMixDesign, updateMixDesign, deleteMixDesign, setCurrentMixDesign, setCalculationCache, clearCalculationCache, setOptimizationTask, clearOptimizationTask } = mixDesignSlice.actions

// 导出reducer
export default mixDesignSlice.reducer

import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  calculationCache: null,
  optimizationTask: null,
}

const mixDesignSlice = createSlice({
  name: 'mixDesign',
  initialState,
  reducers: {
    setCalculationCache: (state, action) => {
      state.calculationCache = action.payload
    },
    clearCalculationCache: (state) => {
      state.calculationCache = null
    },
    setOptimizationTask: (state, action) => {
      state.optimizationTask = action.payload
    },
    clearOptimizationTask: (state) => {
      state.optimizationTask = null
    },
  },
})

export const { setCalculationCache, clearCalculationCache, setOptimizationTask, clearOptimizationTask } = mixDesignSlice.actions
export default mixDesignSlice.reducer
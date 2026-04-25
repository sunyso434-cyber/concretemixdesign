import { configureStore } from '@reduxjs/toolkit'
import mixDesignReducer from './mixDesignSlice.js'
import materialReducer from './materialSlice.js'
import settingReducer from './settingSlice.js'

// 配置Redux store，集成各个slice
const store = configureStore({
  reducer: {
    mixDesign: mixDesignReducer,
    material: materialReducer,
    setting: settingReducer
  }
})

export default store

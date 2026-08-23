import { configureStore } from '@reduxjs/toolkit'
import chatReducer from './chatSlice'
import settingsReducer from './settingsSlice'

// 清理（2026-08-22）：mixDesignSlice 随死页面 MixDesignPage/OptimizationPage 一并删除
//（两个页面无任何路由/懒加载入口，是 0.9.x 早期遗留）
export const store = configureStore({
  reducer: {
    chat: chatReducer,
    settings: settingsReducer,
  },
})

export default store

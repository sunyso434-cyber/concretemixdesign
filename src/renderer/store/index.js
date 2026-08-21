import { configureStore } from '@reduxjs/toolkit'
import mixDesignReducer from './mixDesignSlice'
import chatReducer from './chatSlice'
import settingsReducer from './settingsSlice'

export const store = configureStore({
  reducer: {
    mixDesign: mixDesignReducer,
    chat: chatReducer,
    settings: settingsReducer,
  },
})

export default store
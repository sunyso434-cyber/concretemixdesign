import { configureStore } from '@reduxjs/toolkit'
import mixDesignReducer from './mixDesignSlice'

export const store = configureStore({
  reducer: {
    mixDesign: mixDesignReducer,
  },
})

export default store
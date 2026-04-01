import { createSlice } from '@reduxjs/toolkit'

// 系统设置的初始状态
const initialState = {
  systemParams: [
    {
      id: 1,
      name: '水灰比最大值',
      value: '0.6',
      unit: '',
      description: '混凝土配合比设计中允许的最大水灰比'
    },
    {
      id: 2,
      name: '砂率范围',
      value: '30-40',
      unit: '%',
      description: '混凝土配合比设计中砂率的合理范围'
    },
    {
      id: 3,
      name: '单位用水量',
      value: '160-220',
      unit: 'kg/m³',
      description: '混凝土配合比设计中单位用水量的合理范围'
    }
  ],
  currentParam: null
}

// 创建系统设置的slice
const settingSlice = createSlice({
  name: 'setting',
  initialState,
  reducers: {
    // 添加系统参数
    addSystemParam: (state, action) => {
      state.systemParams.push(action.payload)
    },
    // 更新系统参数
    updateSystemParam: (state, action) => {
      const index = state.systemParams.findIndex(param => param.id === action.payload.id)
      if (index !== -1) {
        state.systemParams[index] = action.payload
      }
    },
    // 删除系统参数
    deleteSystemParam: (state, action) => {
      state.systemParams = state.systemParams.filter(param => param.id !== action.payload)
    },
    // 设置当前系统参数
    setCurrentParam: (state, action) => {
      state.currentParam = action.payload
    }
  }
})

// 导出actions
export const { addSystemParam, updateSystemParam, deleteSystemParam, setCurrentParam } = settingSlice.actions

// 导出reducer
export default settingSlice.reducer

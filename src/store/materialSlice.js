import { createSlice } from '@reduxjs/toolkit'

// 材料管理的初始状态
const initialState = {
  materials: [
    {
      id: 1,
      name: 'P.O 42.5水泥',
      type: '水泥',
      density: '3100kg/m³',
      price: '500元/吨',
      supplier: '海螺水泥'
    },
    {
      id: 2,
      name: '河砂',
      type: '细骨料',
      density: '2650kg/m³',
      price: '120元/吨',
      supplier: '本地砂场'
    },
    {
      id: 3,
      name: '碎石',
      type: '粗骨料',
      density: '2700kg/m³',
      price: '100元/吨',
      supplier: '本地石场'
    }
  ],
  currentMaterial: null
}

// 创建材料管理的slice
const materialSlice = createSlice({
  name: 'material',
  initialState,
  reducers: {
    // 添加材料
    addMaterial: (state, action) => {
      state.materials.push(action.payload)
    },
    // 更新材料
    updateMaterial: (state, action) => {
      const index = state.materials.findIndex(material => material.id === action.payload.id)
      if (index !== -1) {
        state.materials[index] = action.payload
      }
    },
    // 删除材料
    deleteMaterial: (state, action) => {
      state.materials = state.materials.filter(material => material.id !== action.payload)
    },
    // 设置当前材料
    setCurrentMaterial: (state, action) => {
      state.currentMaterial = action.payload
    }
  }
})

// 导出actions
export const { addMaterial, updateMaterial, deleteMaterial, setCurrentMaterial } = materialSlice.actions

// 导出reducer
export default materialSlice.reducer

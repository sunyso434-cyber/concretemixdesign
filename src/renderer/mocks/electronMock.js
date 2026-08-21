// 浏览器开发环境模拟 Electron preload API（Electron 环境不加载本文件）
import { mockDB } from './mockData'
import { calculateMixDesignMock, validateMixDesignMock, optimizeMixDesignMock } from './jgj55Mock'

  // 模拟electron API
  window.electron = {
    ipcRenderer: {
      invoke: async (channel, data) => {
        // 模拟延迟
        await new Promise(resolve => setTimeout(resolve, 200))
        
        switch (channel) {
          case 'getAllMaterials':
            return { success: true, data: mockDB.materials }
          case 'createMaterial':
            const newMaterial = { ...data, id: mockDB.nextId++ }
            mockDB.materials.push(newMaterial)
            return { success: true, data: newMaterial }
          case 'updateMaterial':
            const index = mockDB.materials.findIndex(m => m.id === data.id)
            if (index !== -1) {
              mockDB.materials[index] = { ...mockDB.materials[index], ...data.data }
              return { success: true, data: mockDB.materials[index] }
            }
            return { success: false, error: '材料不存在' }
          case 'deleteMaterial':
            mockDB.materials = mockDB.materials.filter(m => m.id !== data)
            return { success: true }
          case 'calculateMixDesign':
            try {
              const result = calculateMixDesignMock(data)
              return { success: true, data: result }
            } catch (error) {
              return { success: false, error: error.message }
            }
          case 'validateMixDesign':
            try {
              const result = validateMixDesignMock(data)
              return { success: true, data: result }
            } catch (error) {
              return { success: false, error: error.message }
            }
          case 'optimizeMixDesign':
            try {
              const result = optimizeMixDesignMock(data)
              return { success: true, data: result }
            } catch (error) {
              return { success: false, error: error.message }
            }
          case 'createMixDesign':
            const newScheme = { id: mockDB.nextSchemeId++, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            mockDB.schemes.push(newScheme)
            return { success: true, data: newScheme }
          case 'getAllMixDesigns':
            return { success: true, data: mockDB.schemes }
          case 'getMixDesignById':
            const scheme = mockDB.schemes.find(s => s.id === data)
            if (scheme) {
              return { success: true, data: scheme }
            } else {
              return { success: false, error: '方案不存在' }
            }
          case 'deleteMixDesign':
            const deleteIndex = mockDB.schemes.findIndex(s => s.id === data)
            if (deleteIndex !== -1) {
              mockDB.schemes.splice(deleteIndex, 1)
              return { success: true }
            } else {
              return { success: false, error: '方案不存在' }
            }
          case 'updateMixDesign':
            const updateIndex = mockDB.schemes.findIndex(s => s.id === data.id)
            if (updateIndex !== -1) {
              mockDB.schemes[updateIndex] = { ...mockDB.schemes[updateIndex], ...data.data, updatedAt: new Date().toISOString() }
              return { success: true, data: mockDB.schemes[updateIndex] }
            } else {
              return { success: false, error: '方案不存在' }
            }
          default:
            return { success: false, error: '未知命令' }
        }
      },
      send: () => {},
      on: () => {},
      once: () => {},
      removeListener: () => {},
      removeAllListeners: () => {}
    }
  }
  // 模拟 electronAPI（preload 暴露的 contextBridge API）
  window.electronAPI = {
    invoke: async (channel, ...args) => {
      return window.electron.ipcRenderer.invoke(channel, args[0])
    },
    on: (channel, func) => {
      window.electron.ipcRenderer.on(channel, func)
    },
    once: (channel, func) => {
      window.electron.ipcRenderer.once(channel, func)
    },
    removeListener: (id) => {
      window.electron.ipcRenderer.removeListener(id)
    },
    removeAllListeners: (channel) => {
      window.electron.ipcRenderer.removeAllListeners(channel)
    }
  }
  console.log('已加载模拟Electron API（包含完整JGJ 55标准计算），用于浏览器开发测试')


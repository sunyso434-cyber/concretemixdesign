// preload.js

// 所有的Node.js API都可以在预加载过程中使用
const { contextBridge, ipcRenderer } = require('electron')

// 向渲染进程暴露安全的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 示例：从主进程接收消息
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
  // 示例：向主进程发送消息
  sendMessage: (message) => ipcRenderer.send('message', message)
})

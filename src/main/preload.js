const { contextBridge, ipcRenderer } = require('electron')

// 暴露API给渲染进程
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data), // 发送单向消息
    invoke: (channel, data) => ipcRenderer.invoke(channel, data), // 发送异步调用并等待响应
    on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)), // 监听消息
    once: (channel, func) => ipcRenderer.once(channel, (event, ...args) => func(...args)), // 一次性监听
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel) // 移除所有监听器
  }
})

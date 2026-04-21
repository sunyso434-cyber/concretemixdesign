const { contextBridge, ipcRenderer } = require('electron')

// 存储 listener wrapper 的引用，用于 removeListener
const listenerCache = new Map()

// 生成唯一 ID
let listenerIdCounter = 0
const generateListenerId = () => `listener_${++listenerIdCounter}_${Date.now()}`

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => {
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel, func) => {
    const id = generateListenerId()
    const wrapper = (event, ...args) => func(...args)
    listenerCache.set(id, { channel, wrapper })
    ipcRenderer.on(channel, wrapper)
    return id
  },
  once: (channel, func) => {
    ipcRenderer.once(channel, (event, ...args) => func(...args))
  },
  removeListener: (id) => {
    const entry = listenerCache.get(id)
    if (entry) {
      ipcRenderer.removeListener(entry.channel, entry.wrapper)
      listenerCache.delete(id)
    }
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
    // 清理缓存
    if (channel) {
      for (const [id, entry] of listenerCache) {
        if (entry.channel === channel) {
          listenerCache.delete(id)
        }
      }
    } else {
      listenerCache.clear()
    }
  }
})

// 兼容旧的 electron 对象
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    on: (channel, func) => {
      const id = generateListenerId()
      const wrapper = (event, ...args) => func(...args)
      listenerCache.set(id, { channel, wrapper })
      ipcRenderer.on(channel, wrapper)
      return id
    },
    once: (channel, func) => {
      ipcRenderer.once(channel, (event, ...args) => func(...args))
    },
    removeListener: (id) => {
      const entry = listenerCache.get(id)
      if (entry) {
        ipcRenderer.removeListener(entry.channel, entry.wrapper)
        listenerCache.delete(id)
      }
    },
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel)
      if (channel) {
        for (const [id, entry] of listenerCache) {
          if (entry.channel === channel) {
            listenerCache.delete(id)
          }
        }
      } else {
        listenerCache.clear()
      }
    }
  },
  inverseCalculation: {
    importExcel: (filePath) => ipcRenderer.invoke('inverseCalculation.importExcel', { filePath }),
    calculate: (params) => ipcRenderer.invoke('inverseCalculation.calculate', params)
  }
})

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
  },
  // Skill 管理
  skill: {
    listAll: () => ipcRenderer.invoke('skill:listAll'),
    getUserDir: () => ipcRenderer.invoke('skill:getUserDir'),
    getUserSkills: () => ipcRenderer.invoke('skill:getUserSkills'),
    openUserDir: () => ipcRenderer.invoke('skill:openUserDir'),
    reload: () => ipcRenderer.invoke('skill:reload')
  },
  // AgentMd (用户自定义规则)
  agentMd: {
    load: () => ipcRenderer.invoke('agentMd:load'),
    save: (content) => ipcRenderer.invoke('agentMd:save', { content }),
    reload: () => ipcRenderer.invoke('agentMd:reload')
  },
  shell: {
    openAgentMd: () => ipcRenderer.invoke('shell:openAgentMd')
  },
  // === v1.5.3 新增：workspace 模块（Task 1.9）===
  // 命名统一：所有 workspace IPC 都通过 electronAPI.workspace.* 访问
  // 与未来 skill.*/agentMd.* 命名风格一致
  workspace: {
    open: (path) => ipcRenderer.invoke('workspace:open', { path }),
    close: () => ipcRenderer.invoke('workspace:close'),
    current: () => ipcRenderer.invoke('workspace:current'),
    listFiles: (subdir) => ipcRenderer.invoke('workspace:listFiles', { subdir })
    // 后续 task 加：ingest / readPage / search / writeFile / lint / searchGraph
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
  },
  // 配合比→报价数据流（确保数据一致）
  mixDesignToQuote: {
    generate: (mixDesignResult, pricing) => ipcRenderer.invoke('mixDesignToQuote:generate', { mixDesignResult, pricing }),
    validate: (basicMix, quoteResult) => ipcRenderer.invoke('mixDesignToQuote:validate', { basicMix, quoteResult }),
    saveBasicMix: (mixDesignResult) => ipcRenderer.invoke('mixDesignToQuote:saveBasicMix', { mixDesignResult })
  },
  // Skill 管理
  skill: {
    listAll: () => ipcRenderer.invoke('skill:listAll'),
    getUserDir: () => ipcRenderer.invoke('skill:getUserDir'),
    getUserSkills: () => ipcRenderer.invoke('skill:getUserSkills'),
    openUserDir: () => ipcRenderer.invoke('skill:openUserDir'),
    reload: () => ipcRenderer.invoke('skill:reload')
  }
})

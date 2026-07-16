const { contextBridge, ipcRenderer } = require('electron')

// Sandboxed Electron preloads cannot require local modules, so this boundary must
// remain self-contained unless the preload is bundled during the build.
const INVOKE_CHANNELS = new Set([
  'agent:abort',
  'agent:archiveSession',
  'agent:backfillMemory',
  'agent:clearAllMemory',
  'agent:confirm',
  'agent:deleteSession',
  'agent:duplicateSession',
  'agent:getSessionInfo',
  'agent:getSessionMessages',
  'agent:listRecentSessions',
  'agent:listSessions',
  'agent:listSessionsGrouped',
  'agent:preferences:delete',
  'agent:preferences:get',
  'agent:preferences:upsert',
  'agent:renameSession',
  'agent:run',
  'agent:saveMessage',
  'agent:suggestions:accept',
  'agent:suggestions:blacklist',
  'agent:suggestions:dismiss',
  'agent:suggestions:list',
  'aiAnalysis:analyze',
  'aiAnalysis:chatStream',
  'aiAnalysis:chatStream:reportError',
  'aiAnalysis:clearHistory',
  'aiAnalysis:compressContext',
  'analysis:prepare',
  'batchSaveSeriesMixDesigns',
  'calculateMixDesign',
  'calculateSeriesMixDesign',
  'cancel-task',
  'cancelOptimization',
  'clear-task',
  'createMaterial',
  'createMixDesign',
  'deleteMaterial',
  'deleteMixDesign',
  'get-all-params',
  'get-all-tasks',
  'get-app-version',
  'get-param-by-name',
  'getAllMaterials',
  'getAllMixDesigns',
  'getMixDesignById',
  'getOptimizationTaskStatus',
  'optimizeMixDesign',
  'parse-import-file',
  'salesQuote:calculate',
  'salesQuote:createPumpingFeeItem',
  'salesQuote:deletePumpingFeeItem',
  'salesQuote:deleteQuote',
  'salesQuote:listEnabledPumpingFeeItems',
  'salesQuote:listHistory',
  'salesQuote:listPumpingFeeItems',
  'salesQuote:saveQuote',
  'salesQuote:updatePumpingFeeItem',
  'set-param',
  'show-open-dialog',
  'show-save-dialog',
  'slash:execute',
  'start-backup-task',
  'start-export-task',
  'start-import-task',
  'start-restore-task',
  'updateMaterial',
  'updateMixDesign',
  'workspace:rename',
  'workspace:searchGraph'
])

const EVENT_CHANNELS = new Set([
  'agent:confirmation-request',
  'agent:progress',
  'agent:sessionUpdated',
  'agent:suggestions:new',
  'aiAnalysis:chatStream:event',
  'background-task-progress',
  'data-refresh',
  'optimization-completed',
  'optimization-failed',
  'optimization-progress'
])

function assertAllowedIpcChannel(type, channel) {
  const channels = type === 'invoke' ? INVOKE_CHANNELS : type === 'event' ? EVENT_CHANNELS : null
  if (!channels || typeof channel !== 'string' || !channels.has(channel)) {
    throw new Error(`IPC channel is not allowed: ${String(channel)}`)
  }
}

// 存储 listener wrapper 的引用，用于 removeListener
const listenerCache = new Map()

// 生成唯一 ID
let listenerIdCounter = 0
const generateListenerId = () => `listener_${++listenerIdCounter}_${Date.now()}`

const invokeAllowed = (channel, ...args) => {
  assertAllowedIpcChannel('invoke', channel)
  return ipcRenderer.invoke(channel, ...args)
}

const onAllowed = (channel, func) => {
  assertAllowedIpcChannel('event', channel)
  if (typeof func !== 'function') throw new TypeError('IPC listener must be a function')
  const id = generateListenerId()
  const wrapper = (_event, ...args) => func(...args)
  listenerCache.set(id, { channel, wrapper })
  ipcRenderer.on(channel, wrapper)
  return id
}

const removeAllAllowedListeners = (channel) => {
  assertAllowedIpcChannel('event', channel)
  ipcRenderer.removeAllListeners(channel)
  for (const [id, entry] of listenerCache) {
    if (entry.channel === channel) listenerCache.delete(id)
  }
}

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: invokeAllowed,
  on: onAllowed,
  removeListener: (id) => {
    const entry = listenerCache.get(id)
    if (entry) {
      ipcRenderer.removeListener(entry.channel, entry.wrapper)
      listenerCache.delete(id)
    }
  },
  removeAllListeners: removeAllAllowedListeners,
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximized: (func) => {
      const id = generateListenerId()
      const wrapper = (event, ...args) => func(...args)
      listenerCache.set(id, { channel: 'window:maximized', wrapper })
      ipcRenderer.on('window:maximized', wrapper)
      return id
    },
    onUnmaximized: (func) => {
      const id = generateListenerId()
      const wrapper = (event, ...args) => func(...args)
      listenerCache.set(id, { channel: 'window:unmaximized', wrapper })
      ipcRenderer.on('window:unmaximized', wrapper)
      return id
    },
    removeListener: (id) => {
      const entry = listenerCache.get(id)
      if (entry) {
        ipcRenderer.removeListener(entry.channel, entry.wrapper)
        listenerCache.delete(id)
      }
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
    listFiles: (subdir, options) => ipcRenderer.invoke('workspace:listFiles', { subdir, ...(options || {}) }),
    openInExplorer: (workspacePath) => ipcRenderer.invoke('workspace:openInExplorer', { workspacePath }),
    rename: (oldPath, newName) => ipcRenderer.invoke('workspace:rename', { oldPath, newName }),
    readPage: (wikiPath) => ipcRenderer.invoke('workspace:readPage', { wikiPath }),
    pickFolder: () => ipcRenderer.invoke('workspace:pickFolder'),
    // P1 补全：源文件→wiki 入库（v4.8.3）
    ingest: (filename) => ipcRenderer.invoke('workspace:ingest', { filename }),
    // v9.1.0 补充：批量导入（带进度推送 + 取消）
    ingestBatch: (filenames) => ipcRenderer.invoke('workspace:ingestBatch', { filenames }),
    cancelIngestBatch: (batchId) => ipcRenderer.invoke('workspace:ingestBatch-cancel', { batchId }),
    onIngestBatchProgress: (func) => {
      const id = generateListenerId()
      const wrapper = (event, ...args) => func(...args)
      listenerCache.set(id, { channel: 'workspace:ingestBatch-progress', wrapper })
      ipcRenderer.on('workspace:ingestBatch-progress', wrapper)
      return id
    },
    onIngestBatchDone: (func) => {
      const id = generateListenerId()
      const wrapper = (event, ...args) => func(...args)
      listenerCache.set(id, { channel: 'workspace:ingestBatch-done', wrapper })
      ipcRenderer.on('workspace:ingestBatch-done', wrapper)
      return id
    },
    removeIngestBatchListener: (id) => {
      const entry = listenerCache.get(id)
      if (entry) {
        ipcRenderer.removeListener(entry.channel, entry.wrapper)
        listenerCache.delete(id)
      }
    },
    // Task 2.8：wiki 健康检查（5 类问题：orphans/missingFrontmatter/staleSummaries/missingCrossRef/contradictions）
    lint: () => ipcRenderer.invoke('workspace:lint'),
    // Task 3.2：写报告到 reports/ 并同步生成 wiki 版本
    writeFile: (type, filename, payload) => ipcRenderer.invoke('workspace:writeFile', { type, filename, payload })
    // 后续 task 加：search / searchGraph
  },
  // === Task 8：vision 模块（图片上传 + 缩略图列）===
  // file 来自拖拽的 File 对象，Electron 下 File 有 .path 属性（绝对路径）
  // 但 contextBridge 序列化会丢失 .path，所以预先拆成纯对象
  vision: {
    upload: (file) => ipcRenderer.invoke('vision:upload', { sourcePath: file.path, name: file.name }),
    list: () => ipcRenderer.invoke('vision:list')
  },
  // === Todo 计划面板（2026-07-08）：实时订阅 LLM 任务清单 ===
  // - list(sessionId)：mount 时拉取当前会话最新清单（兜底场景）
  // - onUpdate(func)：订阅 todo:updated 事件，回调收到 { sessionId, todos, total, completed }
  // - removeUpdateListener(id)：卸载时注销订阅
  todo: {
    list: (sessionId) => ipcRenderer.invoke('todo:list', { sessionId }),
    onUpdate: (func) => {
      const id = generateListenerId()
      const wrapper = (event, ...args) => func(...args)
      listenerCache.set(id, { channel: 'todo:updated', wrapper })
      ipcRenderer.on('todo:updated', wrapper)
      return id
    },
    removeUpdateListener: (id) => {
      const entry = listenerCache.get(id)
      if (entry) {
        ipcRenderer.removeListener(entry.channel, entry.wrapper)
        listenerCache.delete(id)
      }
    }
  },
  // LLM 配置管理
  llm: {
    list: () => ipcRenderer.invoke('llm:list'),
    save: (config) => ipcRenderer.invoke('llm:save', { config }),
    delete: (id) => ipcRenderer.invoke('llm:delete', { id }),
    activate: (id) => ipcRenderer.invoke('llm:activate', { id }),
    getActive: () => ipcRenderer.invoke('llm:getActive'),
    getActiveFull: () => ipcRenderer.invoke('llm:getActiveFull'),
    getFull: (id) => ipcRenderer.invoke('llm:getFull', { id }),
    test: (config) => ipcRenderer.invoke('llm:test', { config })
  }
})

// 兼容旧的 electron 对象
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: invokeAllowed,
    on: onAllowed,
    removeListener: (id) => {
      const entry = listenerCache.get(id)
      if (entry) {
        ipcRenderer.removeListener(entry.channel, entry.wrapper)
        listenerCache.delete(id)
      }
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
  // Todo 计划面板（兼容旧的 electron 对象访问点）
  todo: {
    list: (sessionId) => ipcRenderer.invoke('todo:list', { sessionId }),
    onUpdate: (func) => {
      const id = generateListenerId()
      const wrapper = (event, ...args) => func(...args)
      listenerCache.set(id, { channel: 'todo:updated', wrapper })
      ipcRenderer.on('todo:updated', wrapper)
      return id
    },
    removeUpdateListener: (id) => {
      const entry = listenerCache.get(id)
      if (entry) {
        ipcRenderer.removeListener(entry.channel, entry.wrapper)
        listenerCache.delete(id)
      }
    }
  }
})

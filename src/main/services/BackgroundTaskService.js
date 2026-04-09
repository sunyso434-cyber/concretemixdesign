// src/main/services/BackgroundTaskService.js
const { Notification } = require('electron')

class BackgroundTaskService {
  constructor() {
    // 任务队列: Map<id, task>
    this.tasks = new Map()
    // 任务计数器
    this.taskIdCounter = 0
    // webContents 引用（由 setWebContents 设置）
    this.webContents = null
  }

  /**
   * 设置 webContents，用于向渲染进程推送进度
   * @param {Electron.WebContents} wc
   */
  setWebContents(wc) {
    this.webContents = wc
  }

  /**
   * 生成唯一任务 ID
   */
  _generateId() {
    return `task_${++this.taskIdCounter}_${Date.now()}`
  }

  /**
   * 向渲染进程推送任务更新
   */
  _notifyRenderer(task) {
    try {
      if (!this.webContents) {
        console.error('[BackgroundTaskService] webContents is null, cannot send:', task.type)
        return
      }
      if (this.webContents.isDestroyed()) {
        console.error('[BackgroundTaskService] webContents is destroyed, cannot send:', task.type)
        return
      }
      this.webContents.send('background-task-progress', task)
      console.log('[BackgroundTaskService] Sent task update to renderer:', task.type, task.status)
    } catch (err) {
      console.error('[BackgroundTaskService] Notify renderer error:', err)
    }
  }

  /**
   * 通知渲染进程刷新数据（恢复/导入/导出操作后）
   * @param {string} taskType - 任务类型
   */
  _notifyDataRefresh(taskType) {
    // 仅恢复、导入、导出操作需要刷新数据
    if (!['restore', 'import', 'export'].includes(taskType)) return
    try {
      if (!this.webContents) {
        console.error('[BackgroundTaskService] webContents is null, cannot send data-refresh')
        return
      }
      if (this.webContents.isDestroyed()) {
        console.error('[BackgroundTaskService] webContents is destroyed, cannot send data-refresh')
        return
      }
      this.webContents.send('data-refresh', { type: taskType })
      console.log('[BackgroundTaskService] Sent data-refresh to renderer:', taskType)
    } catch (err) {
      console.error('[BackgroundTaskService] Notify data refresh error:', err)
    }
  }

  /**
   * 发送系统通知
   */
  _sendNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show()
      }
    } catch (err) {
      console.error('Notification error:', err)
    }
  }

  /**
   * 创建并启动一个后台任务
   * @param {string} type - 'backup' | 'restore' | 'export' | 'import'
   * @param {string} message - 任务描述
   * @param {Function} workerFn - 异步执行函数，接收 (onProgress) => any
   *   onProgress(percent: number) 调用一次推进进度
   * @returns {string} taskId
   */
  startTask(type, message, workerFn) {
    const id = this._generateId()
    const task = {
      id,
      type,
      status: 'running',
      progress: 0,
      message,
      result: null,
      error: null,
    }
    this.tasks.set(id, task)
    this._notifyRenderer(task)

    // 异步执行任务
    this._runTask(id, workerFn)
    return id
  }

  async _runTask(id, workerFn) {
    const task = this.tasks.get(id)
    if (!task) return

    const onProgress = (percent) => {
      const t = this.tasks.get(id)
      if (t) {
        t.progress = Math.min(100, Math.max(0, percent))
        this._notifyRenderer(t)
      }
    }

    try {
      console.log(`[BackgroundTaskService] Starting task ${id} of type ${task.type}`)
      const result = await workerFn(onProgress)
      const t = this.tasks.get(id)
      if (t) {
        t.status = 'completed'
        t.progress = 100
        t.result = result
        console.log(`[BackgroundTaskService] Task ${id} completed successfully`)
        this._notifyRenderer(t)
        // 通知渲染进程刷新数据
        this._notifyDataRefresh(t.type)
      }
    } catch (error) {
      console.error(`[BackgroundTaskService] Task ${id} failed:`, error.message, error.stack)
      const t = this.tasks.get(id)
      if (t) {
        t.status = 'failed'
        t.error = error.message
        this._notifyRenderer(t)
      }
    }
  }

  /**
   * 获取所有任务状态
   */
  getAllTasks() {
    return Array.from(this.tasks.values())
  }

  /**
   * 获取单个任务状态
   */
  getTask(id) {
    return this.tasks.get(id) || null
  }

  /**
   * 取消任务（仅当状态为 running 时有效）
   */
  cancelTask(id) {
    const task = this.tasks.get(id)
    if (task && task.status === 'running') {
      task.status = 'cancelled'
      this._notifyRenderer(task)
      return true
    }
    return false
  }

  /**
   * 删除已完成/失败/已取消的任务（清理）
   */
  clearTask(id) {
    this.tasks.delete(id)
  }
}

module.exports = new BackgroundTaskService()
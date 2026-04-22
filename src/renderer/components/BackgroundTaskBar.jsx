// src/renderer/components/BackgroundTaskBar.jsx
import React, { useState, useEffect } from 'react'
import { Progress, Button, Space, Typography } from 'antd'
import { CloseOutlined, CheckCircleFilled, ExclamationCircleFilled } from '@ant-design/icons'

const { Text } = Typography

/**
 * 全局后台任务进度条组件
 * 挂载在 App.jsx，作为全局覆盖层显示在页面右上角
 */
const BackgroundTaskBar = () => {
  const [tasks, setTasks] = useState([])

  useEffect(() => {
    // 初始加载所有任务
    const loadTasks = async () => {
      try {
        const result = await window.electron.ipcRenderer.invoke('get-all-tasks')
        if (result && result.success && Array.isArray(result.data)) {
          setTasks(result.data.filter(t => t && (t.status === 'running' || t.status === 'completed')))
        }
      } catch (err) {
        console.error('Load tasks error:', err)
      }
    }
    loadTasks()

    // 监听进度更新 - 直接接收展开的参数
    const handler = (...args) => {
      try {
        // args[0] 应该是 task 对象
        const task = args[0]
        if (!task || !task.id) {
          console.error('Invalid task received:', task)
          return
        }
        setTasks(prev => {
          const idx = prev.findIndex(t => t && t.id === task.id)
          if (idx >= 0) {
            const updated = [...prev]
            updated[idx] = task
            if (task.status === 'completed') {
              setTimeout(() => {
                setTasks(curr => curr.filter(t => t && t.id !== task.id))
                window.electron.ipcRenderer.invoke('clear-task', task.id)
              }, 5000)
            }
            return updated
          } else {
            return [...prev, task]
          }
        })
      } catch (err) {
        console.error('BackgroundTaskBar update error:', err)
      }
    }

    window.electron.ipcRenderer.on('background-task-progress', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('background-task-progress', handler)
    }
  }, [])

  const handleCancel = async (taskId) => {
    await window.electron.ipcRenderer.invoke('cancel-task', taskId)
  }

  if (tasks.length === 0) return null

  const getTypeLabel = (type) => {
    const map = { backup: '备份数据库', restore: '恢复数据库', export: '导出数据', import: '导入数据' }
    return map[type] || type
  }

  return (
    <div style={{
      position: 'fixed',
      top: 16,
      right: 16,
      zIndex: 9999,
      width: 360,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {tasks.slice(0, 3).map(task => (
        <div key={task.id} style={{
          background: '#fff',
          borderRadius: 8,
          padding: '12px 16px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          border: task.status === 'failed' ? '1px solid #ff4d4f' : '1px solid #f0f0f0',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Space>
              {task.status === 'completed' && <CheckCircleFilled style={{ color: '#52c41a' }} />}
              {task.status === 'failed' && <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />}
              <Text strong>{getTypeLabel(task.type)}</Text>
            </Space>
            {task.status === 'running' && (
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={() => handleCancel(task.id)}
              />
            )}
          </div>
          <Progress
            percent={task.progress}
            status={task.status === 'failed' ? 'exception' : undefined}
            size="small"
          />
          {task.result && task.status === 'completed' && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {task.type === 'import' && task.result.count ? `导入成功：${task.result.count} 条` :
               task.type === 'export' && task.result ? `导出成功` :
               task.type === 'restore' ? `恢复成功` :
               typeof task.result === 'string' ? task.result : `完成`}
            </Text>
          )}
          {task.error && task.status === 'failed' && (
            <Text type="danger" style={{ fontSize: 12 }}>{task.error}</Text>
          )}
        </div>
      ))}
      {tasks.length > 3 && (
        <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
          还有 {tasks.length - 3} 个任务...
        </div>
      )}
    </div>
  )
}

export default BackgroundTaskBar
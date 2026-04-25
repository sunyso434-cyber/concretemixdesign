// src/renderer/pages/SettingsPage.jsx
import React, { useState, useEffect, useCallback } from 'react'
import { Card, Tabs, Button, message, Space, Typography } from 'antd'
import { SaveOutlined, ReloadOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import ParamCard from '../components/ParamCard'
import ExportWizard from '../components/ExportWizard'
import ImportWizard from '../components/ImportWizard'
import RestoreConfirmModal from '../components/RestoreConfirmModal'
import { PARAM_CONFIG, PARAM_TABS } from '../config/paramConfig'

const { Text } = Typography

const TAB_KEYS = ['JGJ55标准', '系统设置', '备份设置', 'AI设置']

const SettingsPage = () => {
  const [params, setParams] = useState([])
  const [modifiedParams, setModifiedParams] = useState({})
  const [loading, setLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('JGJ55标准')

  const [exportWizardVisible, setExportWizardVisible] = useState(false)
  const [importWizardVisible, setImportWizardVisible] = useState(false)
  const [restoreModalVisible, setRestoreModalVisible] = useState(false)
  const [selectedBackupPath, setSelectedBackupPath] = useState('')

  useEffect(() => {
    const loadParams = async () => {
      setLoading(true)
      try {
        const result = await window.electron.ipcRenderer.invoke('get-all-params')
        if (result.success) {
          setParams(result.data)
        }
      } catch (e) {
        message.error('加载参数失败')
      } finally {
        setLoading(false)
      }
    }
    loadParams()

    // 监听数据刷新事件（备份/恢复/导入/导出操作完成后）
    const handleDataRefresh = () => {
      try {
        loadParams()
        message.info('数据已刷新')
      } catch (err) {
        console.error('数据刷新失败:', err)
        message.error('数据刷新失败')
      }
    }
    const listenerId = window.electron.ipcRenderer.on('data-refresh', handleDataRefresh)
    return () => {
      window.electron.ipcRenderer.removeListener(listenerId)
    }
  }, [])

  const getCurrentTabParams = useCallback(() => {
    const paramNames = PARAM_TABS[activeTab] || []
    return params.filter(p => paramNames.includes(p.name)).map(p => ({
      ...p,
      config: PARAM_CONFIG[p.name] || null,
    }))
  }, [activeTab, params])

  const handleParamChange = (name, value) => {
    setModifiedParams(prev => ({ ...prev, [name]: value }))
  }

  const getParamValue = (name) => {
    if (name in modifiedParams) return modifiedParams[name]
    const p = params.find(p => p.name === name)
    return p ? p.value : null
  }

  const handleSaveCurrentTab = async () => {
    const paramNames = PARAM_TABS[activeTab] || []
    const toSave = paramNames.filter(name => name in modifiedParams)
    if (toSave.length === 0) {
      message.info('没有需要保存的修改')
      return
    }

    setSaveLoading(true)
    try {
      for (const name of toSave) {
        const param = params.find(p => p.name === name)
        await window.electron.ipcRenderer.invoke('set-param', {
          name,
          value: modifiedParams[name],
          type: param?.type || 'system',
          description: param?.description || '',
        })
      }
      message.success('保存成功')
      setModifiedParams(prev => {
        const next = { ...prev }
        toSave.forEach(n => delete next[n])
        return next
      })
      const result = await window.electron.ipcRenderer.invoke('get-all-params')
      if (result.success) setParams(result.data)
    } catch (e) {
      message.error('保存失败')
    } finally {
      setSaveLoading(false)
    }
  }

  const handleResetCurrentTab = () => {
    const paramNames = PARAM_TABS[activeTab] || []
    setModifiedParams(prev => {
      const next = { ...prev }
      paramNames.forEach(n => delete next[n])
      return next
    })
    message.info('已重置为原始值')
  }

  const handleBackup = async () => {
    try {
      const dialogResult = await window.electron.ipcRenderer.invoke('show-save-dialog', {
        title: '选择备份保存位置',
        defaultPath: `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`,
        filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }],
      })
      if (dialogResult.data.canceled || !dialogResult.data.filePath) return
      window.electron.ipcRenderer.invoke('start-backup-task', dialogResult.data.filePath)
    } catch (e) {
      message.error('备份失败')
    }
  }

  const handleRestore = async () => {
    try {
      const dialogResult = await window.electron.ipcRenderer.invoke('show-open-dialog', {
        title: '选择备份文件',
        filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }],
        properties: ['openFile'],
      })
      if (dialogResult.data.canceled || dialogResult.data.filePaths.length === 0) return
      setSelectedBackupPath(dialogResult.data.filePaths[0])
      setRestoreModalVisible(true)
    } catch (e) {
      message.error('选择文件失败')
    }
  }

  const handleConfirmRestore = async () => {
    setRestoreModalVisible(false)
    window.electron.ipcRenderer.invoke('start-restore-task', selectedBackupPath)
  }

  const renderParamCards = () => {
    const tabParams = getCurrentTabParams()
    if (tabParams.length === 0) {
      return <Text type="secondary">该分类下暂无参数</Text>
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
        {tabParams.map(p => {
          if (!p.config) return null
          return (
            <ParamCard
              key={p.name}
              paramName={p.name}
              config={p.config}
              value={getParamValue(p.name)}
              onChange={(val) => handleParamChange(p.name, val)}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 className="page-title">系统设置</h2>
        <p className="page-subtitle">管理配合比参数和系统数据</p>
      </div>

      <Card className="custom-card" style={{ marginBottom: 24 }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={TAB_KEYS.map(key => ({
            key,
            label: key,
            children: (
              <div>
                {renderParamCards()}
                <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                  <Button icon={<ReloadOutlined />} onClick={handleResetCurrentTab}>
                    重置当前页
                  </Button>
                  <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={handleSaveCurrentTab}>
                    保存当前页
                  </Button>
                </div>
              </div>
            ),
          }))}
        />
      </Card>

      <Card className="custom-card" title="数据管理" style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">操作会覆盖现有数据，建议操作前先备份数据库</Text>
          <Space wrap>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleBackup}>
              备份数据库
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleRestore}>
              恢复数据库
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => setExportWizardVisible(true)}>
              导出数据
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => setImportWizardVisible(true)}>
              导入数据
            </Button>
          </Space>
        </Space>
      </Card>

      <Card className="custom-card" title="关于系统">
        <AppVersionInfo />
      </Card>

      {exportWizardVisible && (
        <ExportWizard onClose={() => setExportWizardVisible(false)} />
      )}
      {importWizardVisible && (
        <ImportWizard onClose={() => setImportWizardVisible(false)} />
      )}
      {restoreModalVisible && (
        <RestoreConfirmModal
          backupPath={selectedBackupPath}
          onConfirm={handleConfirmRestore}
          onCancel={() => setRestoreModalVisible(false)}
        />
      )}
    </div>
  )
}

const AppVersionInfo = () => {
  const [version, setVersion] = useState('1.0.0')
  useEffect(() => {
    window.electron.ipcRenderer.invoke('get-app-version').then(result => {
      if (result.success) setVersion(result.data)
    })
  }, [])
  return (
    <div style={{ padding: '16px', background: '#f9f9f9', borderRadius: 8 }}>
      <p style={{ marginBottom: 8 }}>混凝土配合比设计软件</p>
      <p style={{ marginBottom: 8 }}>版本：{version}</p>
      <p style={{ marginBottom: 8 }}>基于 Electron + React + SQLite 开发</p>
      <p>依据标准：JGJ 55, GB 50010-2010, GB 50204-2015, JGJ/T 193-2009</p>
    </div>
  )
}

export default SettingsPage
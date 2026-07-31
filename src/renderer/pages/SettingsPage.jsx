// src/renderer/pages/SettingsPage.jsx
import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { downloadTemplate, TEMPLATES } from '../utils/templateDownloader'
import { Card, Button, message, Space, Typography, Alert, Divider, List, Tag, Modal, Input, Select, Form, Popconfirm, Spin, Switch, Tooltip } from 'antd'
import { SaveOutlined, ReloadOutlined, DownloadOutlined, UploadOutlined, BookOutlined, ExperimentOutlined, SettingOutlined, DatabaseOutlined, RobotOutlined, AppstoreOutlined, WarningOutlined, PlusOutlined, DeleteOutlined, CheckCircleOutlined, ApiOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import ParamCard from '../components/ParamCard'
import ExportWizard from '../components/ExportWizard'
import ImportWizard from '../components/ImportWizard'
import RestoreConfirmModal from '../components/RestoreConfirmModal'
import SalesQuoteSettings from '../components/SalesQuoteSettings'
import SkillManager from '../components/SkillManager'
import TrainingPanel from '../components/TrainingPanel'
import { PARAM_CONFIG, PARAM_TABS } from '../config/paramConfig'

const { Text, Paragraph } = Typography

const PARAM_TAB_KEYS = ['JGJ55标准', '备份设置', '技能管理']

const SettingsPage = forwardRef((props, ref) => {
  const [params, setParams] = useState([])
  const [modifiedParams, setModifiedParams] = useState({})
  const [loading, setLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('LLM管理')

  const [exportWizardVisible, setExportWizardVisible] = useState(false)
  const [importWizardVisible, setImportWizardVisible] = useState(false)
  const [restoreModalVisible, setRestoreModalVisible] = useState(false)
  const [selectedBackupPath, setSelectedBackupPath] = useState('')

  // 暴露给父组件的方法：切换标签页
  useImperativeHandle(ref, () => ({
    switchTab: (tab) => {
      setActiveTab(tab)
    }
  }), [])

  useEffect(() => {
    const loadParams = async () => {
      setLoading(true)
      try {
        const result = await window.electronAPI.invoke('get-all-params')
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
    const listenerId = window.electronAPI.on('data-refresh', handleDataRefresh)
    return () => {
      window.electronAPI.removeListener(listenerId)
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
        await window.electronAPI.invoke('set-param', {
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
      const result = await window.electronAPI.invoke('get-all-params')
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
      const dialogResult = await window.electronAPI.invoke('show-save-dialog', {
        title: '选择备份保存位置',
        defaultPath: `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`,
        filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }],
      })
      if (dialogResult.data.canceled || !dialogResult.data.filePath) return
      window.electronAPI.invoke('start-backup-task', dialogResult.data.filePath)
    } catch (e) {
      message.error('备份失败')
    }
  }

  const handleRestore = async () => {
    try {
      const dialogResult = await window.electronAPI.invoke('show-open-dialog', {
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
    window.electronAPI.invoke('start-restore-task', selectedBackupPath)
  }

  const renderParamCards = () => {
    const tabParams = getCurrentTabParams()
    if (tabParams.length === 0) {
      return <Text type="secondary">该分类下暂无参数</Text>
    }
    return (
      <div className="param-cards-grid">
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

  // 根据 activeTab 渲染对应内容（不再使用 Tabs 顶部切换，由左侧导航控制）
  const renderActiveContent = () => {
    if (activeTab === '技能管理') return <SkillManager />
    if (activeTab === '销售报价') return <SalesQuoteSettings />
    if (activeTab === 'LLM管理') return <LlmManager />
    if (activeTab === '模型管理') return <TrainingPanel />
    if (activeTab === '系统设置') {
      return (
        <div>
          <Card title="数据管理">
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
          <Card title="关于系统" style={{ marginTop: 16 }}>
            <AppVersionInfo />
          </Card>
        </div>
      )
    }
    // JGJ55标准 / 备份设置 / AI设置：参数卡片 + 备份设置额外模板下载
    return (
      <div>
        {renderParamCards()}
        {activeTab === '备份设置' && (
          <>
            <Divider>模板下载</Divider>
            <Space direction="vertical" style={{ width: '100%' }}>
              {Object.values(TEMPLATES).map(template => (
                <Card key={template.key} size="small" className="template-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{template.name}</div>
                      <div style={{ color: '#999', fontSize: 12 }}>{template.description}</div>
                      <div style={{ marginTop: 4 }}>
                        {template.sheets.map(sheet => (
                          <Tag key={sheet} size="small">{sheet}</Tag>
                        ))}
                      </div>
                    </div>
                    <Button
                      type="primary"
                      icon={<DownloadOutlined />}
                      onClick={() => downloadTemplate(template.key)}
                    >
                      下载
                    </Button>
                  </div>
                </Card>
              ))}
            </Space>
          </>
        )}
        <div className="param-actions">
          <Button icon={<ReloadOutlined />} onClick={handleResetCurrentTab}>
            重置当前页
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saveLoading} onClick={handleSaveCurrentTab}>
            保存当前页
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container settings-page">
      <Card className="custom-card mb-lg">
        {renderActiveContent()}
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
})

// ========== LLM 管理组件 ==========
const LlmManager = () => {
  const [configs, setConfigs] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [testingId, setTestingId] = useState(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [form] = Form.useForm()
  const watchedProvider = Form.useWatch('provider', form)
  const watchedPreset = presets.find(p => p.value === watchedProvider)
  const features = watchedPreset?.features || {}

  const loadConfigs = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.llm.list()
      if (result.success) {
        setConfigs(result.data)
        setActiveId(result.activeId)
        setPresets(result.presets)
      }
    } catch (e) {
      message.error('加载 LLM 配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadConfigs() }, [])

  const handleActivate = async (id) => {
    const result = await window.electronAPI.llm.activate(id)
    if (result.success) {
      setActiveId(id)
      message.success('已切换 LLM 配置')
    } else {
      message.error(result.error)
    }
  }

  const handleDelete = async (id) => {
    const result = await window.electronAPI.llm.delete(id)
    if (result.success) {
      message.success('已删除')
      loadConfigs()
    } else {
      message.error(result.error)
    }
  }

  const handleTest = async (config) => {
    setTestingId(config.id)
    try {
      const fullResult = await window.electronAPI.llm.getFull(config.id)
      if (!fullResult.success) {
        message.error('无法获取配置详情')
        return
      }
      const fullConfig = fullResult.data
      const result = await window.electronAPI.llm.test({
        baseUrl: fullConfig.baseUrl,
        apiKey: fullConfig.apiKey,
        model: fullConfig.model
      })
      if (result.success) {
        message.success(`${config.name}: 连接成功`)
      } else {
        message.error(`${config.name}: ${result.error}`)
      }
    } catch (e) {
      message.error('测试失败')
    } finally {
      setTestingId(null)
    }
  }

  const openNew = () => {
    setEditingConfig(null)
    form.resetFields()
    setModalVisible(true)
  }

  const openEdit = async (config) => {
    setEditingConfig(config)
    // 获取完整配置（未脱敏 apiKey）
    const fullResult = await window.electronAPI.llm.getFull(config.id)
    const fullConfig = fullResult.success ? fullResult.data : config
    form.setFieldsValue({
      id: fullConfig.id,
      name: fullConfig.name,
      provider: fullConfig.provider || 'deepseek',
      baseUrl: fullConfig.baseUrl,
      apiKey: '',
      model: fullConfig.model,
      thinkingEnabled: fullConfig.thinkingEnabled !== false,
      reasoningEffort: fullConfig.reasoningEffort,
      visionCapable: fullConfig.visionCapable === true,
      maxTokens: fullConfig.maxTokens || 32768,
      timeout: fullConfig.timeout || 120000,
      contextLimit: fullConfig.contextLimit || 800000,
    })
    // 保存完整 apiKey 用于编辑保存
    setEditingConfig(fullConfig)
    setModalVisible(true)
  }

  const handleProviderChange = (provider) => {
    const preset = presets.find(p => p.value === provider)
    if (preset) {
      const updates = { baseUrl: preset.baseUrl }
      if (preset.defaults) {
        if (preset.defaults.model) updates.model = preset.defaults.model
        if (preset.defaults.maxTokens !== undefined) updates.maxTokens = preset.defaults.maxTokens
        if (preset.defaults.timeout !== undefined) updates.timeout = preset.defaults.timeout
        if (preset.defaults.contextLimit !== undefined) updates.contextLimit = preset.defaults.contextLimit
        if (preset.defaults.thinkingEnabled !== undefined) updates.thinkingEnabled = preset.defaults.thinkingEnabled
        if (preset.defaults.reasoningEffort !== undefined) updates.reasoningEffort = preset.defaults.reasoningEffort
      }
      // visionCapable 默认从厂商 supportsVision 继承
      if (preset.features?.supportsVision !== undefined) {
        updates.visionCapable = preset.features.supportsVision
      }
      form.setFieldsValue(updates)
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const config = {
        id: editingConfig?.id || null,
        name: values.name,
        provider: values.provider,
        baseUrl: values.baseUrl.replace(/\/+$/, ''),
        apiKey: values.apiKey || editingConfig?.apiKey || '',
        model: values.model,
        thinkingEnabled: values.thinkingEnabled !== false,
        reasoningEffort: values.reasoningEffort || undefined,
        visionCapable: values.visionCapable === true,
        maxTokens: values.maxTokens,
        timeout: values.timeout,
        contextLimit: values.contextLimit,
      }
      const result = await window.electronAPI.llm.save(config)
      if (result.success) {
        message.success('保存成功')
        setModalVisible(false)
        loadConfigs()
      } else {
        message.error(result.error)
      }
    } catch (e) {
      // Form validation error
    }
  }

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />

  return (
    <div>
      <Card
        title={
          <Space>
            <ApiOutlined />
            <span>LLM 配置管理</span>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
            新增配置
          </Button>
        }
      >
        {configs.length === 0 ? (
          <Text type="secondary">暂无 LLM 配置，请新增</Text>
        ) : (
          <List
            dataSource={configs}
            renderItem={item => (
              <List.Item
                actions={[
                  activeId === item.id ? (
                    <Tag color="green">当前</Tag>
                  ) : (
                    <Button size="small" type="link" onClick={() => handleActivate(item.id)}>
                      激活
                    </Button>
                  ),
                  <Button size="small" type="link" onClick={() => openEdit(item)}>
                    编辑
                  </Button>,
                  <Button size="small" type="link" loading={testingId === item.id} onClick={() => handleTest(item)}>
                    测试
                  </Button>,
                  <Popconfirm title="确定删除此配置？" onConfirm={() => handleDelete(item.id)}>
                    <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={<RobotOutlined style={{ fontSize: 20, color: activeId === item.id ? '#1890ff' : '#999' }} />}
                  title={
                    <Space>
                      <Text strong>{item.name}</Text>
                      {item.provider && <Tag>{item.provider}</Tag>}
                    </Space>
                  }
                  description={
                    <div>
                      <div>模型：{item.model || '未设置'}</div>
                      <div>API：{item.baseUrl || 'https://api.deepseek.com/v1'}</div>
                      <div>Key：{item.apiKey || '未设置'}</div>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title={editingConfig ? '编辑 LLM 配置' : '新增 LLM 配置'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：DeepSeek 正式版" />
          </Form.Item>
          <Form.Item name="provider" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
            <Select onChange={handleProviderChange} placeholder="选择供应商">
              {presets.map(p => (
                <Select.Option key={p.value} value={p.value}>{p.label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="baseUrl" label="API 地址" rules={[{ required: true, message: '请输入 API 地址' }]}>
            <Input placeholder="https://api.deepseek.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[editingConfig ? {} : { required: true, message: '请输入 API Key' }]}>
            <Input.Password
              placeholder={editingConfig ? '留空则保留原值' : 'sk-...'}
              iconRender={visible => (visible ? <EyeInvisibleOutlined /> : <ApiOutlined />)}
            />
          </Form.Item>
          <Form.Item name="model" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}>
            <Input placeholder="例如：agnes-2.0-flash" />
          </Form.Item>
          <Form.Item name="maxTokens" label="最大 Token 数">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="timeout" label="超时时间 (ms)">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="contextLimit" label="上下文限制 (tokens)">
            <Input type="number" />
          </Form.Item>
          {/* 以下选项根据厂商特性动态显隐 */}
          {features.supportsThinking && (
            <Form.Item name="thinkingEnabled" label="启用 thinking" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          {features.supportsReasoningEffort && (
            <Form.Item name="reasoningEffort" label="推理强度">
              <Select>
                {watchedProvider === 'deepseek' && [
                  <Select.Option key="high" value="high">high</Select.Option>,
                  <Select.Option key="max" value="max">max</Select.Option>,
                ]}
                {watchedProvider === 'openai' && [
                  <Select.Option key="low" value="low">low</Select.Option>,
                  <Select.Option key="medium" value="medium">medium</Select.Option>,
                  <Select.Option key="high" value="high">high</Select.Option>,
                ]}
              </Select>
            </Form.Item>
          )}
          <Form.Item
            name="visionCapable"
            label={
              <Tooltip title="开启后，用户发送的图片将直接交给当前模型处理（要求模型支持多模态）；关闭后，图片走独立的视觉分析技能">
                视觉能力 <WarningOutlined style={{ color: '#faad14' }} />
              </Tooltip>
            }
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

const AppVersionInfo = () => {
  const [version, setVersion] = useState('1.0.0')
  useEffect(() => {
    window.electronAPI.invoke('get-app-version').then(result => {
      if (result.success) setVersion(result.data)
    })
  }, [])
  return (
    <div className="settings-about-box">
      <p className="settings-about-line">混凝土配合比设计软件</p>
      <p className="settings-about-line">版本：{version}</p>
      <p className="settings-about-line">基于 Electron + React + SQLite 开发</p>
      <p>依据标准：JGJ 55, GB 50010-2010, GB 50204-2015, JGJ/T 193-2009</p>
    </div>
  )
}

export default SettingsPage
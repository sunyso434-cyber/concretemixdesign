import React, { useState, useEffect } from 'react'
import { Card, Button, Table, Space, message, Modal, Form, Input, Select, Tag } from 'antd'
import { Link } from 'react-router-dom'

const { Option } = Select

const SchemesPage = () => {
  const [schemes, setSchemes] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedSchemes, setSelectedSchemes] = useState([])
  const [viewModalVisible, setViewModalVisible] = useState(false)
  const [currentScheme, setCurrentScheme] = useState(null)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editForm] = Form.useForm()

  // 加载方案列表
  const loadSchemes = async () => {
    setLoading(true)
    try {
      console.log('开始加载方案列表...')
      const result = await window.electron.ipcRenderer.invoke('getAllMixDesigns')
      console.log('加载方案列表结果:', result)
      if (result.success) {
        console.log('获取到方案数量:', result.data.length)
        setSchemes(result.data)
      } else {
        console.error('加载方案失败:', result.error)
        message.error(result.error)
      }
    } catch (error) {
      console.error('加载方案异常:', error)
      message.error('加载方案失败')
    } finally {
      setLoading(false)
    }
  }

  // 初始化加载
  useEffect(() => {
    loadSchemes()
  }, [])

  // 查看方案详情
  const viewScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('getMixDesignById', id)
      if (result.success) {
        setCurrentScheme(result.data)
        setViewModalVisible(true)
      } else {
        message.error(result.error)
      }
    } catch (error) {
      message.error('获取方案详情失败')
    }
  }

  // 编辑方案
  const editScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('getMixDesignById', id)
      if (result.success) {
        setCurrentScheme(result.data)
        editForm.setFieldsValue(result.data)
        setEditModalVisible(true)
      } else {
        message.error(result.error)
      }
    } catch (error) {
      message.error('获取方案详情失败')
    }
  }

  // 删除方案
  const deleteScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('deleteMixDesign', id)
      if (result.success) {
        message.success('删除成功')
        loadSchemes()
      } else {
        message.error(result.error)
      }
    } catch (error) {
      message.error('删除失败')
    }
  }

  // 复制方案
  const copyScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('getMixDesignById', id)
      if (result.success) {
        const scheme = result.data
        const copyData = {
          ...scheme,
          id: undefined,
          name: `${scheme.name} (副本)`,
          createdAt: undefined,
          updatedAt: undefined
        }
        const createResult = await window.electron.ipcRenderer.invoke('createMixDesign', copyData)
        if (createResult.success) {
          message.success('复制成功')
          loadSchemes()
        } else {
          message.error(createResult.error)
        }
      } else {
        message.error(result.error)
      }
    } catch (error) {
      message.error('复制失败')
    }
  }

  // 导出方案
  const exportScheme = (scheme) => {
    message.info('导出方案功能开发中')
  }

  // 保存编辑
  const saveEdit = async () => {
    try {
      const values = await editForm.validateFields()
      const result = await window.electron.ipcRenderer.invoke('updateMixDesign', {
        id: currentScheme.id,
        data: values
      })
      if (result.success) {
        message.success('更新成功')
        setEditModalVisible(false)
        loadSchemes()
      } else {
        message.error(result.error)
      }
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 对比方案
  const compareSchemes = () => {
    if (selectedSchemes.length < 2) {
      message.warning('请选择至少两个方案进行对比')
      return
    }
    message.info('方案对比功能开发中')
  }

  // 处理方案选择
  const handleSchemeSelect = (selectedRowKeys) => {
    setSelectedSchemes(selectedRowKeys)
  }

  // 渲染状态标签
  const renderStatusTag = (status) => {
    switch (status) {
      case '已验证':
        return <Tag color="green">已验证</Tag>
      case '未验证':
        return <Tag color="orange">未验证</Tag>
      case '已使用':
        return <Tag color="red">已使用</Tag>
      default:
        return <Tag>{status}</Tag>
    }
  }

  const columns = [
    {
      title: '方案名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <div>
          <p>{text}</p>
          <p style={{ fontSize: '12px', color: '#666' }}>项目: {record.projectName || '无'}</p>
        </div>
      )
    },
    {
      title: '强度等级',
      dataIndex: 'strength',
      key: 'strength'
    },
    {
      title: '坍落度',
      dataIndex: 'slump',
      key: 'slump',
      render: (slump) => slump !== null && slump !== undefined ? `${slump}mm` : '未设置'
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date) => date ? new Date(date).toLocaleDateString() : '未知'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => renderStatusTag(status)
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          <Button size="small" onClick={() => viewScheme(record.id)}>查看</Button>
          <Button size="small" onClick={() => editScheme(record.id)}>编辑</Button>
          <Button size="small" onClick={() => copyScheme(record.id)}>复制</Button>
          <Button size="small" danger onClick={() => deleteScheme(record.id)}>删除</Button>
          <Button size="small" onClick={() => exportScheme(record)}>导出</Button>
        </Space>
      )
    }
  ]

  const rowSelection = {
    onChange: handleSchemeSelect
  }

  return (
    <div className="fade-in">
      <div className="mb-xl">
        <h2 className="page-title">📋 方案管理</h2>
        <p className="page-subtitle">管理混凝土配合比设计方案，包括查看、编辑、复制和删除操作。</p>
      </div>

      <div className="action-bar">
        <Link to="/mixdesign">
          <Button 
            type="primary" 
            className="custom-btn"
          >
            新建方案
          </Button>
        </Link>
      </div>

      <div className="custom-card">
        <Table 
          className="custom-table"
          dataSource={schemes.map(s => ({ ...s, key: s.id }))} 
          columns={columns} 
          loading={loading}
          rowSelection={rowSelection}
          pagination={{ 
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`
          }}
        />
      </div>

      <div className="mt-lg">
        <div className="custom-card">
          <div style={{ padding: 'var(--spacing-md)', background: 'var(--primary-light)', borderRadius: 'var(--border-radius-md)', marginBottom: 'var(--spacing-md)' }}>
            <p>已选择 <strong>{selectedSchemes.length}</strong> 个方案</p>
          </div>
          <Button 
            type="primary" 
            className="custom-btn"
            onClick={compareSchemes} 
            disabled={selectedSchemes.length < 2}
          >
            对比选中方案
          </Button>
        </div>
      </div>

      {/* 查看方案模态框 */}
      <Modal
        className="custom-modal"
        title="方案详情"
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        footer={[
          <Button key="close" className="custom-btn" onClick={() => setViewModalVisible(false)}>关闭</Button>
        ]}
        width={800}
      >
        {currentScheme && (
          <div>
            <h3 style={{ marginBottom: 'var(--spacing-md)', fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>{currentScheme.name}</h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-lg)' }}>项目名称: {currentScheme.projectName || '无'}</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)', marginBottom: 'var(--spacing-lg)' }}>
              <div style={{ padding: 'var(--spacing-md)', background: 'var(--primary-light)', borderRadius: 'var(--border-radius-md)' }}>
                <h4 style={{ marginBottom: 'var(--spacing-md)', fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)' }}>基本信息</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--spacing-sm)' }}>
                  <p>强度等级: <strong>{currentScheme.strength}</strong></p>
                  <p>坍落度: <strong>{currentScheme.slump !== null && currentScheme.slump !== undefined ? `${currentScheme.slump}mm` : '未设置'}</strong></p>
                  <p>环境类别: <strong>{currentScheme.environment}</strong></p>
                  <p>水胶比: <strong>{currentScheme.waterRatio?.toFixed(2)}</strong></p>
                  <p>砂率: <strong>{(currentScheme.sandRatio * 100)?.toFixed(1)}%</strong></p>
                  <p>容重: <strong>{currentScheme.density?.toFixed(1)} kg/m³</strong></p>
                  <p>状态: <strong>{renderStatusTag(currentScheme.status)}</strong></p>
                </div>
              </div>
              <div style={{ padding: 'var(--spacing-md)', background: 'var(--primary-light)', borderRadius: 'var(--border-radius-md)' }}>
                <h4 style={{ marginBottom: 'var(--spacing-md)', fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)' }}>材料用量</h4>
                {currentScheme.materials && (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {Object.entries(currentScheme.materials).map(([key, value]) => (
                      <li key={key} style={{ marginBottom: 'var(--spacing-sm)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{key === 'cement' ? '水泥' : 
                         key === 'flyAsh' ? '粉煤灰' : 
                         key === 'slag' ? '矿渣粉' : 
                         key === 'sand' ? '砂' : 
                         key === 'stone' ? '石' : 
                         key === 'water' ? '水' : 
                         key === 'superplasticizer' ? '减水剂' : key}:</span>
                        <span><strong>{typeof value === 'number' ? value.toFixed(1) : 'N/A'} kg/m³</strong></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            
            {currentScheme.materialDetails && (
              <div style={{ marginTop: 'var(--spacing-lg)', padding: 'var(--spacing-md)', background: 'var(--primary-light)', borderRadius: 'var(--border-radius-md)' }}>
                <h4 style={{ marginBottom: 'var(--spacing-md)', fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)' }}>原材料信息</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                  {Object.entries(currentScheme.materialDetails).map(([key, material]) => (
                    material && (
                      <div key={key} style={{ padding: 'var(--spacing-sm)', background: 'var(--card-bg)', borderRadius: 'var(--border-radius-sm)', boxShadow: 'var(--shadow-sm)' }}>
                        <p style={{ fontWeight: '600', marginBottom: 'var(--spacing-xs)' }}>{key === 'cement' ? '水泥' : 
                         key === 'flyAsh' ? '粉煤灰' : 
                         key === 'slag' ? '矿渣粉' : 
                         key === 'sand' ? '细骨料' : 
                         key === 'stone' ? '粗骨料' : 
                         key === 'superplasticizer' ? '外加剂' : key}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>名称: {material.name || 'N/A'}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>规格: {material.specification || 'N/A'}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>厂家: {material.manufacturer || 'N/A'}</p>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}
            
            {currentScheme.materialCosts && (
              <div style={{ marginTop: 'var(--spacing-lg)', padding: 'var(--spacing-md)', background: 'var(--primary-light)', borderRadius: 'var(--border-radius-md)' }}>
                <h4 style={{ marginBottom: 'var(--spacing-md)', fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)' }}>成本信息</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                  {Object.entries(currentScheme.materialCosts).map(([key, cost]) => (
                    <div key={key} style={{ padding: 'var(--spacing-sm)', background: 'var(--card-bg)', borderRadius: 'var(--border-radius-sm)', boxShadow: 'var(--shadow-sm)' }}>
                      <p style={{ fontWeight: '600', marginBottom: 'var(--spacing-xs)' }}>{key === 'cement' ? '水泥' : 
                       key === 'flyAsh' ? '粉煤灰' : 
                       key === 'slag' ? '矿渣粉' : 
                       key === 'sand' ? '细骨料' : 
                       key === 'stone' ? '粗骨料' : 
                       key === 'superplasticizer' ? '外加剂' : key}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>成本: <strong>{typeof cost === 'number' ? cost.toFixed(2) : 'N/A'} 元/m³</strong></p>
                    </div>
                  ))}
                </div>
                {currentScheme.totalCost && (
                  <div style={{ marginTop: 'var(--spacing-md)', padding: 'var(--spacing-sm)', background: 'var(--card-bg)', borderRadius: 'var(--border-radius-sm)', boxShadow: 'var(--shadow-sm)' }}>
                    <p style={{ fontWeight: '600', fontSize: '14px', textAlign: 'right' }}>总成本: <strong style={{ color: '#1890ff' }}>{currentScheme.totalCost.toFixed(2)} 元/m³</strong></p>
                  </div>
                )}
              </div>
            )}
            
            {currentScheme.description && (
              <div style={{ marginTop: 'var(--spacing-lg)', padding: 'var(--spacing-md)', background: 'var(--primary-light)', borderRadius: 'var(--border-radius-md)' }}>
                <h4 style={{ marginBottom: 'var(--spacing-sm)', fontSize: '14px', fontWeight: '600', color: 'var(--primary-dark)' }}>描述</h4>
                <p>{currentScheme.description}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 编辑方案模态框 */}
      <Modal
        className="custom-modal"
        title="编辑方案"
        open={editModalVisible}
        onOk={saveEdit}
        onCancel={() => setEditModalVisible(false)}
        width={600}
      >
        <Form className="custom-form" form={editForm} layout="vertical">
          <Form.Item name="name" label="方案名称" rules={[{ required: true, message: '请输入方案名称' }]}>
            <Input placeholder="请输入方案名称" />
          </Form.Item>
          <Form.Item name="projectName" label="项目名称">
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select placeholder="请选择状态">
              <Option value="未验证">未验证</Option>
              <Option value="已验证">已验证</Option>
              <Option value="已使用">已使用</Option>
            </Select>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入描述" rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default SchemesPage

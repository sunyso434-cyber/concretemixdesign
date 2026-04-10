// src/renderer/pages/massConcrete/HistoryPanel.jsx
import React, { useState, useEffect } from 'react'
import { Card, Table, Button, Space, Modal, message, Popconfirm } from 'antd'
import { useSelector, useDispatch } from 'react-redux'
import { setSchemes, setCurrentScheme, removeScheme, addScheme } from '../../../store/massConcreteSlice'

/**
 * 方案历史管理面板组件
 * 用于查看、加载和删除历史配合比方案
 * @param {Function} onLoadScheme - 加载方案时的回调函数
 */
const HistoryPanel = ({ onLoadScheme }) => {
  const dispatch = useDispatch()
  const schemes = useSelector(state => state.massConcrete.schemes)
  const currentScheme = useSelector(state => state.massConcrete.currentScheme)

  const [loading, setLoading] = useState(false)
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [selectedScheme, setSelectedScheme] = useState(null)

  // 加载所有方案
  useEffect(() => {
    loadSchemes()
  }, [])

  // 加载方案列表
  const loadSchemes = async () => {
    setLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('mc_getAllSchemes')
      if (result.success) {
        dispatch(setSchemes(result.data))
      } else {
        message.error(result.error || '加载方案失败')
      }
    } catch (error) {
      console.error('加载方案失败:', error)
      message.error('加载方案失败')
    } finally {
      setLoading(false)
    }
  }

  // 查看方案详情
  const viewSchemeDetail = async (scheme) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('mc_getSchemeById', scheme.id)
      if (result.success) {
        setSelectedScheme(result.data)
        setDetailModalVisible(true)
      } else {
        message.error(result.error || '获取方案详情失败')
      }
    } catch (error) {
      console.error('获取方案详情失败:', error)
      message.error('获取方案详情失败')
    }
  }

  // 加载方案
  const loadScheme = (scheme) => {
    dispatch(setCurrentScheme(scheme))
    onLoadScheme?.(scheme)
    message.success(`已加载方案: ${scheme.name}`)
  }

  // 删除方案
  const deleteScheme = async (scheme) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('mc_deleteScheme', scheme.id)
      if (result.success) {
        dispatch(removeScheme(scheme.id))
        message.success('删除成功')
      } else {
        message.error(result.error || '删除失败')
      }
    } catch (error) {
      console.error('删除方案失败:', error)
      message.error('删除方案失败')
    }
  }

  // 创建新方案（基于当前数据）
  const createNewScheme = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('mc_createScheme', {
        name: `新方案 ${schemes.length + 1}`,
        createdAt: new Date().toISOString()
      })
      if (result.success) {
        dispatch(addScheme(result.data))
        message.success('创建成功')
      } else {
        message.error(result.error || '创建失败')
      }
    } catch (error) {
      console.error('创建方案失败:', error)
      message.error('创建方案失败')
    }
  }

  // 表格列定义
  const columns = [
    {
      title: '方案名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <a onClick={() => viewSchemeDetail(record)}>{text}</a>
      )
    },
    {
      title: '项目名称',
      dataIndex: 'projectName',
      key: 'projectName'
    },
    {
      title: '强度等级',
      dataIndex: 'strength',
      key: 'strength'
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (text) => text ? new Date(text).toLocaleString() : '-'
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            onClick={() => loadScheme(record)}
            disabled={currentScheme?.id === record.id}
          >
            加载
          </Button>
          <Popconfirm
            title="确定要删除此方案吗？"
            onConfirm={() => deleteScheme(record)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  // 详情列定义
  const detailColumns = [
    {
      title: '材料',
      dataIndex: 'material',
      key: 'material'
    },
    {
      title: '用量 (kg/m³)',
      dataIndex: 'amount',
      key: 'amount',
      render: (value) => value ? value.toFixed(1) : '-'
    }
  ]

  return (
    <div>
      <Card
        className="custom-card"
        title="方案历史"
        extra={
          <Button type="primary" className="custom-btn" onClick={createNewScheme}>
            新建方案
          </Button>
        }
      >
        <Table
          dataSource={schemes}
          columns={columns}
          loading={loading}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 个方案`
          }}
        />
      </Card>

      {/* 方案详情弹窗 */}
      <Modal
        className="custom-modal"
        title={selectedScheme?.name || '方案详情'}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            关闭
          </Button>,
          <Button
            key="load"
            type="primary"
            className="custom-btn"
            onClick={() => {
              loadScheme(selectedScheme)
              setDetailModalVisible(false)
            }}
          >
            加载此方案
          </Button>
        ]}
        width={700}
      >
        {selectedScheme && (
          <div>
            <h4>基本信息</h4>
            <div className="grid-2-col" style={{ marginBottom: 16 }}>
              <p><strong>方案名称:</strong> {selectedScheme.name}</p>
              <p><strong>项目名称:</strong> {selectedScheme.projectName || '-'}</p>
              <p><strong>强度等级:</strong> {selectedScheme.strength || '-'}</p>
              <p><strong>创建时间:</strong> {selectedScheme.createdAt ? new Date(selectedScheme.createdAt).toLocaleString() : '-'}</p>
            </div>

            {selectedScheme.materials && (
              <>
                <h4>配合比材料用量</h4>
                <Table
                  dataSource={Object.entries(selectedScheme.materials).map(([key, value]) => ({
                    material: key,
                    amount: value
                  }))}
                  columns={detailColumns}
                  pagination={false}
                  size="small"
                />
              </>
            )}

            {selectedScheme.description && (
              <>
                <h4 style={{ marginTop: 16 }}>描述</h4>
                <p>{selectedScheme.description}</p>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default HistoryPanel
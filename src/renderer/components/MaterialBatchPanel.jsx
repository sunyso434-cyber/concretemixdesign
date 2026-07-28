import React, { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, DatePicker, Select, Tag, Space, message, Empty } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

// 各类材料过期规则，与服务端保持一致
const EXPIRY_RULES = {
  '水泥': { months: 3, field: 'productionDate' },
  '粉煤灰': { months: 6, field: 'productionDate' },
  '矿渣粉': { months: 6, field: 'productionDate' },
  '锂渣': { months: 6, field: 'productionDate' },
  '复合粉': { months: 6, field: 'productionDate' },
  '减水剂': { months: 6, field: 'expiryDate' },
  '细骨料': { days: 30, field: 'receiptDate' },
  '粗骨料': { days: 30, field: 'receiptDate' }
}

const isExpired = (batch, materialType) => {
  const rule = EXPIRY_RULES[materialType]
  if (!rule) return false
  const dateField = batch[rule.field]
  if (!dateField) return false
  const d = new Date(dateField)
  if (rule.months) d.setMonth(d.getMonth() + rule.months)
  if (rule.days) d.setDate(d.getDate() + rule.days)
  return new Date() > d
}

function MaterialBatchPanel({ materialId, materialType, onBatchChange }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingBatch, setEditingBatch] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const loadBatches = async () => {
    setLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('material:getBatches', { materialId })
      setBatches(result || [])
    } catch (err) {
      console.error('加载批次失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (materialId) {
      loadBatches()
    }
  }, [materialId])

  const openAddModal = () => {
    setEditingBatch(null)
    form.resetFields()
    setModalVisible(true)
  }

  const openEditModal = (batch) => {
    setEditingBatch(batch)
    const formValues = { ...batch }
    // 将日期字符串转为 dayjs 对象供 DatePicker 使用
    if (batch.productionDate) formValues.productionDate = dayjs(batch.productionDate)
    if (batch.receiptDate) formValues.receiptDate = dayjs(batch.receiptDate)
    if (batch.expiryDate) formValues.expiryDate = dayjs(batch.expiryDate)
    form.setFieldsValue(formValues)
    setModalVisible(true)
  }

  const handleDelete = (id) => {
    Modal.confirm({
      title: '删除确认',
      content: '确定要删除该批次吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.ipcRenderer.invoke('material:deleteBatch', { id })
          message.success('批次已删除')
          loadBatches()
          onBatchChange?.()
        } catch (err) {
          message.error('删除失败')
        }
      }
    })
  }

  const handleSetCurrent = async (batchId) => {
    try {
      await window.electron.ipcRenderer.invoke('material:setCurrentBatch', { materialId, batchId })
      message.success('已设为当前批次')
      loadBatches()
      onBatchChange?.()
    } catch (err) {
      message.error('设置失败')
    }
  }

  const handleSave = async (values) => {
    setSaving(true)
    try {
      const data = {
        ...values,
        // 将 dayjs 对象转为 ISO 字符串
        productionDate: values.productionDate ? values.productionDate.toISOString() : undefined,
        receiptDate: values.receiptDate ? values.receiptDate.toISOString() : undefined,
        expiryDate: values.expiryDate ? values.expiryDate.toISOString() : undefined,
      }

      if (editingBatch) {
        await window.electron.ipcRenderer.invoke('material:updateBatch', { id: editingBatch.id, ...data })
        message.success('批次已更新')
      } else {
        await window.electron.ipcRenderer.invoke('material:createBatch', { materialId, materialType, ...data })
        message.success('批次已添加')
      }
      setModalVisible(false)
      form.resetFields()
      loadBatches()
      onBatchChange?.()
    } catch (err) {
      message.error(editingBatch ? '更新失败' : '添加失败')
    } finally {
      setSaving(false)
    }
  }

  // 根据材料类型获取对应的日期字段配置
  const getDateFieldConfig = () => {
    const rule = EXPIRY_RULES[materialType]
    if (!rule) return null
    switch (rule.field) {
      case 'productionDate': return { name: 'productionDate', label: '生产日期' }
      case 'receiptDate': return { name: 'receiptDate', label: '进场日期' }
      case 'expiryDate': return { name: 'expiryDate', label: '有效期至' }
      default: return null
    }
  }

  const dateField = getDateFieldConfig()

  const columns = [
    {
      title: '批次号',
      dataIndex: 'batchNumber',
      key: 'batchNumber',
      width: 150
    },
    {
      title: '数量(吨)',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      render: (v) => (v != null ? v : '-')
    },
    {
      title: '供应商',
      dataIndex: 'supplier',
      key: 'supplier',
      width: 120,
      render: (v) => v || '-'
    },
    {
      title: dateField?.label || '日期',
      dataIndex: dateField?.name || 'productionDate',
      key: 'date',
      width: 120,
      render: (v) => (v ? new Date(v).toLocaleDateString('zh-CN') : '-')
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status, record) => {
        if (isExpired(record, materialType)) return <Tag color="red">已过期</Tag>
        const colorMap = { '在用': 'blue', '备用': 'orange' }
        return <Tag color={colorMap[status] || 'default'}>{status || '正常'}</Tag>
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<CheckCircleOutlined />}
            onClick={() => handleSetCurrent(record.id)}
          >
            设为当前
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          />
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
        </Space>
      )
    }
  ]

  return (
    <div style={{ padding: '12px 16px 4px' }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500 }}>批次管理</span>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAddModal}>
          新增批次
        </Button>
      </div>

      <Table
        dataSource={batches}
        columns={columns}
        loading={loading}
        rowKey="id"
        size="small"
        locale={{
          emptyText: <Empty description="该材料暂无批次，请添加" />
        }}
        pagination={batches.length > 10 ? { pageSize: 10, showTotal: (total) => `共 ${total} 条` } : false}
      />

      <Modal
        title={editingBatch ? '编辑批次' : '新增批次'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
        }}
        confirmLoading={saving}
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="batchNumber"
            label="批次号"
            rules={[{ required: true, message: '请输入批次号' }]}
          >
            <Input placeholder="例如：2026-07-001" />
          </Form.Item>

          {dateField && (
            <Form.Item
              name={dateField.name}
              label={dateField.label}
              rules={[{ required: true, message: `请选择${dateField.label}` }]}
            >
              <DatePicker style={{ width: '100%' }} placeholder={`选择${dateField.label}`} />
            </Form.Item>
          )}

          <Form.Item name="quantity" label="数量 (吨)">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="输入数量" />
          </Form.Item>

          <Form.Item name="supplier" label="供应商">
            <Input placeholder="输入供应商名称" />
          </Form.Item>

          <Form.Item name="status" label="状态" initialValue="正常">
            <Select
              options={[
                { label: '正常', value: '正常' },
                { label: '在用', value: '在用' },
                { label: '备用', value: '备用' }
              ]}
            />
          </Form.Item>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default MaterialBatchPanel

import React, { useEffect, useState } from 'react'
import { Button, Table, Modal, Form, Input, InputNumber, Switch, Space, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import extractErrorMessage from '../utils/extractErrorMessage'

const PumpingFeeTab = () => {
  const [items, setItems] = useState([])
  const [modalVisible, setModalVisible] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [form] = Form.useForm()

  const load = async () => {
    const result = await window.electronAPI.invoke('salesQuote:listPumpingFeeItems')
    if (result.success) setItems(result.data)
    else message.error(extractErrorMessage(result.error, '加载泵送费清单失败'))
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    const values = await form.validateFields()
    const data = { ...values, enabled: values.enabled !== false }
    let result
    if (editingItem) {
      result = await window.electronAPI.invoke('salesQuote:updatePumpingFeeItem', { id: editingItem.id, data })
    } else {
      result = await window.electronAPI.invoke('salesQuote:createPumpingFeeItem', data)
    }
    if (result.success) {
      message.success(editingItem ? '已更新' : '已创建')
      setModalVisible(false)
      load()
    } else {
      message.error(extractErrorMessage(result.error, '保存失败'))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('确认删除？')) return
    const result = await window.electronAPI.invoke('salesQuote:deletePumpingFeeItem', id)
    if (result.success) { message.success('已删除'); load() }
    else message.error(extractErrorMessage(result.error))
  }

  const openEditor = (item) => {
    setEditingItem(item)
    form.setFieldsValue(item || { name: '', unitPrice: 0, enabled: true, sortOrder: items.length + 1 })
    setModalVisible(true)
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => openEditor(null)}>新增泵送方式</Button>
      </div>
      <Table
        rowKey="id" dataSource={items} pagination={false} size="small"
        columns={[
          { title: '排序', dataIndex: 'sortOrder', width: 60 },
          { title: '泵送方式', dataIndex: 'name' },
          { title: '单价(元/m³)', dataIndex: 'unitPrice', width: 120 },
          { title: '启用', dataIndex: 'enabled', width: 80, render: v => v ? '是' : '否' },
          {
            title: '操作', width: 160,
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => openEditor(row)}>编辑</Button>
                <Button size="small" danger onClick={() => handleDelete(row.id)}>删除</Button>
              </Space>
            )
          }
        ]}
      />
      <Modal
        title={editingItem ? '编辑泵送方式' : '新增泵送方式'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="泵送方式名称" rules={[{ required: true }]}>
            <Input placeholder="如 车泵 60m以上" />
          </Form.Item>
          <Form.Item name="unitPrice" label="单价(元/m³)" rules={[{ required: true }]}>
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PumpingFeeTab

import React, { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, message, Popconfirm } from 'antd'

export default function CapacityConfigPanel() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()

  const loadData = async () => {
    setLoading(true)
    const res = await window.electronAPI.invoke('capacity:getAll')
    if (res.success) setData(res.data)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const handleSave = async () => {
    const values = await form.validateFields()
    // 处理 JSON 字段
    const payload = {
      ...values,
      mixerTowerNos: values.mixerTowerNosStr ? values.mixerTowerNosStr.split(',').map(s => s.trim()) : [],
      lineSpec: values.lineSpecStr ? JSON.parse(values.lineSpecStr) : null,
      mixCoefficients: values.mixCoefficientsStr ? JSON.parse(values.mixCoefficientsStr) : { C30: 1.0 }
    }
    delete payload.mixerTowerNosStr; delete payload.lineSpecStr; delete payload.mixCoefficientsStr
    const res = editingId
      ? await window.electronAPI.invoke('capacity:update', { id: editingId, data: payload })
      : await window.electronAPI.invoke('capacity:create', { data: payload })
    if (res.success) {
      message.success(editingId ? '更新成功' : '创建成功')
      setModalOpen(false); setEditingId(null); form.resetFields(); loadData()
    } else {
      message.error(res.error.message)
    }
  }

  const handleDelete = async (id) => {
    const res = await window.electronAPI.invoke('capacity:delete', { id })
    if (res.success) { message.success('删除成功'); loadData() }
    else message.error(res.error.message)
  }

  const columns = [
    { title: '分公司', dataIndex: 'branchName', key: 'branchName' },
    { title: '生产线数', dataIndex: 'lineCount', key: 'lineCount' },
    { title: 'C30效率', dataIndex: 'c30Efficiency', key: 'c30Efficiency' },
    { title: '搅拌楼号', key: 'mixerTowerNos', render: (_, r) => (r.mixerTowerNos || []).join(', ') },
    { title: '油车(数/单价/容量)', key: 'oil', render: (_, r) => `${r.selfOilTruckCount}/${r.selfOilTruckPrice}/${r.selfOilTruckCapacity}` },
    { title: '电车(数/单价/容量)', key: 'elec', render: (_, r) => `${r.selfElecTruckCount}/${r.selfElecTruckPrice}/${r.selfElecTruckCapacity}` },
    { title: '外租(数/单价/容量)', key: 'rental', render: (_, r) => `${r.rentalTruckCount}/${r.rentalTruckPrice}/${r.rentalTruckCapacity}` },
    { title: '装卸料(min)', key: 'time', render: (_, r) => `${r.loadTimeMin}/${r.unloadTimeMin}` },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <>
          <Button size="small" onClick={() => { setEditingId(r.id); setModalOpen(true); form.setFieldsValue({ ...r, mixerTowerNosStr: (r.mixerTowerNos||[]).join(', '), lineSpecStr: r.lineSpec ? JSON.stringify(r.lineSpec) : '', mixCoefficientsStr: r.mixCoefficients ? JSON.stringify(r.mixCoefficients) : '' }) }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </>
      )
    }
  ]

  return (
    <div>
      <Button type="primary" onClick={() => { setEditingId(null); setModalOpen(true); form.resetFields() }} style={{ marginBottom: 16 }}>+ 新增分公司配置</Button>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} scroll={{ x: 1200 }} />
      <Modal title={editingId ? '编辑产能配置' : '新增产能配置'} open={modalOpen} onOk={handleSave} onCancel={() => { setModalOpen(false); setEditingId(null); form.resetFields() }} destroyOnClose width={700}>
        <Form form={form} layout="vertical">
          <Form.Item name="branchName" label="分公司名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="lineCount" label="生产线数量" rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
          <Form.Item name="c30Efficiency" label="C30生产效率(m³/h)" rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
          <Form.Item name="mixerTowerNosStr" label="搅拌楼号(逗号分隔)"><Input placeholder="1号楼,2号楼" /></Form.Item>
          <Form.Item name="selfOilTruckCount" label="自有油车数"><InputNumber min={0} /></Form.Item>
          <Form.Item name="selfOilTruckPrice" label="自有油车单价(元/方·公里)"><InputNumber min={0} /></Form.Item>
          <Form.Item name="selfOilTruckCapacity" label="自有油车容量(m³)"><InputNumber min={0} /></Form.Item>
          <Form.Item name="selfElecTruckCount" label="自有电车数"><InputNumber min={0} /></Form.Item>
          <Form.Item name="selfElecTruckPrice" label="自有电车单价"><InputNumber min={0} /></Form.Item>
          <Form.Item name="selfElecTruckCapacity" label="自有电车容量"><InputNumber min={0} /></Form.Item>
          <Form.Item name="rentalTruckCount" label="外租车数"><InputNumber min={0} /></Form.Item>
          <Form.Item name="rentalTruckPrice" label="外租单价"><InputNumber min={0} /></Form.Item>
          <Form.Item name="rentalTruckCapacity" label="外租容量"><InputNumber min={0} /></Form.Item>
          <Form.Item name="loadTimeMin" label="装料时间(min)"><InputNumber min={0} initialValue={10} /></Form.Item>
          <Form.Item name="unloadTimeMin" label="卸料时间(min)"><InputNumber min={0} initialValue={10} /></Form.Item>
          <Form.Item name="lineSpecStr" label="生产线规格(JSON)"><Input placeholder='{"model":"hzs180"}' /></Form.Item>
          <Form.Item name="mixCoefficientsStr" label="搅拌系数(JSON)"><Input placeholder='{"C30":1.0,"C40":1.1}' /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
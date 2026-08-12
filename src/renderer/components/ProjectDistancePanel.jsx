import React, { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Select, TimePicker, message, Popconfirm } from 'antd'

export default function ProjectDistancePanel() {
  const [data, setData] = useState([])
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()

  // 打开时填充表单（Modal 打开后 Form 才挂载，避免 useForm 时序警告/编辑回填丢失）
  const handleOpenChange = (open) => {
    if (!open) return
    if (editingId) {
      const r = data.find(d => d.id === editingId)
      if (r) form.setFieldsValue({ ...r })
    } else {
      form.resetFields()
    }
  }

  const loadData = async () => {
    setLoading(true)
    const [distRes, capRes] = await Promise.all([
      window.electronAPI.invoke('distance:getMatrix'),
      window.electronAPI.invoke('capacity:getAll')
    ])
    if (distRes.success) setData(distRes.data)
    if (capRes.success) setBranches(capRes.data)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const handleSave = async () => {
    const values = await form.validateFields()
    const payload = { ...values }
    if (payload.peakStart1) payload.peakStart1 = payload.peakStart1.format('HH:mm')
    if (payload.peakEnd1) payload.peakEnd1 = payload.peakEnd1.format('HH:mm')
    if (payload.peakStart2) payload.peakStart2 = payload.peakStart2.format('HH:mm')
    if (payload.peakEnd2) payload.peakEnd2 = payload.peakEnd2.format('HH:mm')
    const res = editingId
      ? await window.electronAPI.invoke('distance:update', { id: editingId, data: payload })
      : await window.electronAPI.invoke('distance:create', { data: payload })
    if (res.success) {
      message.success('保存成功')
      setModalOpen(false); setEditingId(null); form.resetFields(); loadData()
    } else message.error(res.error.message)
  }

  const columns = [
    { title: '工程名称', dataIndex: 'projectName', key: 'projectName' },
    { title: '站点', key: 'branchName', render: (_, r) => branches.find(b => b.id === r.branchId)?.branchName || r.branchId },
    { title: '距离(km)', dataIndex: 'distanceKm', key: 'distanceKm' },
    { title: '运输时间(min)', dataIndex: 'baseTransportMin', key: 'baseTransportMin' },
    { title: '早高峰', key: 'peak1', render: (_, r) => `${r.peakStart1 || ''}-${r.peakEnd1 || ''}` },
    { title: '晚高峰', key: 'peak2', render: (_, r) => `${r.peakStart2 || ''}-${r.peakEnd2 || ''}` },
    { title: '峰时系数', dataIndex: 'peakFactor', key: 'peakFactor' },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <>
          <Button size="small" onClick={() => { setEditingId(r.id); setModalOpen(true) }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={async () => { const res = await window.electronAPI.invoke('distance:delete', { id: r.id }); if (res.success) { message.success('删除成功'); loadData() } else message.error(res.error.message) }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </>
      )
    }
  ]

  return (
    <div>
      <Button type="primary" onClick={() => { setEditingId(null); setModalOpen(true) }} style={{ marginBottom: 16 }}>+ 新增距离记录</Button>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} scroll={{ x: 900 }} />
      <Modal title={editingId ? '编辑距离记录' : '新增距离记录'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)} afterOpenChange={handleOpenChange} destroyOnHidden width={700}>
        <Form form={form} layout="vertical">
          <Form.Item name="projectName" label="工程名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="branchId" label="站点" rules={[{ required: true }]}>
            <Select placeholder="选择站点">
              {branches.map(b => <Select.Option key={b.id} value={b.id}>{b.branchName}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="distanceKm" label="距离(km)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="baseTransportMin" label="基础运输时间(min)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="peakStart1" label="早高峰起"><TimePicker format="HH:mm" /></Form.Item>
          <Form.Item name="peakEnd1" label="早高峰止"><TimePicker format="HH:mm" /></Form.Item>
          <Form.Item name="peakStart2" label="晚高峰起"><TimePicker format="HH:mm" /></Form.Item>
          <Form.Item name="peakEnd2" label="晚高峰止"><TimePicker format="HH:mm" /></Form.Item>
          <Form.Item name="peakFactor" label="峰时系数" initialValue={1.5}><InputNumber min={1} step={0.1} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
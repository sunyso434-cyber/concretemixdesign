import React, { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Select, message, Popconfirm } from 'antd'

export default function CapacityConfigPanel() {
  const [data, setData] = useState([])
  const [c30MixDesigns, setC30MixDesigns] = useState([]) // v0.8.1：C30 标号的配合比列表（用于下拉选）
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form] = Form.useForm()

  // 打开时填充表单（Modal 打开后 Form 才挂载，避免 useForm 时序警告/编辑回填丢失）
  const handleOpenChange = (open) => {
    if (!open) return
    if (editingId) {
      const r = data.find(d => d.id === editingId)
      if (r) form.setFieldsValue({
        ...r,
        mixerTowerNosStr: (r.mixerTowerNos || []).join(', '),
        lineSpecStr: r.lineSpec ? JSON.stringify(r.lineSpec) : '',
        mixCoefficientsStr: r.mixCoefficients ? JSON.stringify(r.mixCoefficients) : ''
      })
    } else {
      form.resetFields()
    }
  }

  const loadData = async () => {
    setLoading(true)
    const res = await window.electronAPI.invoke('capacity:getAll')
    if (res.success) setData(res.data)
    // v0.8.1：拉取 C30 配合比列表用于下拉
    const mdRes = await window.electronAPI.invoke('getAllMixDesigns')
    if (mdRes.success) {
      setC30MixDesigns(mdRes.data.filter(m => m.strength === 'C30'))
    }
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
    // v0.8.1：C30 基准配合比列
    {
      title: 'C30基准配合比', key: 'c30Mix',
      render: (_, r) => {
        if (!r.c30BaselineMixDesignId) return <span style={{ color: '#999' }}>未绑定</span>
        const m = c30MixDesigns.find(x => x.id === r.c30BaselineMixDesignId)
        return m ? `${m.name || '方案' + m.id} (${m.totalCost || 0}元/方)` : `#${r.c30BaselineMixDesignId}(已删)`
      }
    },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <>
          <Button size="small" onClick={() => { setEditingId(r.id); setModalOpen(true) }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </>
      )
    }
  ]

  return (
    <div>
      <Button type="primary" onClick={() => { setEditingId(null); setModalOpen(true) }} style={{ marginBottom: 16 }}>+ 新增分公司配置</Button>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} scroll={{ x: 1400 }} />
      <Modal title={editingId ? '编辑产能配置' : '新增产能配置'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)} afterOpenChange={handleOpenChange} destroyOnHidden width={700}>
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
          <Form.Item name="loadTimeMin" label="装料时间(min)" initialValue={10}><InputNumber min={0} /></Form.Item>
          <Form.Item name="unloadTimeMin" label="卸料时间(min)" initialValue={10}><InputNumber min={0} /></Form.Item>
          <Form.Item name="lineSpecStr" label="生产线规格(JSON)"><Input placeholder='{"model":"hzs180"}' /></Form.Item>
          <Form.Item name="mixCoefficientsStr" label="搅拌系数(JSON)"><Input placeholder='{"C30":1.0,"C40":1.1}' /></Form.Item>
          {/* v0.8.1：C30 基准配合比（用于成本对比，必须选 C30 标号的方案） */}
          <Form.Item name="c30BaselineMixDesignId" label="C30基准配合比(用于成本对比)" extra="从配合比库中选一个C30标号方案，用于跨分公司成本对比">
            <Select allowClear placeholder="选择C30配合比方案">
              {c30MixDesigns.map(m => <Select.Option key={m.id} value={m.id}>{m.name || `方案${m.id}`} ({m.totalCost || 0}元/方)</Select.Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
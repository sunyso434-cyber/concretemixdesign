import React, { useState, useEffect } from 'react'
import { Table, Button, message, Popconfirm, Empty } from 'antd'
import VehicleDetailForm from './VehicleDetailForm'

export default function VehicleDetailSubTable({ planId, onChange }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const loadData = async () => {
    if (!planId) return
    setLoading(true)
    const res = await window.electronAPI.invoke('vehicleDetail:listByPlan', { planId })
    if (res.success) setData(res.data)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [planId])

  // 车次变更后通知父表刷新进度
  const notifyParent = () => { if (onChange) onChange() }

  const handleSave = async (values) => {
    const res = editingId
      ? await window.electronAPI.invoke('vehicleDetail:update', { id: editingId, data: values })
      : await window.electronAPI.invoke('vehicleDetail:create', { data: { ...values, planId, source: 'manual' } })
    if (res.success) {
      message.success('保存成功')
      setFormOpen(false); setEditingId(null); loadData(); notifyParent()
    } else message.error(res.error.message)
  }

  const handleDelete = async (id) => {
    const res = await window.electronAPI.invoke('vehicleDetail:delete', { id })
    if (res.success) { message.success('删除成功'); loadData(); notifyParent() }
    else message.error(res.error.message)
  }

  const columns = [
    { title: '搅拌楼号', dataIndex: 'mixerTowerNo', key: 'mixerTowerNo' },
    { title: '生产日期', dataIndex: 'productionDate', key: 'productionDate' },
    { title: '生产时间', dataIndex: 'productionTime', key: 'productionTime' },
    { title: '发货号', dataIndex: 'shipmentNo', key: 'shipmentNo' },
    { title: '工程名称', dataIndex: 'projectName', key: 'projectName' },
    { title: '部位', dataIndex: 'pourLocation', key: 'pourLocation' },
    { title: '标号', dataIndex: 'strengthGrade', key: 'strengthGrade' },
    { title: '方量', dataIndex: 'volume', key: 'volume' },
    { title: '车牌', dataIndex: 'plateNo', key: 'plateNo' },
    { title: '司机', dataIndex: 'driver', key: 'driver' },
    { title: '供应方式', dataIndex: 'supplyMethod', key: 'supplyMethod' },
    { title: '来源', dataIndex: 'source', key: 'source' },
    {
      title: '操作', key: 'action',
      render: (_, r) => (
        <>
          <Button size="small" onClick={() => { setEditingId(r.id); setFormOpen(true) }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </>
      )
    }
  ]

  return (
    <div>
      {data.length === 0 && !loading ? (
        <Empty description="暂无车次明细，导入请告诉AI助手" />
      ) : (
        <Button size="small" onClick={() => { setEditingId(null); setFormOpen(true) }} style={{ marginBottom: 8 }}>+ 手工补录</Button>
      )}
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} size="small" scroll={{ x: 1200 }} pagination={false} />
      <VehicleDetailForm
        open={formOpen}
        editingId={editingId}
        initialValues={editingId ? data.find(d => d.id === editingId) : {}}
        onSave={handleSave}
        onCancel={() => { setFormOpen(false); setEditingId(null) }}
      />
    </div>
  )
}
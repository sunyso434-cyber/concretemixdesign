import React, { useState, useEffect } from 'react'
import { Table, Button, message, Popconfirm, Progress, Tag, Modal } from 'antd'
import DailyPlanForm from './DailyPlanForm'
import VehicleDetailSubTable from './VehicleDetailSubTable'

export default function DailyPlanPanel({ date, branchId }) {
  const [data, setData] = useState([])
  const [branches, setBranches] = useState([])
  const [projectNames, setProjectNames] = useState([])
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const loadData = async () => {
    setLoading(true)
    const res = await window.electronAPI.invoke('dailyPlan:listWithDetails', { date, branchId })
    if (res.success) setData(res.data)
    // v0.8.1：配合比改为分公司绑定，不再拉取 getAllMixDesigns
    const [capRes, pnRes] = await Promise.all([
      window.electronAPI.invoke('capacity:getAll'),
      window.electronAPI.invoke('dailyPlan:listRecentProjects')
    ])
    if (capRes.success) setBranches(capRes.data)
    if (pnRes.success) setProjectNames(pnRes.data)
    setLoading(false)
  }

  useEffect(() => { loadData() }, [date, branchId])

  const handleSave = async (values) => {
    const res = editingId
      ? await window.electronAPI.invoke('dailyPlan:update', { id: editingId, data: values })
      : await window.electronAPI.invoke('dailyPlan:create', { data: values })
    if (res.success) {
      message.success(editingId ? '更新成功' : '创建成功')
      setFormOpen(false); setEditingId(null); loadData()
    } else message.error(res.error.message)
  }

  const handleDelete = async (id, forceDelete = false) => {
    const res = await window.electronAPI.invoke('dailyPlan:delete', { id, forceDelete })
    if (res.success) { message.success('删除成功'); loadData() }
    else if (res.error.code === 'E-PLAN-003') {
      Modal.confirm({
        title: '该计划有车次明细',
        content: '强制删除会置车次planId为NULL(变为未匹配)。确认强制删除？',
        onOk: () => handleDelete(id, true)
      })
    } else message.error(res.error.message)
  }

  const columns = [
    {
      title: '项目/部位/标号', key: 'info',
      render: (_, r) => <div><div>{r.projectName}</div><div style={{ fontSize: 12, color: '#999' }}>{r.pourLocation} · {r.strengthGrade}</div></div>
    },
    { title: '施工单位', dataIndex: 'constructionUnit', key: 'constructionUnit' },
    { title: '方量', dataIndex: 'volume', key: 'volume' },
    { title: '发料分公司', key: 'branch', render: (_, r) => branches.find(b => b.id === r.branchId)?.branchName || r.branchId },
    { title: '发料时间', dataIndex: 'plannedSendTime', key: 'plannedSendTime' },
    { title: '持续(h)', dataIndex: 'expectedDuration', key: 'expectedDuration' },
    {
      title: '已执行/进度', key: 'progress',
      render: (_, r) => (
        <div>
          <span>{r.executedVolume}/{r.volume}m³</span>
          <Progress percent={r.progressPercent} size="small" status={r.overBudget ? 'exception' : (r.progressPercent >= 100 ? 'success' : 'active')} />
        </div>
      )
    },
    { title: '状态', key: 'status', render: (_, r) => <Tag color={r.status === 'completed' ? 'green' : r.status === 'executing' ? 'blue' : 'default'}>{r.status}</Tag> },
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
      <Button type="primary" onClick={() => { setEditingId(null); setFormOpen(true) }} style={{ marginBottom: 16 }}>+ 新增计划</Button>
      <Button onClick={loadData} style={{ marginLeft: 8 }}>刷新</Button>
      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1200 }}
        expandable={{
          expandedRowRender: (r) => <VehicleDetailSubTable planId={r.id} onChange={loadData} />,
          rowExpandable: (r) => true
        }}
      />
      <DailyPlanForm
        open={formOpen}
        editingId={editingId}
        initialValues={editingId ? data.find(d => d.id === editingId) : { planDate: date }}
        branches={branches}
        existingProjectNames={projectNames}
        onSave={handleSave}
        onCancel={() => { setFormOpen(false); setEditingId(null) }}
      />
    </div>
  )
}

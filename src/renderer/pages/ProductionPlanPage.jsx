// src/renderer/pages/ProductionPlanPage.jsx
import React, { useState } from 'react'
import { DatePicker, Select, Button, Space } from 'antd'
import dayjs from 'dayjs'
import DailyPlanPanel from '../components/DailyPlanPanel'
import CapacityConfigPanel from '../components/CapacityConfigPanel'
import ProjectDistancePanel from '../components/ProjectDistancePanel'

export default function ProductionPlanPage() {
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [branchId, setBranchId] = useState(null)
  const [branches, setBranches] = useState([])
  const [activePanel, setActivePanel] = useState('plans')

  React.useEffect(() => {
    window.electronAPI.invoke('capacity:getAll').then(res => {
      if (res.success) setBranches(res.data)
    })
  }, [])

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        {activePanel === 'plans' && (
          <>
            <DatePicker value={dayjs(date)} onChange={d => setDate(d.format('YYYY-MM-DD'))} />
            <Select
              placeholder="全部分公司"
              allowClear
              value={branchId}
              onChange={v => setBranchId(v)}
              style={{ width: 150 }}
            >
              {branches.map(b => <Select.Option key={b.id} value={b.id}>{b.branchName}</Select.Option>)}
            </Select>
          </>
        )}
      </Space>

      <Space style={{ marginBottom: 16 }}>
        <Button type={activePanel === 'plans' ? 'primary' : 'default'} onClick={() => setActivePanel('plans')}>每日计划</Button>
        <Button type={activePanel === 'capacity' ? 'primary' : 'default'} onClick={() => setActivePanel('capacity')}>产能配置</Button>
        <Button type={activePanel === 'distance' ? 'primary' : 'default'} onClick={() => setActivePanel('distance')}>距离配置</Button>
      </Space>

      {activePanel === 'plans' && <DailyPlanPanel date={date} branchId={branchId} />}
      {activePanel === 'capacity' && <CapacityConfigPanel />}
      {activePanel === 'distance' && <ProjectDistancePanel />}
    </div>
  )
}

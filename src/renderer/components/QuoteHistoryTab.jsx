import React, { useEffect, useState } from 'react'
import { Button, Table, Select, DatePicker, Space, Modal, message } from 'antd'
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons'
import extractErrorMessage from '../utils/extractErrorMessage'

const { RangePicker } = DatePicker

const money = (v) => (Number(v) || 0).toFixed(2)

const QuoteHistoryTab = () => {
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [strengthFilter, setStrengthFilter] = useState(null)
  const [typeFilter, setTypeFilter] = useState(null)
  const [dateRange, setDateRange] = useState(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailItem, setDetailItem] = useState(null)

  const load = async (pg = page, ps = pageSize) => {
    const filters = {}
    if (strengthFilter) filters.strengthGrade = strengthFilter
    if (typeFilter) filters.concreteType = typeFilter
    if (dateRange?.[0]) filters.startDate = dateRange[0].toISOString()
    if (dateRange?.[1]) filters.endDate = dateRange[1].toISOString()
    filters.page = pg
    filters.pageSize = ps
    const result = await window.electronAPI.invoke('salesQuote:listHistory', filters)
    if (result.success) {
      setData(result.data)
      setTotal(result.total)
    } else {
      message.error(extractErrorMessage(result.error, '加载失败'))
    }
  }

  useEffect(() => { load(page, pageSize) }, [])

  const handleDelete = async (id) => {
    if (!confirm('确认删除？')) return
    const result = await window.electronAPI.invoke('salesQuote:deleteQuote', id)
    if (result.success) { message.success('已删除'); load() }
    else message.error(extractErrorMessage(result.error))
  }

  const showDetail = (item) => {
    setDetailItem(item)
    setDetailVisible(true)
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select placeholder="强度等级" allowClear style={{ width: 100 }}
          value={strengthFilter} onChange={v => { setStrengthFilter(v); setPage(1); load(1, pageSize) }}>
          {['C20','C25','C30','C35','C40','C45','C50','C55','C60'].map(g =>
            <Select.Option key={g} value={g}>{g}</Select.Option>
          )}
        </Select>
        <Select placeholder="混凝土类型" allowClear style={{ width: 120 }}
          value={typeFilter} onChange={v => { setTypeFilter(v); setPage(1); load(1, pageSize) }}>
          {['普通','泵送','抗渗','早强','缓凝','大体积','高强'].map(t =>
            <Select.Option key={t} value={t}>{t}</Select.Option>
          )}
        </Select>
        <RangePicker onChange={v => { setDateRange(v); setPage(1); load(1, pageSize) }} />
      </Space>
      <Table
        rowKey="id" dataSource={data} size="small"
        pagination={{ current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); load(p, ps) } }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 160, render: v => v ? new Date(v).toLocaleString() : '' },
          { title: '模式', dataIndex: 'quoteMode', width: 90, render: v => {
            if (v === 'reverse') return '🔻 反向'
            if (v === 'forward') return '🔺 正向'
            return '旧版'
          } },
          { title: '强度', dataIndex: 'strengthGrade', width: 70 },
          { title: '类型', dataIndex: 'concreteType', width: 80 },
          { title: '价格(元/m³)', width: 200, render: (_, row) => {
            const mode = row.quoteMode
            if (mode === 'forward') {
              const min = money(row.resultSnapshot?.minPrice)
              const sug = money(row.resultSnapshot?.suggestedPrice)
              const max = money(row.resultSnapshot?.maxPrice)
              return `${min} / ${sug} / ${max}`
            }
            return money(row.resultSnapshot?.suggestedDealPrice)
          } },
          { title: '包装/设备', width: 100, render: (_, row) => {
            if (row.polishStrategy) return `📦 ${row.polishStrategy}`
            if (row.equipmentUnitAmortization) return `🔧 ${money(row.equipmentUnitAmortization)}/m³`
            return '-'
          } },
          {
            title: '操作', width: 140,
            render: (_, row) => (
              <Space>
                <Button size="small" icon={<EyeOutlined />} onClick={() => showDetail(row)}>详情</Button>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row.id)}>删除</Button>
              </Space>
            )
          }
        ]}
      />
      <Modal title="历史报价详情" open={detailVisible} onCancel={() => setDetailVisible(false)}
        footer={null} width={700} destroyOnClose>
        {detailItem && (
          <pre style={{ maxHeight: 500, overflow: 'auto', fontSize: 13, background: '#fafafa', padding: 12, borderRadius: 4 }}>
            {JSON.stringify(detailItem.resultSnapshot, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  )
}

export default QuoteHistoryTab

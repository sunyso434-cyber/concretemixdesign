import React, { useState, useEffect, useCallback } from 'react'
import { Table, Tag, Select, Space, message, Typography, Card } from 'antd'
import {
  ExperimentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import TrialRecordDetail from '../components/TrialRecordDetail'

const { Text } = Typography
const { Option } = Select

/**
 * TrialRecordsPage - 试配记录只读查看页
 *
 * IPC 通道：
 *   trialtest:list  →  { status? }  →  { success, records: TrialTestRecord[] }
 *   trialtest:get   →  { id }        →  { success, record: TrialTestRecord }
 */
const TrialRecordsPage = () => {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState(undefined) // undefined = 全部

  // 加载试配记录列表
  const loadRecords = useCallback(async (status) => {
    setLoading(true)
    try {
      const params = status ? { status } : {}
      const result = await window.electron.ipcRenderer.invoke('trialtest:list', params)
      if (result.success) {
        setRecords(result.records || [])
      } else {
        message.error(result.error || '加载试配记录失败')
      }
    } catch (error) {
      console.error('[TrialRecordsPage] 加载失败:', error)
      message.error('加载试配记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    loadRecords(statusFilter)
  }, [statusFilter, loadRecords])

  // 状态筛选变化
  const handleStatusChange = (value) => {
    // value 为 undefined 表示"全部"
    setStatusFilter(value === '__all__' ? undefined : value)
  }

  // 状态标签渲染
  const renderStatusTag = (status) => {
    switch (status) {
      case '已试配':
        return <Tag icon={<CheckCircleOutlined />} color="success">已试配</Tag>
      case '已复核':
        return <Tag icon={<SyncOutlined />} color="blue">已复核</Tag>
      case '驳回':
        return <Tag icon={<CloseCircleOutlined />} color="error">驳回</Tag>
      default:
        return <Tag>{status || '-'}</Tag>
    }
  }

  // 偏差率渲染（超 ±10% 红标）
  const renderDeviation = (deviation) => {
    if (!deviation || deviation.strengthDeviationPct === null || deviation.strengthDeviationPct === undefined) {
      return <Text type="secondary">-</Text>
    }
    const pct = deviation.strengthDeviationPct
    const absPct = Math.abs(pct)
    const color = absPct > 10 ? 'red' : absPct > 5 ? 'orange' : 'green'
    const prefix = pct > 0 ? '+' : ''
    return <Tag color={color}>{prefix}{pct.toFixed(1)}%</Tag>
  }

  // 关联方案渲染
  const renderMixDesignLink = (mixDesignId) => {
    if (!mixDesignId) {
      return <Text type="secondary">-</Text>
    }
    return (
      <Space>
        <LinkOutlined style={{ color: 'var(--color-primary)' }} />
        <a
          onClick={() => message.info(`关联方案 ID: ${mixDesignId}（跳转功能开发中）`)}
          style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
        >
          方案 #{mixDesignId}
        </a>
      </Space>
    )
  }

  // 表格列定义
  const columns = [
    {
      title: '试配日期',
      dataIndex: 'trialTestDate',
      key: 'trialTestDate',
      width: 130,
      sorter: (a, b) => new Date(a.trialTestDate || 0) - new Date(b.trialTestDate || 0),
      defaultSortOrder: 'descend',
      render: (date) => date ? new Date(date).toLocaleDateString() : '-',
    },
    {
      title: '水胶比',
      dataIndex: 'water_binder_ratio',
      key: 'water_binder_ratio',
      width: 90,
      render: (val) => val !== null && val !== undefined ? val.toFixed(2) : '-',
    },
    {
      title: '水泥用量 (kg/m³)',
      dataIndex: 'cement_amount',
      key: 'cement_amount',
      width: 130,
      render: (val) => val ?? '-',
    },
    {
      title: '实测强度 (MPa)',
      dataIndex: 'trialTestedStrength',
      key: 'trialTestedStrength',
      width: 120,
      render: (val) => val ?? '-',
    },
    {
      title: '实测坍落度 (mm)',
      dataIndex: 'trialTestedSlump',
      key: 'trialTestedSlump',
      width: 120,
      render: (val) => val ?? '-',
    },
    {
      title: '偏差率',
      key: 'deviation',
      width: 110,
      render: (_, record) => renderDeviation(record.deviationAnalysis),
    },
    {
      title: '试配状态',
      dataIndex: 'trialStatus',
      key: 'trialStatus',
      width: 110,
      render: (status) => renderStatusTag(status),
    },
    {
      title: '关联方案',
      key: 'mixDesignId',
      width: 120,
      render: (_, record) => renderMixDesignLink(record.mixDesignId),
    },
  ]

  // 统计卡片数据
  const totalRecords = records.length
  const testedCount = records.filter(r => r.trialStatus === '已试配').length
  const reviewedCount = records.filter(r => r.trialStatus === '已复核').length
  const rejectedCount = records.filter(r => r.trialStatus === '驳回').length
  const overDeviationCount = records.filter(r => {
    const d = r.deviationAnalysis
    return d && d.strengthDeviationPct !== null && d.strengthDeviationPct !== undefined && Math.abs(d.strengthDeviationPct) > 10
  }).length

  return (
    <div className="fade-in">
      <div className="page-container">
        {/* 统计卡片 */}
        <div className="mat-stats">
          <div className="mat-stat-card">
            <div className="mat-stat-icon blue"><ExperimentOutlined /></div>
            <div className="mat-stat-info">
              <div className="mat-stat-value">{totalRecords}</div>
              <div className="mat-stat-label">试配总数</div>
            </div>
          </div>
          <div className="mat-stat-card">
            <div className="mat-stat-icon green"><CheckCircleOutlined /></div>
            <div className="mat-stat-info">
              <div className="mat-stat-value">{testedCount}</div>
              <div className="mat-stat-label">已试配</div>
            </div>
          </div>
          <div className="mat-stat-card">
            <div className="mat-stat-icon" style={{ background: '#E8E0FF', color: '#4B3FE3' }}><SyncOutlined /></div>
            <div className="mat-stat-info">
              <div className="mat-stat-value">{reviewedCount}</div>
              <div className="mat-stat-label">已复核</div>
            </div>
          </div>
          <div className="mat-stat-card">
            <div className="mat-stat-icon" style={{ background: '#FFE8E8', color: '#FF3B30' }}><CloseCircleOutlined /></div>
            <div className="mat-stat-info">
              <div className="mat-stat-value">{rejectedCount}</div>
              <div className="mat-stat-label">驳回</div>
            </div>
          </div>
          <div className="mat-stat-card">
            <div className="mat-stat-icon" style={{ background: '#FFF3E0', color: '#FF9500' }}>
              <span style={{ fontWeight: 'bold' }}>!</span>
            </div>
            <div className="mat-stat-info">
              <div className="mat-stat-value">{overDeviationCount}</div>
              <div className="mat-stat-label">偏差异常</div>
            </div>
          </div>
        </div>

        {/* 筛选工具栏 */}
        <div className="custom-card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <Space>
            <span style={{ fontWeight: 500 }}>试配状态：</span>
            <Select
              style={{ width: 150 }}
              value={statusFilter || '__all__'}
              onChange={handleStatusChange}
            >
              <Option value="__all__">全部</Option>
              <Option value="已试配">已试配</Option>
              <Option value="已复核">已复核</Option>
              <Option value="驳回">驳回</Option>
            </Select>
          </Space>
        </div>

        {/* 表格 */}
        <div className="custom-card">
          <Table
            className="custom-table"
            dataSource={records.map(r => ({ ...r, key: r.id }))}
            columns={columns}
            loading={loading}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`,
            }}
            expandable={{
              expandedRowRender: (record) => <TrialRecordDetail record={record} />,
              rowExpandable: () => true,
            }}
            locale={{
              emptyText: '暂无试配记录',
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default TrialRecordsPage

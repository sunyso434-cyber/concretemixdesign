import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Card, Button, Table, Space, message, Modal, Form, Input, Select, Tag } from 'antd'
import { AppstoreOutlined, DollarOutlined, ThunderboltOutlined, ClockCircleOutlined } from '@ant-design/icons'
import extractErrorMessage from '../utils/extractErrorMessage'
import BasicMixTab from '../components/BasicMixTab'


const { Option } = Select

const SchemesPage = forwardRef((props, ref) => {
  const [schemes, setSchemes] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedSchemes, setSelectedSchemes] = useState([])
  const [showDrafts, setShowDrafts] = useState(false)
  const [statusFilter, setStatusFilter] = useState(null) // 外部导航过滤：null=全部
  const [viewMode, setViewMode] = useState('schemes') // 'schemes' | 'basicMix'
  const [viewModalVisible, setViewModalVisible] = useState(false)
  const [currentScheme, setCurrentScheme] = useState(null)
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editForm] = Form.useForm()

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    filterScheme: (type) => {
      // 基准方案：切换到 basicMix 视图
      if (type === '基准方案') {
        setViewMode('basicMix')
        return
      }
      // 其余分类：切回 schemes 视图并设置过滤
      setViewMode('schemes')
      if (type === '全部方案') {
        setShowDrafts(true)
        setStatusFilter(null)
      } else if (type === '正式方案') {
        setShowDrafts(false)
        setStatusFilter(null)
      } else if (type === '草稿方案') {
        setShowDrafts(true)
        setStatusFilter('草稿')
      } else if (type === '已对比') {
        setShowDrafts(true)
        setStatusFilter('已使用')
      }
    }
  }), [])

  // 加载方案列表
  const loadSchemes = async (options = {}) => {
    setLoading(true)
    try {
      console.log('开始加载方案列表...', options)
      const result = await window.electron.ipcRenderer.invoke('getAllMixDesigns', options)
      console.log('加载方案列表结果:', result)
      if (result.success) {
        console.log('获取到方案数量:', result.data.length)
        setSchemes(result.data)
      } else {
        console.error('加载方案失败:', result.error)
        message.error(extractErrorMessage(result.error))
      }
    } catch (error) {
      console.error('加载方案异常:', error)
      message.error('加载方案失败')
    } finally {
      setLoading(false)
    }
  }

  // 初始化加载 & showDrafts 变化时重新加载
  useEffect(() => {
    loadSchemes(showDrafts ? {} : { excludeDrafts: true })
    // 监听数据刷新事件（导入操作完成后）
    const handleDataRefresh = () => {
      try {
        loadSchemes(showDrafts ? {} : { excludeDrafts: true })
      } catch (err) {
        console.error('SchemesPage data refresh failed:', err)
      }
    }
    const listenerId = window.electron.ipcRenderer.on('data-refresh', handleDataRefresh)
    return () => {
      window.electron.ipcRenderer.removeListener(listenerId)
    }
  }, [showDrafts])

  // 查看方案详情
  const viewScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('getMixDesignById', id)
      if (result.success) {
        console.log('方案详情数据:', result.data)
        console.log('细骨料分配:', result.data.fineAggregateBreakdown)
        console.log('粗骨料分配:', result.data.coarseAggregateBreakdown)
        console.log('材料成本:', result.data.materialCosts)
        setCurrentScheme(result.data)
        setViewModalVisible(true)
      } else {
        message.error(extractErrorMessage(result.error))
      }
    } catch (error) {
      message.error('获取方案详情失败')
    }
  }

  // 编辑方案
  const editScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('getMixDesignById', id)
      if (result.success) {
        setCurrentScheme(result.data)
        editForm.setFieldsValue(result.data)
        setEditModalVisible(true)
      } else {
        message.error(extractErrorMessage(result.error))
      }
    } catch (error) {
      message.error('获取方案详情失败')
    }
  }

  // 删除方案
  const deleteScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('deleteMixDesign', id)
      if (result.success) {
        message.success('删除成功')
        loadSchemes(showDrafts ? {} : { excludeDrafts: true })
      } else {
        message.error(extractErrorMessage(result.error))
      }
    } catch (error) {
      message.error('删除失败')
    }
  }

  // 复制方案
  const copyScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('getMixDesignById', id)
      if (result.success) {
        const scheme = result.data
        const copyData = {
          ...scheme,
          id: undefined,
          name: `${scheme.name} (副本)`,
          createdAt: undefined,
          updatedAt: undefined
        }
        const createResult = await window.electron.ipcRenderer.invoke('createMixDesign', copyData)
        if (createResult.success) {
          message.success('复制成功')
          loadSchemes(showDrafts ? {} : { excludeDrafts: true })
        } else {
          message.error(extractErrorMessage(createResult.error))
        }
      } else {
        message.error(extractErrorMessage(result.error))
      }
    } catch (error) {
      message.error('复制失败')
    }
  }

  // 确认草稿方案
  const confirmScheme = async (id) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('updateMixDesign', { id, data: { status: '已确认' } })
      if (result.success) {
        message.success('方案已确认')
        loadSchemes(showDrafts ? {} : { excludeDrafts: true })
      } else {
        message.error(extractErrorMessage(result.error))
      }
    } catch (error) {
      message.error('确认失败')
    }
  }

  // 导出方案
  const exportScheme = (scheme) => {
    message.info('导出方案功能开发中')
  }

  // 保存编辑
  const saveEdit = async () => {
    try {
      const values = await editForm.validateFields()
      const result = await window.electron.ipcRenderer.invoke('updateMixDesign', {
        id: currentScheme.id,
        data: values
      })
      if (result.success) {
        message.success('更新成功')
        setEditModalVisible(false)
        loadSchemes(showDrafts ? {} : { excludeDrafts: true })
      } else {
        message.error(extractErrorMessage(result.error))
      }
    } catch (error) {
      message.error('保存失败')
    }
  }

  // 对比方案
  const compareSchemes = () => {
    if (selectedSchemes.length < 2) {
      message.warning('请选择至少两个方案进行对比')
      return
    }
    message.info('方案对比功能开发中')
  }

  // 处理方案选择
  const handleSchemeSelect = (selectedRowKeys) => {
    setSelectedSchemes(selectedRowKeys)
  }

  // 渲染状态标签
  const renderStatusTag = (status) => {
    switch (status) {
      case '草稿':
        return <Tag color="default">草稿</Tag>
      case '已确认':
        return <Tag color="blue">已确认</Tag>
      case '已验证':
        return <Tag color="green">已验证</Tag>
      case '未验证':
        return <Tag color="orange">未验证</Tag>
      case '已使用':
        return <Tag color="red">已使用</Tag>
      default:
        return <Tag>{status}</Tag>
    }
  }

  // 规范化总成本展示：当存在 stone_* 或 sand_* 明细时，忽略聚合键 stone/sand
  const computeNormalizedTotal = (materialCosts) => {
    if (!materialCosts) return null
    try {
      const hasSandDetail = Object.keys(materialCosts).some(k => k.startsWith('sand_'))
      const hasStoneDetail = Object.keys(materialCosts).some(k => k.startsWith('stone_'))
      let total = 0
      Object.entries(materialCosts).forEach(([k, v]) => {
        if (k === 'sand' && hasSandDetail) return
        if (k === 'stone' && hasStoneDetail) return
        total += v || 0
      })
      return total
    } catch (e) {
      console.error('规范化总成本失败:', e)
      return materialCosts && materialCosts.totalCost ? materialCosts.totalCost : null
    }
  }

  const columns = [
    {
      title: '方案名称',
      dataIndex: 'name',
      key: 'name',
      onHeaderCell: () => ({ scope: 'col' }),
      render: (text, record) => (
        <div>
          <p>{text}</p>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>项目: {record.projectName || '无'}</p>
        </div>
      )
    },
    {
      title: '强度等级',
      dataIndex: 'strength',
      key: 'strength',
      onHeaderCell: () => ({ scope: 'col' })
    },
    {
      title: '坍落度',
      dataIndex: 'slump',
      key: 'slump',
      onHeaderCell: () => ({ scope: 'col' }),
      render: (slump) => slump !== null && slump !== undefined ? `${slump}mm` : '未设置'
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      onHeaderCell: () => ({ scope: 'col' }),
      render: (date) => date ? new Date(date).toLocaleDateString() : '未知'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      onHeaderCell: () => ({ scope: 'col' }),
      render: (status) => renderStatusTag(status)
    },
    {
      title: '操作',
      key: 'action',
      onHeaderCell: () => ({ scope: 'col' }),
      render: (_, record) => (
        <Space size="middle">
          {record.status === '草稿' && (
            <Button size="small" type="primary" onClick={() => confirmScheme(record.id)}>确认</Button>
          )}
          <Button size="small" onClick={() => viewScheme(record.id)}>查看</Button>
          <Button size="small" onClick={() => editScheme(record.id)}>编辑</Button>
          <Button size="small" onClick={() => copyScheme(record.id)}>复制</Button>
          <Button size="small" danger onClick={() => deleteScheme(record.id)}>删除</Button>
          <Button size="small" onClick={() => exportScheme(record)}>导出</Button>
        </Space>
      )
    }
  ]

  const rowSelection = {
    onChange: handleSchemeSelect
  }

  // 应用 statusFilter 前端过滤
  const filteredSchemes = statusFilter
    ? schemes.filter(s => s.status === statusFilter)
    : schemes

  // 统计卡片数据
  const totalSchemes = filteredSchemes.length
  const costValues = filteredSchemes.map(s => {
    const costs = s.materialCosts || {}
    // 复用规范化总成本计算
    const hasSandDetail = Object.keys(costs).some(k => k.startsWith('sand_'))
    const hasStoneDetail = Object.keys(costs).some(k => k.startsWith('stone_'))
    let total = 0
    Object.entries(costs).forEach(([k, v]) => {
      if (k === 'sand' && hasSandDetail) return
      if (k === 'stone' && hasStoneDetail) return
      if (k === 'totalCost') return
      total += v || 0
    })
    return total
  }).filter(c => !isNaN(c) && c > 0)
  const avgCost = costValues.length ? (costValues.reduce((s, c) => s + c, 0) / costValues.length).toFixed(1) : '0.0'
  const strengthNums = filteredSchemes.map(s => parseInt(String(s.strength || '').replace('C', '')) || 0).filter(n => n > 0)
  const maxStrength = strengthNums.length ? 'C' + Math.max(...strengthNums) : '--'
  const dateList = filteredSchemes.map(s => s.createdAt).filter(Boolean).sort()
  const latestDate = dateList.length ? new Date(dateList[dateList.length - 1]).toLocaleDateString() : '--'

  return (
    <div className="fade-in">
      <div className="page-container">
      </div>

      {/* 统计卡片（两种视图都保留） */}
      <div className="mat-stats">
        <div className="mat-stat-card">
          <div className="mat-stat-icon blue"><AppstoreOutlined /></div>
          <div className="mat-stat-info">
            <div className="mat-stat-value">{totalSchemes}</div>
            <div className="mat-stat-label">方案总数</div>
          </div>
        </div>
        <div className="mat-stat-card">
          <div className="mat-stat-icon green"><DollarOutlined /></div>
          <div className="mat-stat-info">
            <div className="mat-stat-value">{avgCost}</div>
            <div className="mat-stat-label">平均成本 (元/m³)</div>
          </div>
        </div>
        <div className="mat-stat-card">
          <div className="mat-stat-icon amber"><ThunderboltOutlined /></div>
          <div className="mat-stat-info">
            <div className="mat-stat-value">{maxStrength}</div>
            <div className="mat-stat-label">最高强度</div>
          </div>
        </div>
        <div className="mat-stat-card">
          <div className="mat-stat-icon purple"><ClockCircleOutlined /></div>
          <div className="mat-stat-info">
            <div className="mat-stat-value">{latestDate}</div>
            <div className="mat-stat-label">最近更新</div>
          </div>
        </div>
      </div>

      {viewMode === 'basicMix' ? (
        /* 基准方案视图 */
        <div className="custom-card">
          <BasicMixTab />
        </div>
      ) : (
        /* 普通方案视图 */
        <>
          <div className="custom-card">
            <Table
              className="custom-table"
              dataSource={filteredSchemes.map(s => ({ ...s, key: s.id }))}
              columns={columns}
              loading={loading}
              rowSelection={rowSelection}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 条记录`
              }}
            />
          </div>

          <div className="mt-lg">
            <div className="custom-card">
              <div className="selected-schemes-bar">
                <p>已选择 <strong>{selectedSchemes.length}</strong> 个方案</p>
              </div>
              <Button 
                type="primary" 
                className="custom-btn"
                onClick={compareSchemes} 
                disabled={selectedSchemes.length < 2}
              >
                对比选中方案
              </Button>
            </div>
          </div>
        </>
      )}

      {/* 查看方案模态框 */}
      <Modal
        className="custom-modal"
        title="方案详情"
        open={viewModalVisible}
        onCancel={() => setViewModalVisible(false)}
        footer={[
          <Button key="close" className="custom-btn" onClick={() => setViewModalVisible(false)}>关闭</Button>
        ]}
        width={800}
      >
        {currentScheme && (
          <div>
            <h3 className="scheme-detail-title">{currentScheme.name}</h3>
            <p className="scheme-detail-subtitle">项目名称: {currentScheme.projectName || '无'}</p>

            <div className="scheme-detail-grid">
              <div className="scheme-detail-card">
                <h4 className="scheme-detail-card-title">基本信息</h4>
                <div className="scheme-detail-card-content">
                  <p>强度等级: <strong>{currentScheme.strength}</strong></p>
                  <p>坍落度: <strong>{currentScheme.slump !== null && currentScheme.slump !== undefined ? `${currentScheme.slump}mm` : '未设置'}</strong></p>
                  <p>环境类别: <strong>{currentScheme.environment}</strong></p>
                  <p>水胶比: <strong>{currentScheme.waterRatio?.toFixed(2)}</strong></p>
                  <p>砂率: <strong>{(currentScheme.sandRatio * 100)?.toFixed(1)}%</strong></p>
                  <p>容重: <strong>{currentScheme.density?.toFixed(1)} kg/m³</strong></p>
                  <p>状态: <strong>{renderStatusTag(currentScheme.status)}</strong></p>
                </div>
              </div>
              <div className="scheme-detail-card">
                <h4 className="scheme-detail-card-title">材料用量</h4>
                {currentScheme.materials && (() => {
                  const mats = currentScheme.materials || {}
                  const fine = currentScheme.fineAggregateBreakdown || []
                  const coarse = currentScheme.coarseAggregateBreakdown || []
                  const items = []

                  // 按顺序：用水量 → 水泥 → 掺合料 → 细骨料 → 粗骨料 → 外加剂
                  if (mats.water !== undefined) items.push({ key: 'water', label: '用水量', amount: mats.water })
                  if (mats.cement !== undefined) items.push({ key: 'cement', label: '水泥', amount: mats.cement })
                  if (mats.flyAsh !== undefined) items.push({ key: 'flyAsh', label: '粉煤灰', amount: mats.flyAsh })
                  if (mats.slag !== undefined) items.push({ key: 'slag', label: '矿渣粉', amount: mats.slag })

                  // 细骨料：优先使用 breakdown 明细显示为 砂_材料名，若无则显示聚合的 砂
                  if (Array.isArray(fine) && fine.length > 0) {
                    fine.forEach(f => {
                      items.push({ key: `砂_${f.name}`, label: `砂_${f.name}`, amount: f.amount })
                    })
                  } else if (mats.sand !== undefined) {
                    items.push({ key: 'sand', label: '砂', amount: mats.sand })
                  }

                  // 粗骨料：同上，优先使用 breakdown 明细显示为 石_材料名
                  if (Array.isArray(coarse) && coarse.length > 0) {
                    coarse.forEach(c => {
                      items.push({ key: `石_${c.name}`, label: `石_${c.name}`, amount: c.amount })
                    })
                  } else if (mats.stone !== undefined) {
                    items.push({ key: 'stone', label: '石', amount: mats.stone })
                  }

                  if (mats.superplasticizer !== undefined) items.push({ key: 'superplasticizer', label: '减水剂', amount: mats.superplasticizer })

                  return (
                    <ul className="scheme-detail-materials-list">
                      {items.map(item => (
                        <li key={item.key} className="scheme-detail-item">
                          <span>{item.label}:</span>
                          <span><strong>{typeof item.amount === 'number' ? item.amount.toFixed(1) : 'N/A'} kg/m³</strong></span>
                        </li>
                      ))}
                    </ul>
                  )
                })()}

                {currentScheme.fineAggregateBreakdown && currentScheme.fineAggregateBreakdown.length > 0 && (
                  <div className="scheme-detail-section">
                    <h5 className="scheme-detail-section-title">细骨料详细分配</h5>
                    <ul className="scheme-detail-small-list">
                      {currentScheme.fineAggregateBreakdown.map((item) => (
                        <li key={item.id}>
                          <span>{item.name} ({(item.ratio * 100).toFixed(1)}%):</span>
                          <span><strong>{item.amount.toFixed(1)} kg/m³</strong></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {currentScheme.coarseAggregateBreakdown && currentScheme.coarseAggregateBreakdown.length > 0 && (
                  <div className="scheme-detail-section">
                    <h5 className="scheme-detail-section-title">粗骨料详细分配</h5>
                    <ul className="scheme-detail-small-list">
                      {currentScheme.coarseAggregateBreakdown.map((item) => (
                        <li key={item.id}>
                          <span>{item.name} ({(item.ratio * 100).toFixed(1)}%):</span>
                          <span><strong>{item.amount.toFixed(1)} kg/m³</strong></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {currentScheme.materialDetails && (() => {
              const details = currentScheme.materialDetails || {}
              const blocks = []

              if (details.cement) blocks.push({ key: 'cement', title: '水泥', material: details.cement })
              if (details.flyAsh) blocks.push({ key: 'flyAsh', title: '粉煤灰', material: details.flyAsh })
              if (details.slag) blocks.push({ key: 'slag', title: '矿渣粉', material: details.slag })

              // 细骨料：若为数组，逐项展示；否则展示单个细骨料
              if (Array.isArray(details.sand)) {
                details.sand.forEach(s => blocks.push({ key: `sand_${s.id}`, title: `砂 - ${s.name}`, material: s }))
              } else if (details.sand) {
                blocks.push({ key: 'sand', title: '细骨料', material: details.sand })
              }

              if (Array.isArray(details.stone)) {
                details.stone.forEach(s => blocks.push({ key: `stone_${s.id}`, title: `石 - ${s.name}`, material: s }))
              } else if (details.stone) {
                blocks.push({ key: 'stone', title: '粗骨料', material: details.stone })
              }

              if (details.superplasticizer) blocks.push({ key: 'superplasticizer', title: '外加剂', material: details.superplasticizer })

              return (
                <div className="scheme-info-block">
                  <h4 className="scheme-info-block-title">原材料信息</h4>
                  <div className="scheme-info-block-grid">
                    {blocks.map(b => (
                      b.material && (
                        <div key={b.key} className="scheme-info-item">
                          <p className="scheme-info-item-title">{b.title}</p>
                          <p className="scheme-info-item-detail">名称: {b.material.name || 'N/A'}</p>
                          <p className="scheme-info-item-detail">规格: {b.material.specification || 'N/A'}</p>
                          <p className="scheme-info-item-detail">单价: {b.material.price ? `¥${b.material.price}/吨` : 'N/A'}</p>
                          <p className="scheme-info-item-detail">厂家: {b.material.manufacturer || 'N/A'}</p>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )
            })()}

            {currentScheme.materialCosts && (() => {
              const costs = currentScheme.materialCosts || {}
              const details = currentScheme.materialDetails || {}
              const fine = currentScheme.fineAggregateBreakdown || []
              const coarse = currentScheme.coarseAggregateBreakdown || []
              const entries = []

              if (costs.water !== undefined) entries.push({ key: 'water', label: '水', cost: costs.water })
              if (costs.cement !== undefined) entries.push({ key: 'cement', label: '水泥', cost: costs.cement, price: details.cement?.price })
              if (costs.flyAsh !== undefined) entries.push({ key: 'flyAsh', label: '粉煤灰', cost: costs.flyAsh, price: details.flyAsh?.price, materialName: details.flyAsh?.name })
              if (costs.slag !== undefined) entries.push({ key: 'slag', label: '矿渣粉', cost: costs.slag, price: details.slag?.price, materialName: details.slag?.name })

              if (Array.isArray(fine) && fine.length > 0) {
                fine.forEach(f => {
                  const key = `sand_${f.id}`
                  entries.push({ key, label: `砂_${f.name}`, cost: costs[key] })
                })
              } else if (costs.sand !== undefined) {
                entries.push({ key: 'sand', label: '细骨料', cost: costs.sand, price: details.sand?.price })
              }

              if (Array.isArray(coarse) && coarse.length > 0) {
                coarse.forEach(c => {
                  const key = `stone_${c.id}`
                  entries.push({ key, label: `石_${c.name}`, cost: costs[key] })
                })
              } else if (costs.stone !== undefined) {
                entries.push({ key: 'stone', label: '粗骨料', cost: costs.stone, price: details.stone?.price })
              }

              if (costs.superplasticizer !== undefined) entries.push({ key: 'superplasticizer', label: '外加剂', cost: costs.superplasticizer })

              const displayedTotal = computeNormalizedTotal(costs)

              return (
                <div className="scheme-info-block">
                  <h4 className="scheme-info-block-title">成本信息</h4>
                  <div className="scheme-info-block-grid">
                    {entries.map(e => (
                      <div key={e.key} className="scheme-cost-item">
                        <p className="scheme-cost-item-title">
                          {e.materialName ? `${e.label} (${e.materialName})` : e.label}
                        </p>
                        {e.price ? (
                          <p className="scheme-info-item-detail">单价: <strong>{e.price} 元/吨</strong></p>
                        ) : null}
                        <p className="scheme-info-item-detail">成本: <strong>{typeof e.cost === 'number' ? e.cost.toFixed(2) : 'N/A'} 元/m³</strong></p>
                      </div>
                    ))}
                  </div>
                  {displayedTotal !== null && (
                    <div className="scheme-cost-total">
                      <p className="text-right font-semibold">总成本: <strong style={{ color: 'var(--color-primary)' }}>{(displayedTotal || 0).toFixed(2)} 元/m³</strong></p>
                    </div>
                  )}
                </div>
              )
            })()}

            {currentScheme.description && (
              <div className="scheme-info-block">
                <h4 className="scheme-info-block-title">描述</h4>
                <p>{currentScheme.description}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 编辑方案模态框 */}
      <Modal
        className="custom-modal"
        title="编辑方案"
        open={editModalVisible}
        onOk={saveEdit}
        onCancel={() => setEditModalVisible(false)}
        width={600}
      >
        <Form className="custom-form" form={editForm} layout="vertical">
          <Form.Item name="name" label="方案名称" rules={[{ required: true, message: '请输入方案名称' }]}>
            <Input placeholder="请输入方案名称" />
          </Form.Item>
          <Form.Item name="projectName" label="项目名称">
            <Input placeholder="请输入项目名称" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select placeholder="请选择状态">
              <Option value="未验证">未验证</Option>
              <Option value="已验证">已验证</Option>
              <Option value="已使用">已使用</Option>
            </Select>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入描述" rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
})

export default SchemesPage

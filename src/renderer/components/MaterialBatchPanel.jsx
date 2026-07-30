import React, { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, DatePicker, Select, Tag, Space, message, Empty, Divider, Typography, Tooltip } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { Text } = Typography

// 按材料类型返回检测数据字段组
const getTestFields = (materialType) => {
  // 通用字段
  const common = [
    { name: 'testDate', label: '检测日期', type: 'date' },
    { name: 'testReportNo', label: '检测报告编号', type: 'text' },
    { name: 'density', label: '密度 (g/cm³)', type: 'number' },
    { name: 'fineness', label: '细度', type: 'number' },
    { name: 'waterContent', label: '含水率 (%)', type: 'number' },
    { name: 'price', label: '单价 (元/吨)', type: 'number' },
  ]

  const cement = [
    { name: 'specificSurfaceArea', label: '比表面积 (m²/kg)', type: 'number' },
    { name: 'standardConsistency', label: '标准稠度 (%)', type: 'number' },
    { name: 'stability', label: '安定性', type: 'text' },
    { name: 'initialSettingTime', label: '初凝时间 (min)', type: 'number' },
    { name: 'finalSettingTime', label: '终凝时间 (min)', type: 'number' },
    { name: 'flexuralStrength3d', label: '3d 抗折强度 (MPa)', type: 'number' },
    { name: 'flexuralStrength28d', label: '28d 抗折强度 (MPa)', type: 'number' },
    { name: 'compressiveStrength3d', label: '3d 抗压强度 (MPa)', type: 'number' },
    { name: 'compressiveStrength28d', label: '28d 抗压强度 (MPa)', type: 'number' },
    { name: 'cementHeat3d', label: '3d 水化热 (kJ/kg)', type: 'number' },
    { name: 'cementHeat7d', label: '7d 水化热 (kJ/kg)', type: 'number' },
  ]

  const admixture = [
    { name: 'waterDemandRatio', label: '需水量比 (%)', type: 'number' },
    { name: 'lossOnIgnition', label: '烧失量 (%)', type: 'number' },
    { name: 'activityIndex7d', label: '7d 活性指数 (%)', type: 'number' },
    { name: 'activityIndex28d', label: '28d 活性指数 (%)', type: 'number' },
    { name: 'fluidityRatio', label: '流动度比 (%)', type: 'number' },
    { name: 'influenceFactor_10', label: '10% 影响因子', type: 'number' },
    { name: 'influenceFactor_20', label: '20% 影响因子', type: 'number' },
    { name: 'influenceFactor_30', label: '30% 影响因子', type: 'number' },
    { name: 'influenceFactor_40', label: '40% 影响因子', type: 'number' },
    { name: 'influenceFactor_50', label: '50% 影响因子', type: 'number' },
  ]

  const fineAggregate = [
    { name: 'mudContent', label: '含泥量 (%)', type: 'number' },
    { name: 'clayLumpContent', label: '泥块含量 (%)', type: 'number' },
    { name: 'mbValue', label: 'MB 值', type: 'number' },
    { name: 'finenessModulus', label: '细度模数', type: 'number' },
    { name: 'sieve_4_75', label: '4.75mm 筛余 (%)', type: 'number' },
    { name: 'sieve_2_36', label: '2.36mm 筛余 (%)', type: 'number' },
    { name: 'sieve_1_18', label: '1.18mm 筛余 (%)', type: 'number' },
    { name: 'sieve_0_60', label: '0.60mm 筛余 (%)', type: 'number' },
    { name: 'sieve_0_30', label: '0.30mm 筛余 (%)', type: 'number' },
    { name: 'sieve_0_15', label: '0.15mm 筛余 (%)', type: 'number' },
  ]

  const coarseAggregate = [
    { name: 'needleFlakeContent', label: '针片状含量 (%)', type: 'number' },
    { name: 'crushingValue', label: '压碎指标 (%)', type: 'number' },
    { name: 'grading', label: '级配', type: 'text' },
    { name: 'sieve_37_5', label: '37.5mm 筛余 (%)', type: 'number' },
    { name: 'sieve_31_5', label: '31.5mm 筛余 (%)', type: 'number' },
    { name: 'sieve_26_5', label: '26.5mm 筛余 (%)', type: 'number' },
    { name: 'sieve_19_0', label: '19.0mm 筛余 (%)', type: 'number' },
    { name: 'sieve_16_0', label: '16.0mm 筛余 (%)', type: 'number' },
    { name: 'sieve_9_50', label: '9.5mm 筛余 (%)', type: 'number' },
  ]

  const chemicalAdmixture = [
    { name: 'solidContent', label: '含固量 (%)', type: 'number' },
    { name: 'waterReducingRate', label: '减水率 (%)', type: 'number' },
    { name: 'airContent', label: '含气量 (%)', type: 'number' },
    { name: 'recommendedDosage', label: '推荐掺量 (%)', type: 'number' },
    { name: 'waterReducingRatePer01Dosage', label: '每 0.1% 掺量减水率 (%)', type: 'number' },
  ]

  const water = [
    { name: 'phValue', label: 'pH 值', type: 'number' },
    { name: 'insolubleMatter', label: '不溶物 (mg/L)', type: 'number' },
    { name: 'solubleMatter', label: '可溶物 (mg/L)', type: 'number' },
  ]

  // 按材料类型组装结果
  const groups = [{ title: '通用检测', fields: common }]

  switch (materialType) {
    case '水泥':
      groups.push({ title: '水泥检测', fields: cement })
      break
    case '粉煤灰':
    case '矿渣粉':
    case '锂渣':
    case '复合粉':
      groups.push({ title: '掺合料检测', fields: admixture })
      break
    case '细骨料':
      groups.push({ title: '细骨料检测', fields: fineAggregate })
      break
    case '粗骨料':
      groups.push({ title: '粗骨料检测', fields: coarseAggregate })
      break
    case '减水剂':
      groups.push({ title: '外加剂检测', fields: chemicalAdmixture })
      break
    case '水':
      groups.push({ title: '水检测', fields: water })
      break
  }

  return groups
}

// 各类材料过期规则，与服务端保持一致
const EXPIRY_RULES = {
  '水泥': { months: 3, field: 'productionDate' },
  '粉煤灰': { months: 6, field: 'productionDate' },
  '矿渣粉': { months: 6, field: 'productionDate' },
  '锂渣': { months: 6, field: 'productionDate' },
  '复合粉': { months: 6, field: 'productionDate' },
  '减水剂': { months: 6, field: 'expiryDate' },
  '细骨料': { days: 30, field: 'receiptDate' },
  '粗骨料': { days: 30, field: 'receiptDate' }
}

const isExpired = (batch, materialType) => {
  const rule = EXPIRY_RULES[materialType]
  if (!rule) return false
  const dateField = batch[rule.field]
  if (!dateField) return false
  const d = new Date(dateField)
  if (rule.months) d.setMonth(d.getMonth() + rule.months)
  if (rule.days) d.setDate(d.getDate() + rule.days)
  return new Date() > d
}

function MaterialBatchPanel({ materialId, materialType, onBatchChange }) {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingBatch, setEditingBatch] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const loadBatches = async () => {
    setLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('material:getBatches', { materialId })
      // 后端返回 { success, data }，必须取 data 并校验为数组，否则把对象塞给 antd Table 会触发白屏
      setBatches(result?.success && Array.isArray(result.data) ? result.data : [])
    } catch (err) {
      console.error('加载批次失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (materialId) {
      loadBatches()
    }
  }, [materialId])

  const openAddModal = () => {
    setEditingBatch(null)
    form.resetFields()
    setModalVisible(true)
  }

  const openEditModal = (batch) => {
    setEditingBatch(batch)
    const formValues = { ...batch }
    // 将日期字符串转为 dayjs 对象供 DatePicker 使用
    ;['productionDate', 'receiptDate', 'expiryDate', 'testDate'].forEach(key => {
      if (batch[key]) formValues[key] = dayjs(batch[key])
    })
    form.setFieldsValue(formValues)
    setModalVisible(true)
  }

  const handleDelete = (id) => {
    Modal.confirm({
      title: '删除确认',
      content: '确定要删除该批次吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.ipcRenderer.invoke('material:deleteBatch', { id })
          message.success('批次已删除')
          loadBatches()
          onBatchChange?.()
        } catch (err) {
          message.error('删除失败')
        }
      }
    })
  }

  const handleSetCurrent = async (batchId) => {
    try {
      await window.electron.ipcRenderer.invoke('material:setCurrentBatch', { materialId, batchId })
      message.success('已设为当前批次')
      loadBatches()
      onBatchChange?.()
    } catch (err) {
      message.error('设置失败')
    }
  }

  const handleSave = async (values) => {
    setSaving(true)
    try {
      // 将 dayjs 对象转为 ISO 字符串
      const dateFields = ['productionDate', 'receiptDate', 'expiryDate', 'testDate']
      const data = {}
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined || value === '') continue // 跳过空值，让模型默认值生效
        if (dateFields.includes(key) && value) {
          data[key] = value.toISOString()
        } else {
          data[key] = value
        }
      }

      let result
      if (editingBatch) {
        result = await window.electron.ipcRenderer.invoke('material:updateBatch', { id: editingBatch.id, ...data })
        if (result && result.success) {
          message.success('批次已更新')
        } else {
          throw new Error(result?.error || '更新失败')
        }
      } else {
        result = await window.electron.ipcRenderer.invoke('material:createBatch', { materialId, materialType, ...data })
        if (result && result.success) {
          message.success('批次已添加')
        } else {
          throw new Error(result?.error || '添加失败')
        }
      }
      setModalVisible(false)
      form.resetFields()
      loadBatches()
      onBatchChange?.()
    } catch (err) {
      console.error('批次保存失败:', err)
      message.error(err.message || (editingBatch ? '更新失败' : '添加失败'))
    } finally {
      setSaving(false)
    }
  }

  // 根据材料类型获取对应的日期字段配置
  const getDateFieldConfig = () => {
    const rule = EXPIRY_RULES[materialType]
    if (!rule) return null
    switch (rule.field) {
      case 'productionDate': return { name: 'productionDate', label: '生产日期' }
      case 'receiptDate': return { name: 'receiptDate', label: '进场日期' }
      case 'expiryDate': return { name: 'expiryDate', label: '有效期至' }
      default: return null
    }
  }

  const dateField = getDateFieldConfig()

  const columns = [
    {
      title: '批次号',
      dataIndex: 'batchNumber',
      key: 'batchNumber',
      width: 150
    },
    {
      title: '数量(吨)',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      render: (v) => (v != null ? v : '-')
    },
    {
      title: '供应商',
      dataIndex: 'supplier',
      key: 'supplier',
      width: 120,
      render: (v) => v || '-'
    },
    {
      title: dateField?.label || '日期',
      dataIndex: dateField?.name || 'productionDate',
      key: 'date',
      width: 120,
      render: (v) => (v ? new Date(v).toLocaleDateString('zh-CN') : '-')
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status, record) => {
        if (isExpired(record, materialType)) return <Tag color="red">已过期</Tag>
        const colorMap = { '在用': 'blue', '备用': 'orange' }
        return <Tag color={colorMap[status] || 'default'}>{status || '正常'}</Tag>
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="设为当前批次">
            <Button
              type="primary"
              size="small"
              shape="circle"
              icon={<CheckCircleOutlined />}
              onClick={() => handleSetCurrent(record.id)}
            />
          </Tooltip>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          />
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
        </Space>
      )
    }
  ]

  return (
    <div style={{ padding: '12px 16px 4px' }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500 }}>批次管理</span>
        <Tooltip title="新增批次">
          <Button type="primary" size="small" shape="circle" icon={<PlusOutlined />} onClick={openAddModal} />
        </Tooltip>
      </div>

      <Table
        dataSource={batches}
        columns={columns}
        loading={loading}
        rowKey="id"
        size="small"
        locale={{
          emptyText: <Empty description="该材料暂无批次，请添加" />
        }}
        pagination={batches.length > 10 ? { pageSize: 10, showTotal: (total) => `共 ${total} 条` } : false}
      />

      <Modal
        title={editingBatch ? '编辑批次' : '新增批次'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalVisible(false)
          form.resetFields()
        }}
        confirmLoading={saving}
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="batchNumber"
            label="批次号"
            rules={[{ required: true, message: '请输入批次号' }]}
          >
            <Input placeholder="例如：2026-07-001" />
          </Form.Item>

          {dateField && (
            <Form.Item
              name={dateField.name}
              label={dateField.label}
              rules={[{ required: true, message: `请选择${dateField.label}` }]}
            >
              <DatePicker style={{ width: '100%' }} placeholder={`选择${dateField.label}`} />
            </Form.Item>
          )}

          <Form.Item name="quantity" label="数量 (吨)">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="输入数量" />
          </Form.Item>

          <Form.Item name="supplier" label="供应商">
            <Input placeholder="输入供应商名称" />
          </Form.Item>

          <Form.Item name="status" label="状态" initialValue="正常">
            <Select
              options={[
                { label: '正常', value: '正常' },
                { label: '在用', value: '在用' },
                { label: '备用', value: '备用' }
              ]}
            />
          </Form.Item>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息" />
          </Form.Item>

          {/* 检测数据字段 — 按材料类型动态渲染 */}
          {getTestFields(materialType).map((group, gi) => (
            <React.Fragment key={group.title}>
              <Divider plain style={{ margin: '16px 0 8px' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{group.title}</Text>
              </Divider>
              {group.fields.map((field) => (
                <Form.Item key={field.name} name={field.name} label={field.label}>
                  {field.type === 'date' ? (
                    <DatePicker style={{ width: '100%' }} placeholder={`选择${field.label}`} />
                  ) : field.type === 'number' ? (
                    <InputNumber style={{ width: '100%' }} placeholder={field.label} />
                  ) : (
                    <Input placeholder={field.label} />
                  )}
                </Form.Item>
              ))}
            </React.Fragment>
          ))}
        </Form>
      </Modal>
    </div>
  )
}

export default MaterialBatchPanel

import React, { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Select, Space, message, Row, Col, Divider, Tabs } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { getFieldsForType, calculateFinenessModulus, autoMatchGrading } from '../utils/materialFieldsConfig'

const MATERIAL_TYPES = ['水泥', '粉煤灰', '矿渣粉', '锂渣', '复合粉', '细骨料', '粗骨料', '减水剂', '其他']

const MaterialsPage = () => {
  const [form] = Form.useForm()
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [selectedType, setSelectedType] = useState(null)

  const loadMaterials = async () => {
    setLoading(true)
    try {
      const result = await window.electron.ipcRenderer.invoke('getAllMaterials')
      if (result && result.success) {
        setMaterials(result.data || [])
      } else {
        message.error(result?.error || '加载材料失败')
      }
    } catch (error) {
      message.error(`材料加载异常: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMaterials()
    // 监听数据刷新事件（导入操作完成后）
    const handleDataRefresh = () => {
      try {
        loadMaterials()
      } catch (err) {
        console.error('MaterialsPage data refresh failed:', err)
      }
    }
    window.electron.ipcRenderer.on('data-refresh', handleDataRefresh)
    return () => {
      window.electron.ipcRenderer.removeListener('data-refresh', handleDataRefresh)
    }
  }, [])

  const handleAddNew = () => {
    form.resetFields()
    setEditingId(null)
    setSelectedType(null)
    setModalVisible(true)
  }

  const handleEdit = (record) => {
    setEditingId(record.id)
    setSelectedType(record.type)
    form.setFieldsValue(record)
    setModalVisible(true)
  }

  const handleDelete = (id) => {
    Modal.confirm({
      title: '删除确认',
      content: '确定要删除这条材料记录吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await window.electron.ipcRenderer.invoke('deleteMaterial', id)
          if (result.success) {
            message.success('材料已删除')
            loadMaterials()
          } else {
            message.error(result.error || '删除失败')
          }
        } catch (error) {
          message.error(`删除异常: ${error.message}`)
        }
      }
    })
  }

  const handleTypeChange = (type) => {
    setSelectedType(type)
    // 清空之前类型的数据
    const fieldsConfig = getFieldsForType(type)
    const currentValues = form.getFieldsValue()
    const newValues = { ...currentValues, type }

    // 只保留基础字段和该类型的字段
    const allFieldNames = fieldsConfig.optional.map(f => f.name)
    for (const key in newValues) {
      if (!['name', 'type', 'specification', 'manufacturer'].includes(key) && !allFieldNames.includes(key)) {
        delete newValues[key]
      }
    }
    form.setFieldsValue(newValues)
  }

  const handleSave = async (values) => {
    // 自动计算细度模数
    if (values.type === '细骨料' && (values.sieve_4_75 || values.sieve_2_36 || values.sieve_1_18 || values.sieve_0_60 || values.sieve_0_30 || values.sieve_0_15)) {
      values.finenessModulus = calculateFinenessModulus(values)
    }

    // 自动匹配粗骨料级配
    if (values.type === '粗骨料' && (values.sieve_37_5 || values.sieve_31_5 || values.sieve_26_5 || values.sieve_19_0 || values.sieve_16_0 || values.sieve_9_50 || values.sieve_4_75 || values.sieve_2_36)) {
      values.grading = autoMatchGrading(values)
    }

    setSaving(true)
    try {
      let result
      if (editingId) {
        result = await window.electron.ipcRenderer.invoke('updateMaterial', {
          id: editingId,
          data: values
        })
      } else {
        result = await window.electron.ipcRenderer.invoke('createMaterial', values)
      }

      if (result.success) {
        message.success(editingId ? '材料已更新' : '材料已添加')
        setModalVisible(false)
        form.resetFields()
        setSelectedType(null)
        loadMaterials()
      } else {
        message.error(result.error || '操作失败')
      }
    } catch (error) {
      message.error(`操作异常: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const renderFormFields = () => {
    if (!selectedType) {
      return (
        <Form.Item name="type" label="材料类型" rules={[{ required: true, message: '请选择材料类型' }]}>
          <Select
            placeholder="选择材料类型后将显示对应表单字段"
            options={MATERIAL_TYPES.map(t => ({ label: t, value: t }))}
            onChange={handleTypeChange}
          />
        </Form.Item>
      )
    }

    const fieldsConfig = getFieldsForType(selectedType)

    return (
      <>
        <Form.Item name="type" label="材料类型">
          <Select
            options={MATERIAL_TYPES.map(t => ({ label: t, value: t }))}
            onChange={handleTypeChange}
          />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="name" label="材料名称" rules={[{ required: true, message: '请输入材料名称' }]}>
              <Input placeholder="例如：P.O 42.5R水泥" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="price" label="单价 (元/吨)" rules={[{ required: true, message: '请输入单价' }]}>
              <InputNumber placeholder="请输入单价" min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="specification" label="规格">
              <Input placeholder="例如：42.5R" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="manufacturer" label="生产厂家">
              <Input placeholder="例如：都江堰拉法基水泥有限公司" />
            </Form.Item>
          </Col>
        </Row>

        {fieldsConfig.optional.length > 0 && (
          <>
            <Divider>具体参数</Divider>
            {fieldsConfig.optional.map((fieldConfig, idx) => {
              const { name, label, unit, type, options, min, max, disabled } = fieldConfig

              if (type === 'select') {
                return (
                  <Form.Item key={name} name={name} label={`${label}${unit ? ` (${unit})` : ''}`}>
                    <Select
                      disabled={disabled}
                      placeholder={`选择${label}`}
                      options={options.map(opt => ({ label: opt, value: opt }))}
                    />
                  </Form.Item>
                )
              }

              // 处理影响系数字段，自动计算胶凝系数
              const influenceMatch = name.match(/^influenceFactor_(\d+)$/)
              const onChange = influenceMatch
                ? (value) => {
                    const dosage = parseInt(influenceMatch[1]) / 100
                    const factor = parseFloat(value) || 0
                    const cementitiousKey = `cementitiousFactor_${influenceMatch[1]}`
                    // 胶凝系数 = (影响系数 - (1 - 掺量)) / (影响系数 × 掺量)
                    let cementitiousFactor = null
                    if (factor > 0 && dosage > 0) {
                      cementitiousFactor = (factor - (1 - dosage)) / (factor * dosage)
                    }
                    form.setFieldValue(cementitiousKey, cementitiousFactor !== null ? Math.round(cementitiousFactor * 10000) / 10000 : null)
                  }
                : undefined

              return (
                <Form.Item key={name} name={name} label={`${label}${unit ? ` (${unit})` : ''}`}>
                  <InputNumber
                    disabled={disabled}
                    min={min}
                    max={max}
                    precision={2}
                    placeholder={`输入${label}`}
                    style={{ width: '100%' }}
                    onChange={onChange}
                  />
                </Form.Item>
              )
            })}
          </>
        )}
      </>
    )
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      sorter: (a, b) => a.name.localeCompare(b.name),
      onHeaderCell: () => ({ scope: 'col' })
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      filters: MATERIAL_TYPES.map(t => ({ text: t, value: t })),
      onFilter: (value, record) => record.type === value,
      onHeaderCell: () => ({ scope: 'col' })
    },
    {
      title: '规格',
      dataIndex: 'specification',
      key: 'specification',
      width: 100,
      onHeaderCell: () => ({ scope: 'col' })
    },
    {
      title: '生产厂家',
      dataIndex: 'manufacturer',
      key: 'manufacturer',
      width: 150,
      onHeaderCell: () => ({ scope: 'col' })
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      onHeaderCell: () => ({ scope: 'col' }),
      render: (_, record) => (
        <Space size="small">
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
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
    <div className="page-container">
      <div className="action-bar">
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddNew} className="custom-btn">
          新增材料
        </Button>
        <Button icon={<ReloadOutlined />} onClick={loadMaterials} loading={loading} className="custom-btn">
          刷新
        </Button>
      </div>

      <div className="custom-card">
        <Table
          columns={columns}
          dataSource={materials}
          loading={loading}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`
          }}
          scroll={{ x: 650 }}
          className="custom-table"
        />
      </div>

      <Modal
        title={editingId ? '编辑材料' : '新增材料'}
        open={modalVisible}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalVisible(false)
          setSelectedType(null)
        }}
        confirmLoading={saving}
        width={900}
        className="custom-modal"
      >
        <Form form={form} layout="vertical" onFinish={handleSave} className="custom-form">
          {renderFormFields()}
        </Form>
      </Modal>
    </div>
  )
}

export default MaterialsPage

// 基准方案（原销售报价的"基础配合比库"）
// 从 SalesQuoteSettings 抽取，作为方案管理的一个视图
import React, { useEffect, useState } from 'react'
import { Button, Divider, Form, Input, InputNumber, Modal, Select, Space, Table, message, Typography } from 'antd'
import { WATER_MATERIAL_ID, buildManualMixMaterials, buildMaterialOptions } from '../utils/salesQuoteMaterials.mjs'
import extractErrorMessage from '../utils/extractErrorMessage'

const { Text } = Typography

const CONCRETE_TYPES = ['普通', '泵送', '抗渗', '早强', '缓凝', '大体积', '高强']

const BasicMixTab = () => {
  const [mixes, setMixes] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [editingMix, setEditingMix] = useState(null)
  const [mixForm] = Form.useForm()
  const [mixModalVisible, setMixModalVisible] = useState(false)
  const [mixMaterials, setMixMaterials] = useState([])

  const loadData = async () => {
    const mixResult = await window.electronAPI.invoke('salesQuote:listBasicMixDesigns', {})
    if (mixResult.success) {
      setMixes(mixResult.data)
    } else {
      message.error(extractErrorMessage(mixResult.error, '加载基准方案失败'))
    }
  }

  const loadMaterials = async () => {
    const result = await window.electronAPI.invoke('getAllMaterials')
    if (result?.success) {
      setAllMaterials(result.data || [])
    }
  }

  useEffect(() => {
    loadData()
    loadMaterials()
  }, [])

  const setMixFormFields = (row) => {
    mixForm.setFieldsValue({
      name: row.name,
      strengthGrade: row.strengthGrade,
      concreteType: row.concreteType,
      slump: row.slump,
      remarks: row.remarks
    })
  }

  const handleEditMix = (row) => {
    setEditingMix(row)
    setMixFormFields(row)
    setMixMaterials((row.materials || []).map((m, i) => ({
      ...m,
      materialId: !m.materialId && (m.materialType === '水' || m.materialName === '水') ? WATER_MATERIAL_ID : m.materialId,
      _rowKey: m.materialId ? `mat-${m.materialId}` : `row-${i}`
    })))
    setMixModalVisible(true)
  }

  const handleAddMix = () => {
    setEditingMix(null)
    mixForm.resetFields()
    setMixMaterials([])
    setMixModalVisible(true)
  }

  const addMaterialRow = () => {
    setMixMaterials(prev => [...prev, { _rowKey: `new-${Date.now()}`, materialId: null, materialType: '', materialName: '', usage: null }])
  }

  const updateMaterialRow = (index, patch) => {
    setMixMaterials(prev => {
      const next = [...prev]
      const row = { ...next[index], ...patch }
      if (patch.materialId === WATER_MATERIAL_ID) {
        row.materialType = '水'
        row.materialName = '水'
      } else if (patch.materialId != null) {
        const mat = allMaterials.find(m => m.id === patch.materialId)
        if (mat) {
          row.materialType = mat.type
          row.materialName = mat.name
        }
      }
      next[index] = row
      return next
    })
  }

  const removeMaterialRow = (index) => {
    setMixMaterials(prev => prev.filter((_, i) => i !== index))
  }

  const handleSaveMix = async () => {
    const values = await mixForm.validateFields()
    const materials = buildManualMixMaterials(mixMaterials)
    if (materials.length === 0) {
      message.error('请至少添加一种材料并填写用量（kg/m³）')
      return
    }
    const payload = { ...values, materials }
    let result
    if (editingMix) {
      result = await window.electronAPI.invoke('salesQuote:updateBasicMixDesign', { id: editingMix.id, data: payload })
    } else {
      result = await window.electronAPI.invoke('salesQuote:createBasicMixDesign', payload)
    }
    if (result.success) {
      message.success(editingMix ? '已更新' : '已创建')
      setMixModalVisible(false)
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '保存失败'))
    }
  }

  const handleDeleteMix = async (row) => {
    if (!confirm(`确认删除 "${row.name}" 吗？`)) return
    const result = await window.electronAPI.invoke('salesQuote:deleteBasicMixDesign', row.id)
    if (result.success) {
      message.success('已删除')
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '删除失败'))
    }
  }

  const handleSetDefault = async (row) => {
    const result = await window.electronAPI.invoke('salesQuote:setDefaultBasicMixDesign', row.id)
    if (result.success) {
      message.success('已设为默认')
      loadData()
    } else {
      message.error(extractErrorMessage(result.error, '设置失败'))
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Button type="primary" size="small" onClick={handleAddMix}>新增基准方案</Button>
      </div>
      <Table
        className="custom-table"
        rowKey="id"
        dataSource={mixes}
        pagination={false}
        scroll={{ x: 800 }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '强度', dataIndex: 'strengthGrade' },
          { title: '类型', dataIndex: 'concreteType' },
          { title: '坍落度', dataIndex: 'slump' },
          { title: '默认', dataIndex: 'isDefault', render: v => v ? '是' : '否' },
          { title: '来源', dataIndex: 'source' },
          {
            title: '操作',
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => handleEditMix(row)}>编辑</Button>
                <Button size="small" onClick={() => handleSetDefault(row)} disabled={row.isDefault}>设为默认</Button>
                <Button size="small" danger onClick={() => handleDeleteMix(row)}>删除</Button>
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editingMix ? '编辑基准方案' : '新增基准方案'}
        open={mixModalVisible}
        onOk={handleSaveMix}
        onCancel={() => setMixModalVisible(false)}
        destroyOnClose
        width={820}
      >
        <Form form={mixForm} layout="vertical" preserve={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="strengthGrade" label="强度等级" rules={[{ required: true, message: '请输入强度等级' }]}>
              <Input style={{ width: 120 }} placeholder="如 C35" />
            </Form.Item>
            <Form.Item name="concreteType" label="混凝土类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select
                style={{ width: 140 }}
                options={CONCRETE_TYPES.map(value => ({ value, label: value }))}
              />
            </Form.Item>
            <Form.Item name="slump" label="坍落度">
              <InputNumber style={{ width: 120 }} addonAfter="mm" min={0} />
            </Form.Item>
          </Space>
          <Form.Item name="remarks" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
        <Divider orientation="left" plain>材料用量</Divider>
        <div style={{ marginBottom: 8 }}>
          <Button type="dashed" size="small" onClick={addMaterialRow}>
            添加材料
          </Button>
          {allMaterials.length === 0 && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>材料库为空时仍可先添加水</Text>
          )}
        </div>
        <Table
          size="small"
          pagination={false}
          dataSource={mixMaterials}
          rowKey={(row) => row._rowKey || row.materialId}
          locale={{ emptyText: '请添加材料并填写单方用量' }}
          columns={[
            {
              title: '材料',
              width: 280,
              render: (_, row, index) => (
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择材料"
                  value={row.materialId || undefined}
                  showSearch
                  optionFilterProp="label"
                  options={buildMaterialOptions(allMaterials)}
                  onChange={(materialId) => updateMaterialRow(index, { materialId })}
                />
              )
            },
            { title: '类型', dataIndex: 'materialType', width: 90 },
            {
              title: '单方用量(kg/m³)',
              width: 140,
              render: (_, row, index) => (
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={1}
                  value={row.usage}
                  onChange={(usage) => updateMaterialRow(index, { usage })}
                />
              )
            },
            {
              title: '操作',
              width: 72,
              render: (_, __, index) => (
                <Button type="link" size="small" danger onClick={() => removeMaterialRow(index)}>删除</Button>
              )
            }
          ]}
        />
      </Modal>
    </div>
  )
}

export default BasicMixTab

import React, { useEffect } from 'react'
import { Form, Input, InputNumber, Modal, Select, Switch, message } from 'antd'

const TYPES = ['普通', '泵送', '抗渗', '早强', '缓凝', '大体积', '高强']

function buildMaterialsFromResult(result) {
  const selected = result.selectedMaterials || {}
  const usages = result.materials || {}
  const rows = []
  const map = [
    ['cement', '水泥', usages.cement],
    ['flyAsh', '粉煤灰', usages.flyAsh],
    ['slag', '矿渣粉', usages.slag],
    ['lithiumSlag', '锂渣', usages.lithiumSlag],
    ['compositePowder', '复合粉', usages.compositePowder],
    ['superplasticizer', '减水剂', usages.superplasticizer]
  ]
  for (const [key, type, usage] of map) {
    if (usage > 0 && selected[key]) {
      rows.push({ materialId: selected[key].id, materialType: type, materialName: selected[key].name, usage })
    }
  }
  for (const item of selected.sand || []) {
    rows.push({ materialId: item.id, materialType: '细骨料', materialName: item.name, usage: usages.sand || 0 })
  }
  for (const item of selected.stone || []) {
    rows.push({ materialId: item.id, materialType: '粗骨料', materialName: item.name, usage: usages.stone || 0 })
  }
  return rows
}

const SaveBasicMixModal = ({ open, data, onCancel, onSaved }) => {
  const [form] = Form.useForm()

  useEffect(() => {
    if (open && data) {
      form.setFieldsValue({
        name: `${data.strength || data.strengthGrade || '混凝土'}基础配合比`,
        strengthGrade: data.strength || data.strengthGrade,
        concreteType: '普通',
        slump: data.slump,
        isDefault: true,
        remarks: ''
      })
    }
  }, [open, data, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    const result = await window.electronAPI.invoke('salesQuote:createBasicMixDesign', {
      ...values,
      materials: buildMaterialsFromResult(data),
      source: '智能设计保存'
    })
    if (result.success) {
      message.success('已保存到基础配合比库')
      onSaved?.(result.data)
    } else {
      message.error(result.error || '保存失败')
    }
  }

  return (
    <Modal title="保存到基础配合比库" open={open} onOk={handleOk} onCancel={onCancel}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="strengthGrade" label="强度等级" rules={[{ required: true, message: '请输入强度等级' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="concreteType" label="混凝土类型" rules={[{ required: true }]}>
          <Select options={TYPES.map(value => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item name="slump" label="坍落度(mm)">
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="isDefault" label="作为默认报价方案" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="remarks" label="备注">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default SaveBasicMixModal
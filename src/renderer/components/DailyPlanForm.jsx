import React from 'react'
import { Modal, Form, Input, InputNumber, Select, AutoComplete } from 'antd'

// v0.8.1：配合比改为分公司绑定（CapacityConfig.c30BaselineMixDesignId），计划表单不再有"配合比方案"选择项
export default function DailyPlanForm({ open, editingId, initialValues, branches, existingProjectNames, onSave, onCancel }) {
  const [form] = Form.useForm()

  const handleOk = async () => {
    const values = await form.validateFields()
    onSave(values)
  }

  return (
    <Modal title={editingId ? '编辑计划' : '新增计划'} open={open} onOk={handleOk} onCancel={onCancel} destroyOnHidden width={700}>
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item name="planDate" label="计划日期" rules={[{ required: true }]}>
          <Input placeholder="YYYY-MM-DD" disabled={!!editingId} />
        </Form.Item>
        <Form.Item name="projectName" label="项目名称" rules={[{ required: true }]}>
          <AutoComplete options={existingProjectNames.map(n => ({ value: n }))} filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())} disabled={!!editingId}>
            <Input />
          </AutoComplete>
        </Form.Item>
        <Form.Item name="pourLocation" label="浇筑部位" rules={[{ required: true }]}>
          <Input disabled={!!editingId} />
        </Form.Item>
        <Form.Item name="strengthGrade" label="标号" rules={[{ required: true }]}>
          <Input disabled={!!editingId} />
        </Form.Item>
        <Form.Item name="branchId" label="发料分公司" rules={[{ required: true }]}>
          <Select disabled={!!editingId}>
            {branches.map(b => <Select.Option key={b.id} value={b.id}>{b.branchName}</Select.Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="volume" label="方量(m³)" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="plannedSendTime" label="计划发料时间" rules={[{ required: true }]}>
          <Input placeholder="HH:mm" />
        </Form.Item>
        <Form.Item name="expectedDuration" label="预计持续时间(h)" rules={[{ required: true }]}>
          <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="constructionUnit" label="施工单位"><Input /></Form.Item>
        <Form.Item name="receiveMethod" label="收件方式">
          <Select><Select.Option value="微信">微信</Select.Option><Select.Option value="短信">短信</Select.Option><Select.Option value="app">app</Select.Option></Select>
        </Form.Item>
        <Form.Item name="remarks" label="备注"><Input.TextArea /></Form.Item>
      </Form>
    </Modal>
  )
}

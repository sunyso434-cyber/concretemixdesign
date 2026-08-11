import React from 'react'
import { Modal, Form, Input, InputNumber } from 'antd'

export default function VehicleDetailForm({ open, editingId, initialValues, onSave, onCancel }) {
  const [form] = Form.useForm()
  const handleOk = async () => {
    const values = await form.validateFields()
    onSave(values)
  }
  return (
    <Modal title={editingId ? '编辑车次' : '手工补录车次'} open={open} onOk={handleOk} onCancel={onCancel} width={600} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <Form.Item name="mixerTowerNo" label="搅拌楼号" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="productionDate" label="生产日期" rules={[{ required: true }]}><Input placeholder="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="productionTime" label="生产时间" rules={[{ required: true }]}><Input placeholder="HH:mm" /></Form.Item>
        <Form.Item name="shipmentNo" label="发货号" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="projectName" label="工程名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="pourLocation" label="工程部位" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="strengthGrade" label="标号" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="volume" label="方量" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="taskOrderNo" label="任务单号"><Input /></Form.Item>
        <Form.Item name="constructionUnit" label="施工单位"><Input /></Form.Item>
        <Form.Item name="operator" label="操作工"><Input /></Form.Item>
        <Form.Item name="plateNo" label="车牌号"><Input /></Form.Item>
        <Form.Item name="vehicleNo" label="车号"><Input /></Form.Item>
        <Form.Item name="driver" label="驾驶员"><Input /></Form.Item>
        <Form.Item name="supplyMethod" label="供应方式"><Input /></Form.Item>
      </Form>
    </Modal>
  )
}
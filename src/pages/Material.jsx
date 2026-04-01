import React from 'react'
import { Typography, Card, Form, Input, Select, Button, Table, Modal } from 'antd'

const { Title } = Typography
const { Option } = Select

function Material() {
  // 模拟材料数据
  const materialData = [
    {
      key: '1',
      name: 'P.O 42.5水泥',
      type: '水泥',
      density: '3100kg/m³',
      price: '500元/吨',
      supplier: '海螺水泥'
    },
    {
      key: '2',
      name: '河砂',
      type: '细骨料',
      density: '2650kg/m³',
      price: '120元/吨',
      supplier: '本地砂场'
    },
    {
      key: '3',
      name: '碎石',
      type: '粗骨料',
      density: '2700kg/m³',
      price: '100元/吨',
      supplier: '本地石场'
    }
  ]

  // 模态框状态
  const [isModalVisible, setIsModalVisible] = React.useState(false)

  // 打开模态框
  const showModal = () => {
    setIsModalVisible(true)
  }

  // 关闭模态框
  const handleCancel = () => {
    setIsModalVisible(false)
  }

  // 处理表单提交
  const handleOk = () => {
    setIsModalVisible(false)
  }

  return (
    <div>
      <Title level={2}>材料管理</Title>
      
      <Button type="primary" style={{ marginBottom: 16 }} onClick={showModal}>
        添加材料
      </Button>
      
      <Card>
        <Table dataSource={materialData} columns={[
          { title: '材料名称', dataIndex: 'name', key: 'name' },
          { title: '材料类型', dataIndex: 'type', key: 'type' },
          { title: '密度', dataIndex: 'density', key: 'density' },
          { title: '价格', dataIndex: 'price', key: 'price' },
          { title: '供应商', dataIndex: 'supplier', key: 'supplier' },
          { 
            title: '操作', 
            key: 'action',
            render: () => (
              <div>
                <Button size="small" style={{ marginRight: 8 }}>编辑</Button>
                <Button size="small" danger>删除</Button>
              </div>
            )
          }
        ]} />
      </Card>
      
      {/* 添加材料模态框 */}
      <Modal
        title="添加材料"
        open={isModalVisible}
        onOk={handleOk}
        onCancel={handleCancel}
      >
        <Form layout="vertical">
          <Form.Item label="材料名称" name="name" rules={[{ required: true, message: '请输入材料名称' }]}>
            <Input placeholder="请输入材料名称" />
          </Form.Item>
          
          <Form.Item label="材料类型" name="type" rules={[{ required: true, message: '请选择材料类型' }]}>
            <Select placeholder="请选择材料类型">
              <Option value="水泥">水泥</Option>
              <Option value="细骨料">细骨料</Option>
              <Option value="粗骨料">粗骨料</Option>
              <Option value="外加剂">外加剂</Option>
              <Option value="掺和料">掺和料</Option>
            </Select>
          </Form.Item>
          
          <Form.Item label="密度" name="density" rules={[{ required: true, message: '请输入密度' }]}>
            <Input placeholder="请输入密度（kg/m³）" />
          </Form.Item>
          
          <Form.Item label="价格" name="price" rules={[{ required: true, message: '请输入价格' }]}>
            <Input placeholder="请输入价格（元/吨）" />
          </Form.Item>
          
          <Form.Item label="供应商" name="supplier" rules={[{ required: true, message: '请输入供应商' }]}>
            <Input placeholder="请输入供应商" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Material

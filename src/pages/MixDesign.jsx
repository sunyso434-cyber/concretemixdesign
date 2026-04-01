import React from 'react'
import { Typography, Card, Form, Input, Select, Button, Table } from 'antd'

const { Title } = Typography
const { Option } = Select

function MixDesign() {
  // 模拟配合比方案数据
  const mixDesignData = [
    {
      key: '1',
      name: 'C30普通混凝土',
      strength: '30MPa',
      cement: '300kg',
      aggregate: '1200kg',
      water: '180kg',
      admixture: '6kg'
    },
    {
      key: '2',
      name: 'C40高强混凝土',
      strength: '40MPa',
      cement: '380kg',
      aggregate: '1150kg',
      water: '160kg',
      admixture: '7.6kg'
    }
  ]

  return (
    <div>
      <Title level={2}>配合比设计</Title>
      
      <Card style={{ marginBottom: 24 }}>
        <Form layout="vertical">
          <Form.Item label="配合比名称" name="name" rules={[{ required: true, message: '请输入配合比名称' }]}>
            <Input placeholder="请输入配合比名称" />
          </Form.Item>
          
          <Form.Item label="强度等级" name="strength" rules={[{ required: true, message: '请选择强度等级' }]}>
            <Select placeholder="请选择强度等级">
              <Option value="C20">C20</Option>
              <Option value="C25">C25</Option>
              <Option value="C30">C30</Option>
              <Option value="C35">C35</Option>
              <Option value="C40">C40</Option>
              <Option value="C45">C45</Option>
              <Option value="C50">C50</Option>
            </Select>
          </Form.Item>
          
          <Form.Item label="水泥用量" name="cement" rules={[{ required: true, message: '请输入水泥用量' }]}>
            <Input placeholder="请输入水泥用量（kg）" type="number" />
          </Form.Item>
          
          <Form.Item label="骨料用量" name="aggregate" rules={[{ required: true, message: '请输入骨料用量' }]}>
            <Input placeholder="请输入骨料用量（kg）" type="number" />
          </Form.Item>
          
          <Form.Item label="用水量" name="water" rules={[{ required: true, message: '请输入用水量' }]}>
            <Input placeholder="请输入用水量（kg）" type="number" />
          </Form.Item>
          
          <Form.Item label="外加剂用量" name="admixture" rules={[{ required: true, message: '请输入外加剂用量' }]}>
            <Input placeholder="请输入外加剂用量（kg）" type="number" />
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit">保存配合比</Button>
            <Button style={{ marginLeft: 8 }}>计算配合比</Button>
          </Form.Item>
        </Form>
      </Card>
      
      <Card>
        <Title level={3}>配合比方案列表</Title>
        <Table dataSource={mixDesignData} columns={[
          { title: '配合比名称', dataIndex: 'name', key: 'name' },
          { title: '强度等级', dataIndex: 'strength', key: 'strength' },
          { title: '水泥用量', dataIndex: 'cement', key: 'cement' },
          { title: '骨料用量', dataIndex: 'aggregate', key: 'aggregate' },
          { title: '用水量', dataIndex: 'water', key: 'water' },
          { title: '外加剂用量', dataIndex: 'admixture', key: 'admixture' },
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
    </div>
  )
}

export default MixDesign

import React from 'react'
import { Typography, Card, Form, Input, Select, Button, Table } from 'antd'

const { Title } = Typography
const { Option } = Select

function Setting() {
  // 模拟系统参数数据
  const systemParamData = [
    {
      key: '1',
      name: '水灰比最大值',
      value: '0.6',
      unit: '',
      description: '混凝土配合比设计中允许的最大水灰比'
    },
    {
      key: '2',
      name: '砂率范围',
      value: '30-40',
      unit: '%',
      description: '混凝土配合比设计中砂率的合理范围'
    },
    {
      key: '3',
      name: '单位用水量',
      value: '160-220',
      unit: 'kg/m³',
      description: '混凝土配合比设计中单位用水量的合理范围'
    }
  ]

  return (
    <div>
      <Title level={2}>系统设置</Title>
      
      <Card style={{ marginBottom: 24 }}>
        <Form layout="vertical">
          <Form.Item label="参数名称" name="name" rules={[{ required: true, message: '请输入参数名称' }]}>
            <Input placeholder="请输入参数名称" />
          </Form.Item>
          
          <Form.Item label="参数值" name="value" rules={[{ required: true, message: '请输入参数值' }]}>
            <Input placeholder="请输入参数值" />
          </Form.Item>
          
          <Form.Item label="单位" name="unit">
            <Input placeholder="请输入单位" />
          </Form.Item>
          
          <Form.Item label="参数描述" name="description">
            <Input.TextArea placeholder="请输入参数描述" />
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit">保存参数</Button>
          </Form.Item>
        </Form>
      </Card>
      
      <Card>
        <Title level={3}>系统参数列表</Title>
        <Table dataSource={systemParamData} columns={[
          { title: '参数名称', dataIndex: 'name', key: 'name' },
          { title: '参数值', dataIndex: 'value', key: 'value' },
          { title: '单位', dataIndex: 'unit', key: 'unit' },
          { title: '参数描述', dataIndex: 'description', key: 'description' },
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

export default Setting

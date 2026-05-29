import React, { useState, useEffect } from 'react'
import { Card, Button, Space, Typography, Form, InputNumber, Tag, Descriptions } from 'antd'
import { CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

const TOOL_LABELS = {
  save_mix_design: '保存配合比方案',
  save_to_basic_mix_library: '保存到基础配合比库',
  create_sales_quote_rule: '创建报价规则',
  calculate_sales_quote: '生成报价'
}

const TIMEOUT_MS = 5 * 60 * 1000 // 5分钟超时

const DecisionGate = ({ toolName, args, onConfirm, onReject }) => {
  const [expired, setExpired] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editedArgs, setEditedArgs] = useState({ ...args })
  const [form] = Form.useForm()

  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  if (expired) {
    return (
      <Card size="small" style={{ marginBottom: 8, opacity: 0.5 }}>
        <Text type="secondary">已超时。如需调整请重新描述需求。</Text>
      </Card>
    )
  }

  if (confirmed) {
    return (
      <Card size="small" style={{ marginBottom: 8 }}>
        <Text type="success"><CheckOutlined /> 已采纳</Text>
        {Object.keys(editedArgs).length > 0 && (
          <Descriptions size="small" column={1} style={{ marginTop: 4 }}>
            {Object.entries(editedArgs).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>{JSON.stringify(v)}</Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Card>
    )
  }

  if (rejected) {
    return (
      <Card size="small" style={{ marginBottom: 8 }}>
        <Text type="secondary">已拒绝。你可以继续描述需求。</Text>
      </Card>
    )
  }

  const handleConfirm = () => {
    if (editMode) {
      form.validateFields().then(values => {
        setEditedArgs(values)
        setConfirmed(true)
        onConfirm(values)
      })
    } else {
      setConfirmed(true)
      onConfirm(editedArgs)
    }
  }

  return (
    <Card
      size="small"
      style={{
        marginBottom: 8,
        borderColor: 'var(--color-primary, #0071e3)',
        borderWidth: 1
      }}
      title={
        <Space>
          <Tag color="blue">AI 建议</Tag>
          <Text strong>{TOOL_LABELS[toolName] || toolName}</Text>
        </Space>
      }
    >
      {editMode ? (
        <Form form={form} initialValues={editedArgs} layout="vertical" size="small">
          {Object.entries(editedArgs).map(([key, value]) => (
            <Form.Item key={key} name={key} label={key}>
              {typeof value === 'number'
                ? <InputNumber style={{ width: '100%' }} />
                : <InputNumber style={{ width: '100%' }} />}
            </Form.Item>
          ))}
        </Form>
      ) : (
        <Descriptions size="small" column={1}>
          {Object.entries(editedArgs).filter(([k]) => k !== '_salesQuoteGuard').map(([key, value]) => (
            <Descriptions.Item key={key} label={key}>
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}

      <Space style={{ marginTop: 8 }}>
        <Button
          type="primary"
          size="small"
          icon={<CheckOutlined />}
          onClick={handleConfirm}
        >
          {editMode ? '确认修改' : '确认'}
        </Button>
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? '取消修改' : '修改'}
        </Button>
        <Button
          size="small"
          danger
          icon={<CloseOutlined />}
          onClick={() => { setRejected(true); onReject() }}
        >
          拒绝
        </Button>
      </Space>
    </Card>
  )
}

export default DecisionGate

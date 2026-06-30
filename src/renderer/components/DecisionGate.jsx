import React, { useState, useEffect } from 'react'
import { Card, Button, Space, Typography, Form, InputNumber, Tag, Descriptions, Input } from 'antd'
import { CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons'

const { Text } = Typography
const { TextArea } = Input

const TOOL_LABELS = {
  save_mix_design: '保存配合比方案',
  save_to_basic_mix_library: '保存到基础配合比库',
  create_sales_quote_rule: '创建报价规则',
  calculate_sales_quote: '生成报价',
  ask_user: 'AI 提问'
}

const TIMEOUT_MS = 5 * 60 * 1000 // 5分钟超时（前端兜底，后端 90s 会先超时）

/**
 * DecisionGate - 决策弹窗
 *
 * v9.1.0 起支持两种模式（由 confirmation 对象的字段决定）：
 *
 * 1. 原有 requiresConfirmation 模式（save_mix_design 等）
 *    confirmation 含 { toolName, args }，无 inputType
 *    渲染：args 详情 + 确认/修改/拒绝按钮
 *
 * 2. ask_user 自由文本提问模式
 *    confirmation 含 { toolName: 'ask_user', question, inputType: 'text', placeholder, defaultValue }
 *    渲染：question 文本 + TextArea 输入框 + 确认/取消按钮
 *
 * 3. ask_user 选项选择模式
 *    confirmation 含 { toolName: 'ask_user', question, inputType: 'choice', options: [...] }
 *    渲染：question 文本 + 选项按钮列表
 *
 * @param {object} props.confirmation - 后端发来的 confirmation 请求对象
 * @param {function} props.onConfirm - (args) => void，args 形如 { answer: 'xxx' }（ask_user）或原 args（requiresConfirmation）
 * @param {function} props.onReject - () => void
 */
const DecisionGate = ({ confirmation, onConfirm, onReject }) => {
  const { toolName, args, question, inputType, options, placeholder, defaultValue } = confirmation || {}
  const [expired, setExpired] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editedArgs, setEditedArgs] = useState({ ...(args || {}) })
  const [textInput, setTextInput] = useState('')
  const [form] = Form.useForm()

  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  // ask_user 模式：inputType 字段存在时走新分支
  const isAskUserMode = !!inputType

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
        {isAskUserMode ? (
          <div style={{ marginTop: 4 }}>
            <Text type="secondary">回答：</Text>
            <Text>{textInput || defaultValue || '(空)'}</Text>
          </div>
        ) : (
          Object.keys(editedArgs).length > 0 && (
            <Descriptions size="small" column={1} style={{ marginTop: 4 }}>
              {Object.entries(editedArgs).map(([k, v]) => (
                <Descriptions.Item key={k} label={k}>{JSON.stringify(v)}</Descriptions.Item>
              ))}
            </Descriptions>
          )
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

  // ===== ask_user 模式：自由文本输入 =====
  if (isAskUserMode && inputType === 'text') {
    const handleAskUserConfirm = () => {
      setConfirmed(true)
      onConfirm({ answer: textInput })
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
            <Tag color="blue">AI 提问</Tag>
            <Text strong>{TOOL_LABELS[toolName] || toolName || 'AI 提问'}</Text>
          </Space>
        }
      >
        <div style={{ marginBottom: 8 }}>
          <Text>{question}</Text>
        </div>
        <TextArea
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
          placeholder={placeholder || '请输入回答...'}
          autoSize={{ minRows: 2, maxRows: 6 }}
          autoFocus
          onPressEnter={handleAskUserConfirm}
        />
        <Space style={{ marginTop: 8 }}>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={handleAskUserConfirm}
          >
            确认
          </Button>
          {defaultValue && (
            <Button
              size="small"
              onClick={() => {
                setTextInput(defaultValue)
              }}
            >
              使用默认（{defaultValue}）
            </Button>
          )}
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => { setRejected(true); onReject() }}
          >
            取消
          </Button>
        </Space>
      </Card>
    )
  }

  // ===== ask_user 模式：选项选择 =====
  if (isAskUserMode && inputType === 'choice') {
    const handleChoice = (choice) => {
      setConfirmed(true)
      onConfirm({ answer: choice })
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
            <Tag color="blue">AI 提问</Tag>
            <Text strong>{TOOL_LABELS[toolName] || toolName || 'AI 提问'}</Text>
          </Space>
        }
      >
        <div style={{ marginBottom: 8 }}>
          <Text>{question}</Text>
        </div>
        <Space wrap>
          {(Array.isArray(options) && options.length > 0 ? options : []).map(opt => (
            <Button
              key={opt}
              size="small"
              onClick={() => handleChoice(opt)}
            >
              {opt}
            </Button>
          ))}
          <Button
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => { setRejected(true); onReject() }}
          >
            取消
          </Button>
        </Space>
      </Card>
    )
  }

  // ===== 原有 requiresConfirmation 模式（save_mix_design 等） =====
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

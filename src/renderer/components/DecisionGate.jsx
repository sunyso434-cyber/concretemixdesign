import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Space, Typography, Form, InputNumber, Tag, Input, Select, Switch } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'

const { Text } = Typography
const { TextArea } = Input

const TOOL_LABELS = {
  save_mix_design: '保存配合比方案',
  create_sales_quote_rule: '创建报价规则（已废弃）',
  calculate_sales_quote: '生成报价（已废弃）',
  reverse_sales_quote: '反向套价（普通混凝土）',
  forward_sales_quote: '正向测算（特殊混凝土）',
  format_quote_report: '导出报价单',
  ask_user: 'AI 提问',
  delete_mix_design: '删除配合比方案',
  update_mix_design: '修改配合比方案'
}

/**
 * 把单个选项规范化为字符串（前端兜底，防 React 渲染对象白屏）
 * - string -> 原样
 * - number/boolean -> String()
 * - object -> 取 text/label/value/name/title 字段，再不行 JSON.stringify
 *   （覆盖 LLM 把选项传成 {text:"C30"} 这类对象的场景）
 * - null/undefined -> null（被 normalizeOptions 过滤掉）
 */
function normalizeOption(opt) {
  if (opt == null) return null
  if (typeof opt === 'string') return opt
  if (typeof opt === 'number' || typeof opt === 'boolean') return String(opt)
  if (typeof opt === 'object') {
    const text = opt.text ?? opt.label ?? opt.value ?? opt.name ?? opt.title
    return text != null ? String(text) : JSON.stringify(opt)
  }
  return String(opt)
}

/** 把 options 数组规范化为纯字符串数组；非数组返回空数组 */
function normalizeOptions(options) {
  if (!Array.isArray(options)) return []
  return options.map(normalizeOption).filter(o => o != null)
}

const TIMEOUT_MS = 5 * 60 * 1000 // 5分钟超时（前端兜底，后端 90s 会先超时）

/**
 * DecisionGate - 决策弹窗
 *
 * v10.x 起只支持 ask_user 三种模式（彻底取代 requiresConfirmation 框架）：
 *
 * 1. ask_user 自由文本模式（inputType='text'）
 *    渲染：question + TextArea 输入框 + 确认/取消
 *    确认返回 { answer }
 *
 * 2. ask_user 选项选择模式（inputType='choice'）
 *    渲染：question + 选项按钮列表 + "其他"输入框（所有 choice 都带）
 *    点预设选项 → 确认返回 { answer: 选项文本 }
 *    填"其他" + 提交 → 确认返回 { answer: 自定义文本 }
 *    取消 → 拒绝
 *
 * 3. ask_user 结构化表单模式（inputType='form'）
 *    渲染：question + 动态表单（每 field 一个 Form.Item）
 *    field type 支持 string/number/boolean/enum
 *    确认返回 { values: { key: value, ... } }
 *
 * @param {object} props.confirmation - 后端发来的 confirmation 请求对象
 * @param {function} props.onConfirm - (args) => void，args 形如 { answer } / { values }
 * @param {function} props.onReject - () => void
 */
const DecisionGate = ({ confirmation, onConfirm, onReject }) => {
  const { toolName, question, inputType, options, placeholder, defaultValue, fields } = confirmation || {}
  const [expired, setExpired] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [textInput, setTextInput] = useState('')
  const [otherInput, setOtherInput] = useState('')
  const [form] = Form.useForm()

  // v2026-08-03：前端超时兜底——主动收起（正常流程后端 90s 先发 confirmation-close；
  // 这里只防极端情况：后端事件丢失时弹窗不残留）。onReject 经 ref 取最新引用，避免父组件重渲染重置 timer。
  const onRejectRef = useRef(onReject)
  useEffect(() => { onRejectRef.current = onReject })
  useEffect(() => {
    const timer = setTimeout(() => {
      setExpired(true)
      try { onRejectRef.current() } catch (_) {}
    }, TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  if (expired) {
    return (
      <Card size="small" style={{ marginBottom: 8, opacity: 0.5 }}>
        <Text type="secondary">已超时。如需调整请重新描述需求。</Text>
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
  if (inputType === 'text') {
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
          <Button type="primary" size="small" icon={<CheckOutlined />} onClick={handleAskUserConfirm}>
            确认
          </Button>
          {defaultValue && (
            <Button size="small" onClick={() => setTextInput(defaultValue)}>
              使用默认（{defaultValue}）
            </Button>
          )}
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => { setRejected(true); onReject() }}>
            取消
          </Button>
        </Space>
      </Card>
    )
  }

  // ===== ask_user 模式：选项选择（带"其他"输入框）=====
  if (inputType === 'choice') {
    const handleChoice = (choice) => {
      setConfirmed(true)
      onConfirm({ answer: choice })
    }
    const handleOtherSubmit = () => {
      if (!otherInput.trim()) return
      setConfirmed(true)
      onConfirm({ answer: otherInput })
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
          {normalizeOptions(options).map(opt => (
            <Button key={opt} size="small" onClick={() => handleChoice(opt)}>
              {opt}
            </Button>
          ))}
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => { setRejected(true); onReject() }}>
            取消
          </Button>
        </Space>
        {/* SPEC 2.2：所有 choice 模式都带"其他"输入框 */}
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>其他（自定义）：</Text>
          <Space.Compact style={{ width: '100%', marginTop: 4 }}>
            <TextArea
              value={otherInput}
              onChange={e => setOtherInput(e.target.value)}
              placeholder="如有其他想法或额外要求，请输入后提交"
              autoSize={{ minRows: 1, maxRows: 3 }}
              style={{ width: '100%' }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault()
                  handleOtherSubmit()
                }
              }}
            />
            <Button type="primary" size="small" onClick={handleOtherSubmit} disabled={!otherInput.trim()}>
              提交
            </Button>
          </Space.Compact>
        </div>
      </Card>
    )
  }

  // ===== ask_user 模式：结构化表单 =====
  if (inputType === 'form') {
    const handleFormConfirm = () => {
      form.validateFields().then(values => {
        setConfirmed(true)
        onConfirm({ values })
      }).catch(() => {
        // antd Form 校验失败时已有红字提示，不弹 toast
      })
    }
    // 构造 initialValues（从 fields.value 取）
    const initialValues = {}
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (f && f.key) initialValues[f.key] = f.value
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
            <Tag color="blue">AI 提问</Tag>
            <Text strong>{TOOL_LABELS[toolName] || toolName || 'AI 提问'}</Text>
          </Space>
        }
      >
        <div style={{ marginBottom: 8 }}>
          <Text>{question}</Text>
        </div>
        <Form form={form} initialValues={initialValues} layout="vertical" size="small">
          {(Array.isArray(fields) ? fields : []).map(field => {
            const { key, label, type = 'string', value, options: fieldOptions } = field || {}
            let inputEl
            switch (type) {
              case 'number':
                inputEl = <InputNumber style={{ width: '100%' }} />
                break
              case 'boolean':
                inputEl = <Switch />
                break
              case 'enum':
                inputEl = (
                  <Select style={{ width: '100%' }} placeholder="请选择">
                    {normalizeOptions(fieldOptions).map(o => (
                      <Select.Option key={o} value={o}>{o}</Select.Option>
                    ))}
                  </Select>
                )
                break
              case 'string':
              default:
                inputEl = <Input />
            }
            return (
              <Form.Item key={key} name={key} label={label} valuePropName={type === 'boolean' ? 'checked' : 'value'}>
                {inputEl}
              </Form.Item>
            )
          })}
        </Form>
        <Space style={{ marginTop: 8 }}>
          <Button type="primary" size="small" icon={<CheckOutlined />} onClick={handleFormConfirm}>
            确认
          </Button>
          <Button size="small" danger icon={<CloseOutlined />} onClick={() => { setRejected(true); onReject() }}>
            取消
          </Button>
        </Space>
      </Card>
    )
  }

  // ===== 兜底：未知模式 =====
  // v10.x 彻底删除 requiresConfirmation 框架后，无 inputType 的 confirmation 不应再出现。
  // 如出现，前端只展示提示信息，不弹任何按钮（防止误操作）。
  return (
    <Card size="small" style={{ marginBottom: 8, borderColor: 'red' }}>
      <Text type="danger">未知的确认请求（无 inputType 字段）。如需此操作，请联系开发者。</Text>
    </Card>
  )
}

export default DecisionGate

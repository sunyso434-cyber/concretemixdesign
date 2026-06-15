import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Tabs, Button, message, Select, Input, Space, Radio, Tag, Empty, Form, Card } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { loadAgentMd, saveAgentMd, reloadAgentMd } from '../store/agentRulesActions'
import {
  listSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  blacklistSuggestion,
  onSuggestionsNew,
  getPreferences,
  upsertPreferences,
  deletePreference
} from '../store/preferenceActions'

const { TabPane } = Tabs

const CATEGORY_OPTIONS = ['水泥', '掺合料', '细骨料', '粗骨料', '外加剂']
const DIMENSION_OPTIONS = ['种类', '厂家', '性能']
const METHOD_OPTIONS = ['体积法', '质量法']

// 客户端序列化：与主进程 AgentMdParser.formatToMarkdown 行为一致
// "我的规则" tab 修改非偏好字段（回复风格/工作流程/自定义知识）时用此函数重新计算 raw
function formatToMarkdownClient(parsed) {
  const parts = [`---\nversion: ${parsed.version || 2}\n---\n\n# 我的智能助手规则\n`]

  if (parsed.replyStyle && Object.keys(parsed.replyStyle).length > 0) {
    parts.push('\n## 回复风格\n')
    for (const [k, v] of Object.entries(parsed.replyStyle)) {
      parts.push(`- ${k}: ${v}\n`)
    }
  }

  parts.push('\n## 专业偏好\n\n```yaml\n')
  const mats = (parsed.professionalPrefs && parsed.professionalPrefs.materials) || []
  for (const m of mats) {
    const parts2 = Object.entries(m).map(([k, v]) => {
      let valStr
      if (Array.isArray(v)) valStr = `[${v.join(', ')}]`
      else valStr = v
      return `${k}: ${valStr}`
    })
    parts.push(`  - { ${parts2.join(', ')} }\n`)
  }
  const method = parsed.professionalPrefs && parsed.professionalPrefs.method
  if (method) parts.push(`method: ${method}\n`)
  parts.push('```\n')

  if (parsed.ignoredSuggestionTypes && parsed.ignoredSuggestionTypes.length > 0) {
    parts.push('\n## 已忽略的建议类型\n')
    for (const t of parsed.ignoredSuggestionTypes) parts.push(`- ${t}\n`)
  }

  if (parsed.workflow && parsed.workflow.length > 0) {
    parts.push('\n## 工作流程\n')
    parsed.workflow.forEach((item, i) => parts.push(`${i + 1}. ${item}\n`))
  }

  if (parsed.customKnowledge && parsed.customKnowledge.length > 0) {
    parts.push('\n## 自定义知识\n')
    parsed.customKnowledge.forEach(item => parts.push(`- ${item}\n`))
  }

  for (const [title, body] of Object.entries(parsed.unknownSections || {})) {
    parts.push(`\n## ${title}\n${body}\n`)
  }
  return parts.join('')
}

const AgentRulesModal = ({ visible, onClose }) => {
  const [activeTab, setActiveTab] = useState('my-rules')
  const [rules, setRules] = useState(null)
  const [raw, setRaw] = useState('')
  const [loading, setLoading] = useState(false)

  // 偏好建议
  const [suggestions, setSuggestions] = useState([])
  const [suggestionBadge, setSuggestionBadge] = useState(0)

  // 偏好表单（新增/编辑）
  const [editingIndex, setEditingIndex] = useState(-1)
  const [form] = Form.useForm()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await loadAgentMd()
      if (res.success) {
        setRules(res.data.parsed)
        setRaw(res.data.raw)
      } else {
        message.error('加载失败：' + res.error)
      }
      const sRes = await listSuggestions()
      if (sRes.success) {
        setSuggestions(sRes.suggestions || [])
        setSuggestionBadge((sRes.suggestions || []).length)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) loadData()
  }, [visible, loadData])

  // 订阅建议推送
  useEffect(() => {
    if (!visible) return
    const id = onSuggestionsNew(({ suggestions: list }) => {
      setSuggestions(list)
      setSuggestionBadge(list.length)
    })
    return () => {
      if (id) window.electronAPI.removeListener(id)
    }
  }, [visible])

  // ===== 偏好建议操作 =====
  async function handleAccept(id) {
    try {
      const res = await acceptSuggestion(id)
      if (res.success) {
        message.success('已采纳，偏好已写入 agent.md')
        await loadData()
      } else {
        message.error('采纳失败：' + res.error)
      }
    } catch (err) {
      message.error('操作失败：网络异常')
    }
  }
  async function handleDismiss(id) {
    try {
      const res = await dismissSuggestion(id)
      if (res.success) {
        message.info('已忽略')
        await loadData()
      } else {
        message.error('忽略失败：' + res.error)
      }
    } catch (err) {
      message.error('操作失败：网络异常')
    }
  }
  async function handleBlacklist(id, type) {
    try {
      const res = await blacklistSuggestion(id, type)
      if (res.success) {
        message.success('已加入黑名单，此类建议不再提示')
        await loadData()
      } else {
        message.error('操作失败：' + res.error)
      }
    } catch (err) {
      message.error('操作失败：网络异常')
    }
  }

  // ===== 偏好编辑 =====
  const materials = (rules && rules.professionalPrefs && rules.professionalPrefs.materials) || []
  const method = rules && rules.professionalPrefs && rules.professionalPrefs.method

  async function persistPrefs(newMaterials, newMethod) {
    try {
      const res = await upsertPreferences(newMaterials, newMethod)
      if (res.success) {
        message.success('偏好已保存')
        await loadData()
      } else {
        message.error('保存失败：' + res.error)
      }
    } catch (err) {
      message.error('操作失败：网络异常')
    }
  }

  async function handleAddPreference() {
    form.resetFields()
    form.setFieldsValue({ category: '水泥', dimension: '厂家', value: '' })
    setEditingIndex(-2) // -2 表示新增
  }

  async function handleEditPreference(index) {
    const m = materials[index]
    form.setFieldsValue({
      category: m.category,
      dimension: m.dimension,
      value: m.value || '',
      metric: m.metric || ''
    })
    setEditingIndex(index)
  }

  async function handleDeletePreference(index) {
    try {
      const res = await deletePreference(index)
      if (res.success) {
        message.success('已删除')
        await loadData()
      } else {
        message.error('删除失败：' + res.error)
      }
    } catch (err) {
      message.error('操作失败：网络异常')
    }
  }

  async function handleSaveForm() {
    try {
      const values = await form.validateFields()
      const newItem = { category: values.category, dimension: values.dimension }
      if (values.dimension === '性能') newItem.metric = values.metric
      if (Array.isArray(values.value)) {
        newItem.values = values.value
      } else {
        newItem.value = values.value
      }
      let newMats
      if (editingIndex === -2) {
        newMats = [...materials, newItem]
      } else {
        newMats = [...materials]
        newMats[editingIndex] = newItem
      }
      await persistPrefs(newMats, method)
      setEditingIndex(-1)
    } catch (err) {
      // 校验失败不处理
    }
  }

  async function handleMethodChange(newMethod) {
    await persistPrefs(materials, newMethod)
  }

  // ===== 文件 tab =====
  // 修改非偏好字段（回复风格/工作流程/自定义知识）时同步 raw
  // 选材偏好 / 设计方法偏好走独立 IPC，不走 raw
  function applyRules(next) {
    setRules(next)
    setRaw(formatToMarkdownClient(next))
  }

  async function handleOpenExternal() {
    try {
      const res = await window.electronAPI.shell.openAgentMd()
      if (res && res.success === false) message.error('打开失败：' + res.error)
    } catch (err) {
      message.info('请在文件管理器中打开 ~/.concrete-mixdesign/agent.md')
    }
  }

  // "我的规则" tab 修改非偏好字段（回复风格/工作流程/自定义知识）后用此保存
  async function handleSaveRaw() {
    try {
      const res = await saveAgentMd(raw)
      if (res.success) {
        message.success('已保存')
        await loadData()
      } else {
        message.error('保存失败：' + res.error)
      }
    } catch (err) {
      message.error('操作失败：网络异常')
    }
  }

  if (!rules) {
    return (
      <Modal title="智能助手规则" open={visible} onCancel={onClose} footer={null} width={720}>
        <div style={{ padding: 16 }}>加载中...</div>
      </Modal>
    )
  }

  return (
    <Modal
      title="智能助手规则"
      open={visible}
      onCancel={onClose}
      width={720}
      footer={activeTab === 'my-rules' ? [
        <Button key="cancel" onClick={onClose}>关闭</Button>,
        <Button key="save" type="primary" loading={loading} onClick={handleSaveRaw}>保存</Button>
      ] : [
        <Button key="cancel" onClick={onClose}>关闭</Button>
      ]}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        {/* 我的规则 tab */}
        <TabPane tab="我的规则" key="my-rules">
          <div style={{ padding: 16, maxHeight: 480, overflowY: 'auto' }}>
            <h3>📝 回复风格</h3>
            <div style={{ marginBottom: 12 }}>
              <span style={{ marginRight: 8 }}>语气：</span>
              <Select
                value={rules.replyStyle?.['语气'] || '专业但亲切'}
                onChange={v => applyRules({ ...rules, replyStyle: { ...rules.replyStyle, '语气': v } })}
                style={{ width: 200 }}
                options={['专业但亲切', '严谨专业', '轻松随意'].map(v => ({ value: v, label: v }))}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ marginRight: 8 }}>称呼：</span>
              <Input
                value={rules.replyStyle?.['称呼'] || ''}
                onChange={e => applyRules({ ...rules, replyStyle: { ...rules.replyStyle, '称呼': e.target.value } })}
                style={{ width: 200 }}
                placeholder="如：王工"
              />
            </div>

            <h3>🔧 选材偏好</h3>
            {materials.length === 0 && <p style={{ color: '#999' }}>暂无偏好。AI 会在观察后通过"偏好建议" tab 推荐。</p>}
            {materials.map((m, i) => (
              <Card key={i} size="small" style={{ marginBottom: 8 }} extra={
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleEditPreference(i)}>编辑</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeletePreference(i)}>删除</Button>
                </Space>
              }>
                <p><b>{m.category}</b> / {m.dimension}{m.metric ? ` / ${m.metric}` : ''}</p>
                <p>{Array.isArray(m.values) ? m.values.map(v => <Tag key={v}>{v}</Tag>) : m.value}</p>
              </Card>
            ))}
            <Button onClick={handleAddPreference} icon={<PlusOutlined />} type="dashed" size="small">+ 添加偏好</Button>

            {editingIndex !== -1 && (
              <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 4 }}>
                <Form form={form} layout="vertical">
                  <Form.Item name="category" label="材料类别" rules={[{ required: true }]}>
                    <Select options={CATEGORY_OPTIONS.map(v => ({ value: v, label: v }))} />
                  </Form.Item>
                  <Form.Item name="dimension" label="偏好维度" rules={[{ required: true }]}>
                    <Radio.Group options={DIMENSION_OPTIONS.map(v => ({ value: v, label: v }))} />
                  </Form.Item>
                  <Form.Item shouldUpdate={(p, c) => p.dimension !== c.dimension}>
                    {({ getFieldValue }) => (
                      getFieldValue('dimension') === '性能' ? (
                        <Form.Item name="metric" label="性能指标" rules={[{ required: true }]}>
                          <Input placeholder="如：细度模数" />
                        </Form.Item>
                      ) : null
                    )}
                  </Form.Item>
                  <Form.Item name="value" label="偏好值" rules={[{ required: true }]}>
                    <Select mode="tags" placeholder="输入值后回车；多值用 Tag" />
                  </Form.Item>
                  <Space>
                    <Button type="primary" onClick={handleSaveForm}>保存</Button>
                    <Button onClick={() => setEditingIndex(-1)}>取消</Button>
                  </Space>
                </Form>
              </div>
            )}

            <h3 style={{ marginTop: 16 }}>📐 设计方法偏好</h3>
            <Radio.Group
              value={method || '体积法'}
              onChange={e => handleMethodChange(e.target.value)}
              options={METHOD_OPTIONS.map(v => ({ value: v, label: v }))}
            />

            <h3 style={{ marginTop: 16 }}>📋 工作流程</h3>
            {(rules.workflow || []).map((step, i) => (
              <div key={i} style={{ display: 'flex', marginBottom: 8, alignItems: 'center' }}>
                <span style={{ width: 24 }}>{i + 1}.</span>
                <Input
                  value={step}
                  onChange={e => {
                    const wf = [...(rules.workflow || [])]
                    wf[i] = e.target.value
                    applyRules({ ...rules, workflow: wf })
                  }}
                  style={{ flex: 1, marginRight: 8 }}
                />
                <Button size="small" onClick={() => {
                  applyRules({ ...rules, workflow: (rules.workflow || []).filter((_, idx) => idx !== i) })
                }}>×</Button>
              </div>
            ))}
            <Button onClick={() => applyRules({ ...rules, workflow: [...(rules.workflow || []), ''] })} size="small" type="dashed">+ 添加步骤</Button>

            <h3 style={{ marginTop: 16 }}>📚 自定义知识</h3>
            <Input.TextArea
              value={(rules.customKnowledge || []).join('\n')}
              onChange={e => applyRules({ ...rules, customKnowledge: e.target.value.split('\n').filter(s => s.trim()) })}
              rows={4}
              placeholder="一行一条知识"
            />
          </div>
        </TabPane>

        {/* 偏好建议 tab */}
        <TabPane tab={`偏好建议 (${suggestionBadge})`} key="suggestions">
          <div style={{ padding: 16, maxHeight: 480, overflowY: 'auto' }}>
            {suggestions.length === 0 ? (
              <Empty description="暂无新建议。AI 正在观察您的设计习惯（已观察 X 次任务）..." />
            ) : (
              suggestions.map(s => (
                <Card key={s.id} size="small" style={{ marginBottom: 12 }} title={s.title}>
                  <p style={{ color: '#666' }}>{s.reason}</p>
                  <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12 }}>
                    {JSON.stringify(s.proposedYaml, null, 2)}
                  </pre>
                  <Space>
                    <Button type="primary" onClick={() => handleAccept(s.id)}>✅ 采纳</Button>
                    <Button onClick={() => handleDismiss(s.id)}>❌ 忽略</Button>
                    <Button danger onClick={() => handleBlacklist(s.id, s.type)}>🚫 永不提示此类</Button>
                  </Space>
                </Card>
              ))
            )}
          </div>
        </TabPane>

        {/* 文件 tab */}
        <TabPane tab="文件" key="file">
          <div style={{ padding: 16 }}>
            <Space style={{ marginBottom: 12 }}>
              <Button onClick={handleOpenExternal}>在外部编辑器打开</Button>
              <Button onClick={async () => {
                const res = await reloadAgentMd()
                if (res.success) {
                  setRaw(res.data.raw)
                  setRules(res.data.parsed)
                  message.success('已刷新')
                } else {
                  message.error('刷新失败：' + res.error)
                }
              }}>刷新</Button>
            </Space>
            <Input.TextArea
              value={raw}
              readOnly
              rows={20}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <p style={{ color: '#999', marginTop: 8, fontSize: 12 }}>
              只读视图。修改后请用"刷新"按钮重新加载（外部编辑器保存后，缓存 1s 内自动同步）。
            </p>
          </div>
        </TabPane>
      </Tabs>
    </Modal>
  )
}

export default AgentRulesModal
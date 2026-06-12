import React, { useState, useEffect } from 'react'
import { Modal, Tabs, Button, message, Select, Input, Space } from 'antd'
import { loadAgentMd, saveAgentMd, reloadAgentMd } from '../store/agentRulesActions'

const { TabPane } = Tabs

// 客户端 Markdown 序列化（与服务端 AgentMdParser.formatToMarkdown 行为一致）
function formatToMarkdownClient(parsed) {
  const parts = [`---\nversion: ${parsed.version || 1}\n---\n\n# 我的智能助手规则\n`]

  if (parsed.replyStyle && Object.keys(parsed.replyStyle).length > 0) {
    parts.push('\n## 回复风格\n')
    for (const [k, v] of Object.entries(parsed.replyStyle)) {
      parts.push(`- ${k}: ${v}\n`)
    }
  }

  if (parsed.professionalPrefs && Object.keys(parsed.professionalPrefs).length > 0) {
    parts.push('\n## 专业偏好\n')
    for (const [k, v] of Object.entries(parsed.professionalPrefs)) {
      parts.push(`- ${k}: ${v}\n`)
    }
  }

  if (parsed.workflow && parsed.workflow.length > 0) {
    parts.push('\n## 工作流程\n')
    parsed.workflow.forEach((item, i) => {
      parts.push(`${i + 1}. ${item}\n`)
    })
  }

  if (parsed.customKnowledge && parsed.customKnowledge.length > 0) {
    parts.push('\n## 自定义知识\n')
    parsed.customKnowledge.forEach(item => {
      parts.push(`- ${item}\n`)
    })
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

  useEffect(() => {
    if (visible) {
      loadData()
    }
  }, [visible])

  async function loadData() {
    setLoading(true)
    try {
      const res = await loadAgentMd()
      if (res.success) {
        setRules(res.data.parsed)
        setRaw(res.data.raw)
      } else {
        message.error('加载失败：' + res.error)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    try {
      const res = await saveAgentMd(raw)
      if (res.success) {
        message.success('已保存')
        onClose()
      } else {
        message.error('保存失败：' + res.error)
      }
    } finally {
      setLoading(false)
    }
  }

  // ===== 表单 helpers =====
  function updateField(category, key, value) {
    const next = {
      ...rules,
      [category]: { ...(rules[category] || {}), [key]: value }
    }
    setRules(next)
    setRaw(formatToMarkdownClient(next))
  }

  function updateWorkflow(i, value) {
    const wf = [...(rules.workflow || [])]
    wf[i] = value
    const next = { ...rules, workflow: wf }
    setRules(next)
    setRaw(formatToMarkdownClient(next))
  }

  function addWorkflow() {
    const next = { ...rules, workflow: [...(rules.workflow || []), ''] }
    setRules(next)
    setRaw(formatToMarkdownClient(next))
  }

  function removeWorkflow(i) {
    const next = { ...rules, workflow: (rules.workflow || []).filter((_, idx) => idx !== i) }
    setRules(next)
    setRaw(formatToMarkdownClient(next))
  }

  function updateCustomKnowledge(arr) {
    const next = { ...rules, customKnowledge: arr }
    setRules(next)
    setRaw(formatToMarkdownClient(next))
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
      footer={[
        <Button key="reset" onClick={loadData}>重置</Button>,
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="save" type="primary" loading={loading} onClick={handleSave}>保存</Button>
      ]}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="我的规则" key="my-rules">
          <div style={{ padding: 16, maxHeight: 480, overflowY: 'auto' }}>
            <h3>📝 回复风格</h3>
            <div style={{ marginBottom: 12 }}>
              <span style={{ marginRight: 8 }}>语气：</span>
              <Select
                value={rules.replyStyle?.['语气'] || '专业但亲切'}
                onChange={v => updateField('replyStyle', '语气', v)}
                style={{ width: 200 }}
                options={[
                  { value: '专业但亲切', label: '专业但亲切' },
                  { value: '严谨专业', label: '严谨专业' },
                  { value: '轻松随意', label: '轻松随意' }
                ]}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ marginRight: 8 }}>称呼：</span>
              <Input
                value={rules.replyStyle?.['称呼'] || ''}
                onChange={e => updateField('replyStyle', '称呼', e.target.value)}
                style={{ width: 200 }}
                placeholder="如：王工"
              />
            </div>

            <h3>🔧 专业偏好</h3>
            <div style={{ marginBottom: 12 }}>
              <span style={{ marginRight: 8 }}>默认强度：</span>
              <Select
                value={rules.professionalPrefs?.['默认强度'] || 'C30'}
                onChange={v => updateField('professionalPrefs', '默认强度', v)}
                style={{ width: 200 }}
                options={['C25', 'C30', 'C35', 'C40', 'C45', 'C50'].map(v => ({ value: v, label: v }))}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <span style={{ marginRight: 8 }}>常用水泥：</span>
              <Select
                value={rules.professionalPrefs?.['常用水泥'] || 'P.O 42.5'}
                onChange={v => updateField('professionalPrefs', '常用水泥', v)}
                style={{ width: 200 }}
                options={['P.O 42.5', 'P.O 52.5', 'P.II 42.5'].map(v => ({ value: v, label: v }))}
              />
            </div>

            <h3>📋 工作流程</h3>
            {(rules.workflow || []).map((step, i) => (
              <div key={i} style={{ display: 'flex', marginBottom: 8, alignItems: 'center' }}>
                <span style={{ width: 24 }}>{i + 1}.</span>
                <Input
                  value={step}
                  onChange={e => updateWorkflow(i, e.target.value)}
                  style={{ flex: 1, marginRight: 8 }}
                />
                <Button size="small" onClick={() => removeWorkflow(i)}>×</Button>
              </div>
            ))}
            <Button onClick={addWorkflow} size="small" type="dashed">+ 添加步骤</Button>

            <h3 style={{ marginTop: 16 }}>📚 自定义知识</h3>
            <Input.TextArea
              value={(rules.customKnowledge || []).join('\n')}
              onChange={e => updateCustomKnowledge(e.target.value.split('\n').filter(s => s.trim()))}
              rows={4}
              placeholder="一行一条知识"
            />
          </div>
        </TabPane>
        <TabPane tab="文件" key="file">
          {/* Task 13 实现文件模式 */}
          <div style={{ padding: 16, color: '#999' }}>文件模式（Task 13 实现）</div>
        </TabPane>
      </Tabs>
    </Modal>
  )
}

export default AgentRulesModal

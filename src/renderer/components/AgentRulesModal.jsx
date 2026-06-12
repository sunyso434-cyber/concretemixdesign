import React, { useState, useEffect } from 'react'
import { Modal, Tabs, Button, message } from 'antd'
import { loadAgentMd, saveAgentMd } from '../store/agentRulesActions'

const { TabPane } = Tabs

/**
 * 智能助手规则 Modal
 *
 * 老板砍掉 AI 建议功能,只保留两个 Tab:
 *   - 我的规则: Task 12 实现的表单编辑器
 *   - 文件:      Task 13 实现的文件模式(Markdown 编辑器)
 */
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
          {/* Task 12 实现完整表单 */}
          <div style={{ padding: 16, color: '#999' }}>表单编辑器（Task 12 实现）</div>
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

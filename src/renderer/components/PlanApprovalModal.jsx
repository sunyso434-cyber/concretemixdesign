import React, { useState } from 'react'
import { Modal, Button, Input, Space, Typography, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'

const { Text } = Typography

/**
 * PlanApprovalModal — AI 计划审批弹窗（阶段 3 任务 3.3）
 *
 * 触发：LLM 调 todo_manage(action='create_plan') 后，主进程把计划标记为 pendingApproval，
 * 经 todo:updated 事件（payload.pendingApproval=true）推给前端，前端据此挂起本弹窗，
 * 让用户【确认】【修改（编辑步骤）】【取消】后再执行。
 *
 * 三个按钮路径（不复用 ask_user 表单——它只有确认/取消两键，撑不起步骤编辑）：
 * - 确认：IPC todo:confirm-plan → 主进程 approve_plan（清除 pendingApproval，计划生效）
 * - 修改：进入编辑模式删/加/改步骤 → IPC todo:replace-plan（steps=编辑后数组）→ 主进程 replace_plan
 * - 取消：IPC todo:clear → 主进程 clear（清空计划）
 *
 * Props:
 * - open: 是否显示
 * - sessionId: 当前会话 ID（IPC 必须）
 * - steps: 待审批的计划步骤数组（每步含 id / content / suggestedSkill 等）
 * - onClose: 任意按钮操作完成后的关闭回调
 */
const PlanApprovalModal = ({ open, sessionId, steps = [], onClose }) => {
  const [editing, setEditing] = useState(false)
  const [editingSteps, setEditingSteps] = useState([])
  const [submitting, setSubmitting] = useState(false)

  // 进入编辑模式：拷贝一份步骤（保留 id，供 replace_plan 保留原 id）
  const enterEdit = () => {
    setEditingSteps(steps.map(s => ({
      id: s.id,
      content: s.content || '',
      suggestedSkill: s.suggestedSkill || ''
    })))
    setEditing(true)
  }

  // 【确认】：approve_plan 清除 pendingApproval，计划按原样生效
  const handleConfirm = async () => {
    if (!sessionId) return
    setSubmitting(true)
    try {
      await window.electronAPI.todo.confirmPlan(sessionId)
      onClose()
    } catch (e) {
      message.error('确认计划失败: ' + (e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  // 【取消】：清空计划（todo_manage clear），不执行
  const handleCancel = async () => {
    if (!sessionId) return
    setSubmitting(true)
    try {
      await window.electronAPI.todo.clear(sessionId)
      onClose()
    } catch (e) {
      message.error('取消计划失败: ' + (e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  // 【保存修改】：编辑后的数组经 todo:replace-plan 回传主进程清空重建
  const handleSaveEdit = async () => {
    if (!sessionId) return
    const cleaned = editingSteps
      .map(s => ({
        id: s.id,
        content: (s.content || '').trim(),
        suggestedSkill: (s.suggestedSkill || '').trim() || undefined
      }))
      .filter(s => s.content.length > 0)
    if (cleaned.length === 0) {
      message.warning('计划至少需要一个步骤')
      return
    }
    setSubmitting(true)
    try {
      await window.electronAPI.todo.replacePlan(sessionId, cleaned)
      onClose()
    } catch (e) {
      message.error('保存修改失败: ' + (e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  const updateRow = (idx, patch) => {
    setEditingSteps(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const removeRow = (idx) => {
    setEditingSteps(prev => prev.filter((_, i) => i !== idx))
  }

  const addRow = () => {
    setEditingSteps(prev => [
      ...prev,
      { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content: '', suggestedSkill: '' }
    ])
  }

  return (
    <Modal
      open={open}
      title="AI 计划审批"
      width={560}
      closable={false}
      maskClosable={false}
      keyboard={false}
      transitionName=""
      maskTransitionName=""
      footer={null}
    >
      {!editing ? (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            以下步骤由 AI 规划，确认后开始执行，或修改后按新计划执行：
          </Text>
          <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
            {steps.map((s, i) => (
              <div
                key={s.id || i}
                style={{
                  padding: '8px 10px',
                  border: '1px solid var(--color-border, #eee)',
                  borderRadius: 6,
                  marginBottom: 8,
                  background: 'var(--color-bg-secondary, #fafafa)'
                }}
              >
                <Text style={{ fontWeight: 500 }}>
                  {i + 1}. {s.content}
                </Text>
                {s.suggestedSkill && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary, #999)' }}>
                    建议技能：{s.suggestedSkill}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button type="primary" onClick={handleConfirm} loading={submitting}>确认</Button>
            <Button onClick={enterEdit}>修改计划</Button>
            <Button danger onClick={handleCancel} loading={submitting}>取消</Button>
          </Space>
        </>
      ) : (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            编辑步骤：可直接修改内容 / 建议技能，删除多余步骤，或添加新步骤。
          </Text>
          <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
            {editingSteps.map((s, i) => (
              <div
                key={s.id || i}
                style={{ border: '1px solid var(--color-border, #eee)', borderRadius: 6, padding: 8, marginBottom: 8, background: '#fff' }}
              >
                <Space.Compact style={{ width: '100%', marginBottom: 6 }}>
                  <Input
                    value={s.content}
                    placeholder="步骤内容"
                    onChange={(e) => updateRow(i, { content: e.target.value })}
                  />
                  <Button
                    icon={<DeleteOutlined />}
                    onClick={() => removeRow(i)}
                    aria-label={`删除步骤${i + 1}`}
                  />
                </Space.Compact>
                <Input
                  value={s.suggestedSkill || ''}
                  placeholder="建议技能（可空）"
                  onChange={(e) => updateRow(i, { suggestedSkill: e.target.value })}
                  size="small"
                />
              </div>
            ))}
          </div>
          <Button type="dashed" icon={<PlusOutlined />} onClick={addRow} block style={{ marginBottom: 16 }}>
            添加步骤
          </Button>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button type="primary" onClick={handleSaveEdit} loading={submitting}>保存修改</Button>
            <Button onClick={() => setEditing(false)}>返回</Button>
          </Space>
        </>
      )}
    </Modal>
  )
}

export default PlanApprovalModal

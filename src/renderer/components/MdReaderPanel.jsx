import React, { useDeferredValue } from 'react'
import { Tabs, Button, Empty, Alert, Spin, Space } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileMarkdownOutlined, EditOutlined, CloseOutlined, RightOutlined } from '@ant-design/icons'

export default function MdReaderPanel({
  state, panelWidth,
  onClose, onSelect, onCollapse, onToggleEdit, onDraftChange, onConflictResolve, onResize
}) {
  const active = state.tabs.find(t => t.key === state.activeKey)
  const content = state.contents[state.activeKey]
  const draft = state.drafts[state.activeKey]
  const deferredContent = useDeferredValue(content || '')

  // 拖拽分隔条（面板左边缘）
  const startDrag = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth
    const move = (ev) => onResize(startWidth + (startX - ev.clientX))
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const items = state.tabs.map(t => ({
    key: t.key,
    label: (
      <span className="md-reader-tab-label">
        {t.conflict && <span className="md-reader-conflict-dot" />}
        <FileMarkdownOutlined /> {t.title}
      </span>
    ),
    children: null
  }))

  return (
    <div className="md-reader-panel" style={{ width: panelWidth, flex: `0 0 ${panelWidth}px` }}>
      <div className="md-reader-divider" onMouseDown={startDrag} />
      <div className="md-reader-header">
        <Tabs
          type="editable-card"
          size="small"
          items={items}
          activeKey={state.activeKey}
          onChange={onSelect}
          onEdit={(key, action) => action === 'remove' && onClose(key)}
          hideAdd
        />
        <Space className="md-reader-header-actions">
          {active?.mode === 'edit' && (
            <Button size="small" icon={<RightOutlined />} onClick={() => onToggleEdit(active.key)}>预览</Button>
          )}
          {active?.mode === 'preview' && !active.readOnly && (
            <Button size="small" icon={<EditOutlined />} onClick={() => onToggleEdit(active.key)}>编辑</Button>
          )}
          <Button size="small" icon={<CloseOutlined />} onClick={onCollapse} title="收起阅读器">收起</Button>
        </Space>
      </div>

      {active?.conflict === 'external-change' && (
        <div className="md-reader-notice">
          <Alert
            type="warning" showIcon message="文件已被外部修改"
            action={
              <Space>
                <Button size="small" type="primary" onClick={() => onConflictResolve(active.key, 'reload')}>载入最新</Button>
                <Button size="small" onClick={() => onConflictResolve(active.key, 'keep')}>保留我的修改</Button>
              </Space>
            }
          />
        </div>
      )}
      {active?.conflict === 'save-failed' && (
        <div className="md-reader-notice">
          <Alert type="error" showIcon message="保存失败"
            action={<Button size="small" type="primary" onClick={() => onConflictResolve(active.key, 'retry')}>重试</Button>} />
        </div>
      )}
      {active?.mode === 'edit' && state.noticeKey === active.key && active.conflict !== 'external-change' && (
        <div className="md-reader-notice">
          <Alert type="warning" showIcon message="文件已被外部修改"
            action={<Button size="small" onClick={() => onConflictResolve(active.key, 'reload')}>点击刷新</Button>} />
        </div>
      )}
      {active?.mode === 'edit' && active?.dirty === false && active?.conflict === null && state.noticeKey !== active.key && (
        <div className="md-reader-notice"><Alert type="info" showIcon message="编辑中，修改自动保存" /></div>
      )}

      <div className="md-reader-body">
        {!active && <Empty description="无打开的文档" />}
        {active?.status === 'loading' && <div className="md-reader-loading"><Spin /></div>}
        {active?.status === 'error' && (
          <Alert type="error" showIcon message={active.error || '读取失败'} />
        )}
        {active?.status === 'done' && active.mode === 'preview' && (
          <div className="chat-markdown-body md-reader-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredContent}</ReactMarkdown>
          </div>
        )}
        {active?.status === 'done' && active.mode === 'edit' && (
          <textarea
            className="md-reader-editor"
            value={draft}
            onChange={(e) => onDraftChange(active.key, e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}

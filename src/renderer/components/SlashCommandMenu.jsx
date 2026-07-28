import React, { useState, useEffect, useRef } from 'react'
import { List, Typography } from 'antd'
import { ToolOutlined } from '@ant-design/icons'

const { Text } = Typography

const CATEGORY_ICONS = { system: <ToolOutlined /> }

const SlashCommandMenu = ({
  visible,
  input,
  cursorPos,
  allCommandNames,
  onSelect,
  onClose,
  position,
  menuApiRef
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef(null)
  const internalRef = useRef({ moveSelection: () => {}, getSelectedIndex: () => 0, selectCurrent: () => false })
  // 用 ref 持有最新的 onSelect/candidates，避免 useEffect 频繁重建 internalRef.current
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const beforeCursor = (input || '').slice(0, cursorPos || 0)
  const lastSpaceIdx = beforeCursor.lastIndexOf(' ')
  const cmdSegment = lastSpaceIdx === -1 ? beforeCursor : beforeCursor.slice(lastSpaceIdx + 1)

  const candidates = (allCommandNames || []).filter(name => {
    const fullCmd = `/${name}`
    return fullCmd.startsWith(cmdSegment) || fullCmd === cmdSegment
  })

  useEffect(() => {
    internalRef.current.moveSelection = (delta) => {
      setSelectedIndex(prev => {
        const next = prev + delta
        if (next < 0) return 0
        if (next >= candidates.length) return candidates.length - 1
        return next
      })
    }
    internalRef.current.getSelectedIndex = () => selectedIndex
    // 选中当前候选项：调用父组件 onSelect；返回 false 表示无候选可选（让父组件走默认行为）
    internalRef.current.selectCurrent = () => {
      if (candidates.length === 0) return false
      const idx = Math.min(selectedIndex, candidates.length - 1)
      onSelectRef.current(candidates[idx])
      return true
    }
    if (menuApiRef) menuApiRef.current = internalRef.current
  }, [candidates.length, selectedIndex, menuApiRef])

  const isExactMatch = candidates.length === 1 && `/${candidates[0]}` === cmdSegment
  const isCompleteCommand = isExactMatch || candidates.length === 0
  const isInProgress = cmdSegment.length > 1 && candidates.length > 1

  let statusHint = ''
  if (candidates.length === 0 && cmdSegment.length > 1) {
    statusHint = '⚠ 无匹配命令'
  } else if (isCompleteCommand) {
    statusHint = '✓ 完整命令，回车执行'
  } else if (isInProgress) {
    statusHint = '请继续输入或按 Tab 补全'
  } else {
    statusHint = '请选择命令'
  }

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  useEffect(() => {
    if (visible) setSelectedIndex(0)
  }, [visible, cmdSegment])

  if (!visible || candidates.length === 0) return null

  return (
    <div ref={menuRef} className="slash-command-menu" style={{
      position: 'absolute',
      bottom: position?.bottom || 80,
      left: position?.left || 16,
      right: position?.right || 16,
      background: '#fff',
      borderRadius: 8,
      boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
      zIndex: 1000,
      maxHeight: 400,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0', fontSize: 12, color: '#666' }}>
        {statusHint}
      </div>
      <List size="small" style={{ overflow: 'auto', flex: 1 }} dataSource={candidates}
        renderItem={(name, index) => (
          <List.Item key={name} style={{
            padding: '8px 12px',
            cursor: 'pointer',
            background: index === selectedIndex ? '#f5f5f5' : 'transparent',
            transition: 'background 0.2s'
          }}
          onClick={() => onSelect(name)}
          onMouseEnter={() => setSelectedIndex(index)}>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
              <div style={{ fontSize: 16, color: '#1890ff', width: 24, textAlign: 'center' }}>
                {CATEGORY_ICONS.system}
              </div>
              <Text strong style={{ fontSize: 13 }}>/{name}</Text>
            </div>
          </List.Item>
        )}
      />
      <div style={{ padding: '4px 12px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>↑↓ 导动 · Tab 补全 · Enter 选择 · Esc 关闭</Text>
      </div>
    </div>
  )
}

export default SlashCommandMenu

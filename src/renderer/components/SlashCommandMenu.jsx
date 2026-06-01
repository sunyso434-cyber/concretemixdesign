import React, { useState, useEffect, useRef } from 'react'
import { List, Tag, Typography, Input } from 'antd'
import {
  ToolOutlined,
  CalculatorOutlined,
  SearchOutlined,
  SaveOutlined,
  DollarOutlined,
  ExperimentOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  SafetyOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'

const { Text } = Typography

// 技能分类图标
const CATEGORY_ICONS = {
  core: <CalculatorOutlined />,
  query: <SearchOutlined />,
  save: <SaveOutlined />,
  analysis: <ExperimentOutlined />,
  system: <SettingOutlined />,
  custom: <ToolOutlined />
}

// 技能分类颜色
const CATEGORY_COLORS = {
  core: 'blue',
  query: 'green',
  save: 'orange',
  analysis: 'purple',
  system: 'default',
  custom: 'cyan'
}

// 技能分类中文名
const CATEGORY_NAMES = {
  core: '核心',
  query: '查询',
  save: '保存',
  analysis: '分析',
  system: '系统',
  custom: '自定义'
}

/**
 * 斜杠命令菜单组件
 */
const SlashCommandMenu = ({ visible, skills, onSelect, onClose, position }) => {
  const [searchText, setSearchText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef(null)

  // 过滤技能
  const filteredSkills = skills.filter(skill =>
    skill.name.toLowerCase().includes(searchText.toLowerCase()) ||
    skill.description.toLowerCase().includes(searchText.toLowerCase())
  )

  // 键盘导航
  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredSkills.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredSkills[selectedIndex]) {
          onSelect(filteredSkills[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, filteredSkills, selectedIndex, onSelect, onClose])

  // 重置状态
  useEffect(() => {
    if (visible) {
      setSearchText('')
      setSelectedIndex(0)
    }
  }, [visible])

  if (!visible || filteredSkills.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="slash-command-menu"
      style={{
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
      }}
    >
      {/* 搜索框 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
        <Input
          placeholder="搜索技能..."
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value)
            setSelectedIndex(0)
          }}
          size="small"
          autoFocus
          prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
        />
      </div>

      {/* 技能列表 */}
      <List
        size="small"
        style={{ overflow: 'auto', flex: 1 }}
        dataSource={filteredSkills}
        renderItem={(skill, index) => (
          <List.Item
            key={skill.name}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              background: index === selectedIndex ? '#f5f5f5' : 'transparent',
              transition: 'background 0.2s'
            }}
            onClick={() => onSelect(skill)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
              <div style={{ fontSize: 16, color: '#1890ff', width: 24, textAlign: 'center' }}>
                {CATEGORY_ICONS[skill.category] || <ToolOutlined />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ fontSize: 13 }}>/{skill.name}</Text>
                  <Tag color={CATEGORY_COLORS[skill.category]} style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px' }}>
                    {CATEGORY_NAMES[skill.category] || skill.category}
                  </Tag>
                  {skill.builtin === false && (
                    <Tag color="gold" style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px' }}>自定义</Tag>
                  )}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: skill.description }}>
                  {skill.description}
                </Text>
              </div>
            </div>
          </List.Item>
        )}
      />

      {/* 底部提示 */}
      <div style={{ padding: '4px 12px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          ↑↓ 导动 · Enter 选择 · Esc 关闭
        </Text>
      </div>
    </div>
  )
}

export default SlashCommandMenu

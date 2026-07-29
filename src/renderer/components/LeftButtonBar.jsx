import React from 'react'
import { Tooltip } from 'antd'
import { DatabaseOutlined, AppstoreOutlined, SettingOutlined, MessageOutlined, ExperimentOutlined } from '@ant-design/icons'

/**
 * LeftButtonBar - 最左侧竖排按钮区（微信风格）
 * 从下向上依次：系统设置、方案管理、原材料管理
 * 顶部固定一个聊天主界面按钮
 *
 * Props:
 * @param {string} activeView - 当前激活视图：'chat' | 'materials' | 'schemes' | 'settings'
 * @param {Function} onSelect - 切换视图回调 (view) => void
 */
const LeftButtonBar = ({ activeView, onSelect }) => {
  // 从下向上排列：系统设置（最下）、方案管理、原材料管理
  // 顶部：聊天主界面
  const items = [
    { key: 'chat', icon: <MessageOutlined />, label: '聊天', placement: 'right' },
    { key: 'materials', icon: <DatabaseOutlined />, label: '原材料管理', placement: 'right' },
    { key: 'schemes', icon: <AppstoreOutlined />, label: '方案管理', placement: 'right' },
    { key: 'trial-records', icon: <ExperimentOutlined />, label: '试配记录', placement: 'right' },
    { key: 'settings', icon: <SettingOutlined />, label: '系统设置', placement: 'right' },
  ]

  return (
    <div className="left-button-bar">
      {items.map(item => (
        <Tooltip key={item.key} title={item.label} placement={item.placement}>
          <button
            className={`left-button-bar-item ${activeView === item.key ? 'active' : ''}`}
            onClick={() => onSelect?.(item.key)}
            type="button"
          >
            {item.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

export default LeftButtonBar

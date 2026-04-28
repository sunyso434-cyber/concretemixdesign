import React from 'react'

export default function WorkspaceTabs({ tabs, activeKey, onChange, readonly }) {
  return (
    <div className="workspace-tabs">
      {tabs.map(tab => {
        const isActive = tab.key === activeKey
        if (readonly) {
          return (
            <span key={tab.key} className="workspace-tab-label">
              {tab.label}
            </span>
          )
        }
        return (
          <button
            key={tab.key}
            className={`workspace-tab ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

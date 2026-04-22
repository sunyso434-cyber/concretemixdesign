import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './NavRail.css'

const navItems = [
  { key: 'materials', path: '/materials', label: '原材料管理', icon: '📦' },
  { key: 'mixdesign', path: '/mixdesign', label: '配合比设计', icon: '📝' },
  { key: 'optimization', path: '/optimization', label: '成本优化', icon: '🎯' },
  { key: 'inverse-calculation', path: '/inverse-calculation', label: '参数反算', icon: '🔢' },
  { key: 'mass-concrete', path: '/mass-concrete', label: '大体积混凝土', icon: '🧊' },
  { key: 'schemes', path: '/schemes', label: '方案管理', icon: '📋' },
  { key: 'settings', path: '/settings', label: '系统管理', icon: '⚙️' },
]

function NavRail() {
  const [isExpanded, setIsExpanded] = useState(false)
  const location = useLocation()

  const isActive = (path) => location.pathname === path

  return (
    <nav
      className={`nav-rail ${isExpanded ? 'expanded' : ''}`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div className="nav-rail-inner">
        {navItems.map((item) => (
          <Link
            key={item.key}
            to={item.path}
            className={`nav-rail-item ${isActive(item.path) ? 'active' : ''}`}
          >
            <span className="nav-rail-icon">{item.icon}</span>
            <span className="nav-rail-label">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}

export default NavRail
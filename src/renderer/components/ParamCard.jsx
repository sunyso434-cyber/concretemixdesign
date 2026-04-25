// src/renderer/components/ParamCard.jsx
import React, { useState, useEffect } from 'react'
import { Slider, InputNumber, Select, Switch, Input, Typography } from 'antd'

const { Text } = Typography

/**
 * 单个参数卡片组件
 * @param {string} paramName - 参数代码名称
 * @param {object} config - paramConfig 中对应的配置对象
 * @param {any} value - 当前值
 * @param {Function} onChange - 值变化回调 (value) => void
 */
const ParamCard = ({ paramName, config, value, onChange }) => {
  const { label, type, min, max, step, unit, options, description } = config
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (newVal) => {
    setLocalValue(newVal)
    onChange(newVal)
  }

  const renderControl = () => {
    switch (type) {
      case 'range':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Slider
              min={min}
              max={max}
              step={step}
              value={localValue}
              onChange={handleChange}
              tooltip={{ formatter: (v) => `${v}${unit}` }}
              style={{ flex: 1 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <InputNumber
                min={min}
                max={max}
                step={step}
                value={localValue}
                onChange={handleChange}
                style={{ width: 80 }}
              />
              <Text type="secondary">{unit}</Text>
            </div>
          </div>
        )
      case 'select':
        return (
          <Select
            value={localValue}
            onChange={handleChange}
            style={{ width: 200 }}
            options={options}
          />
        )
      case 'switch':
        return (
          <Switch checked={localValue === 'true' || localValue === true} onChange={handleChange} />
        )
      case 'input':
        return (
          <Input.Password
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="请输入"
            style={{ width: 300 }}
          />
        )
      default:
        return <Text>{localValue}</Text>
    }
  }

  return (
    <div style={{
      background: '#fafafa',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <Text strong style={{ fontSize: 15 }}>{label}</Text>
          {description && (
            <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
              {description}
            </Text>
          )}
        </div>
      </div>
      {renderControl()}
      {type === 'range' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>最小: {min}{unit}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>最大: {max}{unit}</Text>
        </div>
      )}
    </div>
  )
}

export default ParamCard
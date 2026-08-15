/**
 * @component ContextIndicator - 22px 圆环按钮
 *
 * 视觉：
 * - 22px × 22px 圆形按钮
 * - percent < 0.5 不渲染（不占位）
 * - 白色描边圆环 + 蓝色填充环（#1890ff），>= 80% 变红（#ff4d4f）
 * - 从 12 点（top）方向开始顺时针填充
 * - 鼠标悬停显示 tooltip（已使用 N%；>= 80% 时追加"建议压缩"）
 * - loading 状态：禁用点击 + 半透明 + 显示旋转图标
 *
 * Props:
 * - percent: number（0-1 范围，内部 clamp）
 * - loading: boolean
 * - onClick: function
 *
 * 纯逻辑全部抽到 ContextIndicator.utils.js，本文件只负责 React 渲染。
 * 真实 DOM 渲染测试交给 Task 7 集成测试覆盖。
 */

import React from 'react'
import { Tooltip } from 'antd'

import {
  BUTTON_DIAMETER,
  STROKE_WIDTH,
  RADIUS,
  CIRCUMFERENCE,
  getIndicatorVisibility,
  getIndicatorColor,
  getIndicatorDashOffset,
  getIndicatorTooltip,
  getIndicatorButtonProps,
  clampPercent
} from './ContextIndicator.utils'

const ContextIndicator = ({ percent = 0, loading = false, onClick = () => {}, usedTokens, limitTokens }) => {
  // 老板约束：< 50% 不渲染
  if (getIndicatorVisibility(percent) === 'hidden') return null

  const safePercent = clampPercent(percent)
  const strokeColor = getIndicatorColor(safePercent)
  const dashOffset = getIndicatorDashOffset(safePercent, CIRCUMFERENCE)
  const tooltipText = getIndicatorTooltip(safePercent, usedTokens, limitTokens)
  const buttonProps = getIndicatorButtonProps(safePercent, loading, onClick)

  return (
    <Tooltip title={tooltipText} placement="top">
      <button
        type="button"
        aria-label={tooltipText}
        title={tooltipText}
        {...buttonProps}
        style={{
          width: BUTTON_DIAMETER,
          height: BUTTON_DIAMETER,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: loading ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: loading ? 0.5 : 1,
          position: 'relative'
        }}
      >
        <svg
          width={BUTTON_DIAMETER}
          height={BUTTON_DIAMETER}
          viewBox={`0 0 ${BUTTON_DIAMETER} ${BUTTON_DIAMETER}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          {/* 背景描边圆 */}
          <circle
            cx={BUTTON_DIAMETER / 2}
            cy={BUTTON_DIAMETER / 2}
            r={RADIUS}
            fill="none"
            stroke="rgba(115,115,115,0.12)"
            strokeWidth={STROKE_WIDTH}
          />
          {/* 填充进度环 */}
          <circle
            cx={BUTTON_DIAMETER / 2}
            cy={BUTTON_DIAMETER / 2}
            r={RADIUS}
            fill="none"
            stroke={strokeColor}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
          />
        </svg>
        {loading && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              width: 8,
              height: 8,
              border: '1.5px solid #4B3FE3',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'context-spin 0.8s linear infinite'
            }}
          />
        )}
      </button>
    </Tooltip>
  )
}

export default ContextIndicator

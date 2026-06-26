/**
 * ContextIndicator 纯逻辑函数（无 React 依赖）
 *
 * 提供给 ContextIndicator.jsx 调用，全部函数都是纯函数，
 * 便于 jest 在 node 环境下直接 require 测试，无需 jsdom。
 *
 * 设计要点：
 * - v8.4.1：圆环一直显示，不区分 50%（老板约束 — 让用户始终能看到上下文占用进度）
 * - 红色阈值 >= 80%（提示压缩）
 * - percent 超出 [0, 1] 自动 clamp
 */

// ============== 常量 ==============

export const BUTTON_DIAMETER = 22
export const STROKE_WIDTH = 2
export const RADIUS = (BUTTON_DIAMETER - STROKE_WIDTH) / 2  // = 10
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS          // ≈ 62.8319

export const RED_THRESHOLD = 0.8

export const COLOR_BLUE = '#1890ff'
export const COLOR_RED = '#ff4d4f'

// ============== 工具函数 ==============

/**
 * clamp percent 到 [0, 1]
 */
export function clampPercent(percent) {
  if (typeof percent !== 'number' || Number.isNaN(percent)) return 0
  return Math.min(1, Math.max(0, percent))
}

/**
 * 是否应该渲染组件
 * @returns {'visible'}  v8.4.1: 圆环一直显示，不区分 50%
 */
export function getIndicatorVisibility(_percent) {
  return 'visible'
}

/**
 * 根据 percent 返回填充环颜色
 * @returns {string} '#1890ff' 或 '#ff4d4f'
 */
export function getIndicatorColor(percent) {
  const safe = clampPercent(percent)
  return safe >= RED_THRESHOLD ? COLOR_RED : COLOR_BLUE
}

/**
 * 计算 SVG stroke-dashoffset
 * dashoffset = circumference * (1 - clampedPercent)
 * 当 percent=1 时返回 0（满环），percent=0 时返回 circumference（空白）
 *
 * @param {number} percent 原始百分比（会被 clamp）
 * @param {number} circumference 圆周长（由调用方提供，便于复用）
 * @returns {number}
 */
export function getIndicatorDashOffset(percent, circumference) {
  const safe = clampPercent(percent)
  return circumference * (1 - safe)
}

/**
 * 生成 tooltip 文案
 * - < 80%："已使用 N%"
 * - >= 80%："已使用 N%（建议压缩）"
 *
 * @returns {string}
 */
export function getIndicatorTooltip(percent) {
  const safe = clampPercent(percent)
  const pct = Math.round(safe * 100)
  if (safe >= RED_THRESHOLD) {
    return `已使用 ${pct}%（建议压缩）`
  }
  return `已使用 ${pct}%`
}

/**
 * 计算 <button> 的 props（onClick / disabled）
 * - loading=true 时：disabled=true，onClick 是 noop（即便被 fire 也不调用外部回调）
 * - loading=false 时：disabled=false，onClick 透传
 *
 * 真实 DOM 点击事件的 e2e 测试交给集成测试覆盖；这里只负责返回正确的 props。
 *
 * @returns {{ disabled: boolean, onClick: function }}
 */
export function getIndicatorButtonProps(percent, loading, onClick) {
  const safeOnClick = typeof onClick === 'function' ? onClick : () => {}
  if (loading) {
    return {
      disabled: true,
      onClick: () => {}  // noop：即便调用也不触发
    }
  }
  return {
    disabled: false,
    onClick: safeOnClick
  }
}

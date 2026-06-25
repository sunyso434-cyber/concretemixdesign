/**
 * ContextIndicator 纯函数测试
 *
 * 覆盖（来自 Task 6 brief）：
 * - percent < 0.5 不渲染（visible='hidden'）
 * - percent = 0.5 渲染（visible='visible'）
 * - 0.5-0.8 蓝色（#1890ff）
 * - >= 0.8 红色（#ff4d4f）
 * - percent > 1 clamp 到 1，dashoffset = 0
 * - loading 时禁用点击（buttonProps.disabled = true）
 * - tooltip 显示正确百分比（已使用 N%）
 * - 红色 tooltip 包含"建议压缩"
 *
 * 注：点击触发 onClick 的测试跳过——utils 测按钮属性（disabled），
 *    真实点击事件交给 Task 7 集成测试或 e2e 覆盖。
 *
 * 跑法：npx jest src/renderer/components/__tests__/ContextIndicator.utils.test.js
 */

const {
  VISIBILITY_THRESHOLD,
  RED_THRESHOLD,
  getIndicatorVisibility,
  getIndicatorColor,
  getIndicatorDashOffset,
  getIndicatorTooltip,
  getIndicatorButtonProps,
  CIRCUMFERENCE,
  BUTTON_DIAMETER
} = require('../ContextIndicator.utils')

describe('ContextIndicator.utils', () => {
  describe('常量', () => {
    test('BUTTON_DIAMETER = 22', () => {
      expect(BUTTON_DIAMETER).toBe(22)
    })

    test('VISIBILITY_THRESHOLD = 0.5（< 50% 不渲染）', () => {
      expect(VISIBILITY_THRESHOLD).toBe(0.5)
    })

    test('RED_THRESHOLD = 0.8（>= 80% 变红）', () => {
      expect(RED_THRESHOLD).toBe(0.8)
    })

    test('CIRCUMFERENCE 约等于 62.8（r=10, 2πr）', () => {
      // 2 * Math.PI * 10 ≈ 62.8318
      expect(CIRCUMFERENCE).toBeCloseTo(62.8, 1)
    })
  })

  describe('getIndicatorVisibility', () => {
    test('percent < 0.5 返回 hidden', () => {
      expect(getIndicatorVisibility(0.3)).toBe('hidden')
      expect(getIndicatorVisibility(0)).toBe('hidden')
      expect(getIndicatorVisibility(0.49)).toBe('hidden')
    })

    test('percent >= 0.5 返回 visible', () => {
      expect(getIndicatorVisibility(0.5)).toBe('visible')
      expect(getIndicatorVisibility(0.65)).toBe('visible')
      expect(getIndicatorVisibility(0.85)).toBe('visible')
      expect(getIndicatorVisibility(1)).toBe('visible')
    })
  })

  describe('getIndicatorColor', () => {
    test('percent 在 [0.5, 0.8) 之间是蓝色 #1890ff', () => {
      expect(getIndicatorColor(0.5)).toBe('#1890ff')
      expect(getIndicatorColor(0.6)).toBe('#1890ff')
      expect(getIndicatorColor(0.79)).toBe('#1890ff')
    })

    test('percent >= 0.8 是红色 #ff4d4f', () => {
      expect(getIndicatorColor(0.8)).toBe('#ff4d4f')
      expect(getIndicatorColor(0.85)).toBe('#ff4d4f')
      expect(getIndicatorColor(1)).toBe('#ff4d4f')
    })

    test('percent > 1 仍按 clamp 后判断（>= 0.8 → 红）', () => {
      expect(getIndicatorColor(1.5)).toBe('#ff4d4f')
    })
  })

  describe('getIndicatorDashOffset', () => {
    test('percent = 1 时 dashoffset = 0（满）', () => {
      expect(getIndicatorDashOffset(1, 62.8)).toBeCloseTo(0, 5)
    })

    test('percent > 1 clamp 到 1，dashoffset = 0', () => {
      // brief 测试：percent = 1.5, circumference = 62.8
      expect(getIndicatorDashOffset(1.5, 62.8)).toBe(0)
    })

    test('percent = 0.5 时 dashoffset = 0.5 * circumference', () => {
      // 半填充：dashoffset = circumference * (1 - 0.5) = circumference * 0.5
      const expected = 62.8 * 0.5
      expect(getIndicatorDashOffset(0.5, 62.8)).toBeCloseTo(expected, 5)
    })

    test('percent = 0 时 dashoffset = circumference（空白）', () => {
      expect(getIndicatorDashOffset(0, 62.8)).toBeCloseTo(62.8, 5)
    })

    test('percent < 0 clamp 到 0', () => {
      expect(getIndicatorDashOffset(-0.5, 62.8)).toBeCloseTo(62.8, 5)
    })
  })

  describe('getIndicatorTooltip', () => {
    test('蓝色档显示"已使用 N%"', () => {
      expect(getIndicatorTooltip(0.65)).toBe('已使用 65%')
      expect(getIndicatorTooltip(0.5)).toBe('已使用 50%')
      expect(getIndicatorTooltip(0.79)).toBe('已使用 79%')
    })

    test('红色档（>= 80%）显示"已使用 N%（建议压缩）"', () => {
      expect(getIndicatorTooltip(0.85)).toBe('已使用 85%（建议压缩）')
      expect(getIndicatorTooltip(0.8)).toBe('已使用 80%（建议压缩）')
      expect(getIndicatorTooltip(1)).toBe('已使用 100%（建议压缩）')
    })

    test('红色档 tooltip 必须包含"建议压缩"', () => {
      expect(getIndicatorTooltip(0.85)).toMatch(/建议压缩/)
    })
  })

  describe('getIndicatorButtonProps', () => {
    test('loading=true 时 disabled=true, onClick 被吞掉', () => {
      const onClick = jest.fn()
      const props = getIndicatorButtonProps(0.7, true, onClick)
      expect(props.disabled).toBe(true)
      // loading 时点击不应调用 onClick
      props.onClick()
      expect(onClick).not.toHaveBeenCalled()
    })

    test('loading=false 时 disabled=false, onClick 透传', () => {
      const onClick = jest.fn()
      const props = getIndicatorButtonProps(0.7, false, onClick)
      expect(props.disabled).toBe(false)
      props.onClick()
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    test('loading=true 时 props.onClick 是 noop（即使被 fire）', () => {
      // 验证 brief "loading 时禁用点击"：返回的 onClick 调用不应触发外部
      const onClick = jest.fn()
      const props = getIndicatorButtonProps(0.85, true, onClick)
      props.onClick()
      props.onClick()
      expect(onClick).not.toHaveBeenCalled()
    })
  })
})

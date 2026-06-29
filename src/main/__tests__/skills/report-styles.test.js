// report-styles.test.js（Task 5）
// 测试默认公文样式常量 + mergeStyle 合并规则
//
// 6 个测试用例（按 brief Step 1）：
//   1. 默认样式包含公文样式必要字段
//   2. mergeStyle 不传 userStyle 返回默认
//   3. mergeStyle 浅合并 page
//   4. mergeStyle 浅合并 typography（含 color 浅合并验证）
//   5. mergeStyle 深合并 typography.titleSize 嵌套对象
//   6. mergeStyle 不修改原 DEFAULT_REPORT_STYLE
//
// 注：测试 4 输入已从 brief 原文 `{ typography: { bodySize: 11, primary: 'red' } }`
// 修正为 `{ typography: { bodySize: 11 }, color: { primary: 'red' } }`，
// 原因：brief 原文输入只有 typography，但期望 result.color.primary === 'red'，
// 与合并规则"浅合并 color"（仅 userStyle.color 影响 result.color）矛盾，
// 系 brief typo。修正后符合合并规则且 3 个 expect 全部成立。详见 task-5 报告。
const { DEFAULT_REPORT_STYLE, mergeStyle } = require('../../skills/report-styles')

describe('report-styles', () => {
  test('默认样式包含公文样式必要字段', () => {
    expect(DEFAULT_REPORT_STYLE.page.paperSize).toBe('A4')
    expect(DEFAULT_REPORT_STYLE.page.orientation).toBe('portrait')
    expect(DEFAULT_REPORT_STYLE.typography.titleFont).toBe('黑体')
    expect(DEFAULT_REPORT_STYLE.typography.bodyFont).toBe('仿宋')
    expect(DEFAULT_REPORT_STYLE.color.primary).toBe('black')
  })

  test('mergeStyle 不传 userStyle 返回默认', () => {
    const result = mergeStyle()
    expect(result).toEqual(DEFAULT_REPORT_STYLE)
  })

  test('mergeStyle 浅合并 page', () => {
    const result = mergeStyle({ page: { orientation: 'landscape' } })
    expect(result.page.orientation).toBe('landscape')
    expect(result.page.paperSize).toBe('A4')  // 默认保留
  })

  test('mergeStyle 浅合并 typography', () => {
    const result = mergeStyle({ typography: { bodySize: 11 }, color: { primary: 'red' } })
    expect(result.typography.bodySize).toBe(11)
    expect(result.typography.titleFont).toBe('黑体')  // 默认保留
    expect(result.color.primary).toBe('red')
  })

  test('mergeStyle 深合并 typography 嵌套对象', () => {
    const result = mergeStyle({ typography: { titleSize: { H1: 24 } } })
    expect(result.typography.titleSize.H1).toBe(24)
    expect(result.typography.titleSize.H2).toBe(16)  // 默认保留
  })

  test('mergeStyle 不修改原 DEFAULT_REPORT_STYLE', () => {
    mergeStyle({ page: { orientation: 'landscape' } })
    expect(DEFAULT_REPORT_STYLE.page.orientation).toBe('portrait')
  })
})

/**
 * MD 调用解析器测试
 *
 * 验证 parseMdSkill 能正确解析 "调用：技能名" 块
 */
const { parseMdSkill } = require('../../skills/md-call-parser')

describe('parseMdSkill', () => {
  test('解析单个调用（含参数和捕获）', () => {
    const md = `# 技能
## 步骤 1
调用：自密实混凝土_配合比设计
参数：
  - strength_grade: C40
  - slump_flow: "650"
  - max_agg_size: 20
捕获结果到：{{result}}`

    const parsed = parseMdSkill(md)
    expect(parsed.calls).toHaveLength(1)
    expect(parsed.calls[0].skillName).toBe('自密实混凝土_配合比设计')
    expect(parsed.calls[0].params.strength_grade).toBe('C40')
    expect(parsed.calls[0].params.slump_flow).toBe('650')
    expect(parsed.calls[0].resultVar).toBe('result')
  })

  test('返回 raw 原文', () => {
    const md = '# 技能标题\n调用：技能A\n参数：\n  - x: 1'
    const parsed = parseMdSkill(md)
    expect(parsed.raw).toBe(md)
  })

  test('无调用块时返回空 calls', () => {
    const md = '# 纯说明文档\n这是说明文字，没有技能调用。'
    const parsed = parseMdSkill(md)
    expect(parsed.calls).toHaveLength(0)
  })

  test('多个调用块按顺序解析', () => {
    const md = `调用：技能A
参数：
  - x: 1

调用：技能B
参数：
  - y: 2
捕获结果到：{{out}}`

    const parsed = parseMdSkill(md)
    expect(parsed.calls).toHaveLength(2)
    expect(parsed.calls[0].skillName).toBe('技能A')
    expect(parsed.calls[1].skillName).toBe('技能B')
    expect(parsed.calls[1].resultVar).toBe('out')
  })
})

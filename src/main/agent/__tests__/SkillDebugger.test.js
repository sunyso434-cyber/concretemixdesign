/**
 * SkillDebugger 单测
 *
 * F2.4 任务：验证 P0-3 修复已生效。
 *
 * P0-3 修复内容（B2.1, commit 8c7890a）：
 * - 旧实现：SkillDebugger.previewInstruction 内部 new AgentOrchestrator()
 *   才能拿到 _buildMDInstruction 方法 —— 高耦合 + 重对象开销。
 * - 新实现：抽出 mdInstructionBuilder 纯函数，SkillDebugger 直接调用。
 *
 * 关键调整（相对于任务模板）：
 * - skill mock 必须带 _isMDSkill: true，否则走 "不是MD技能" 分支
 * - 返回结构是 { success, data: { instruction } }，instruction 嵌套在 data 内
 * - `debugger` 是 JS 严格模式保留字，变量名改为 dbg
 */

const SkillDebugger = require('../SkillDebugger')

describe('SkillDebugger', () => {
  test('F2-debug-01: previewInstruction 不再 new AgentOrchestrator', () => {
    const dbg = new SkillDebugger({
      deepseekService: {},
      skillRegistry: {
        getSkill: () => ({
          name: 's',
          description: '测试技能',
          _isMDSkill: true,
          _mdBody: '{{x}}',
          _placeholders: ['x']
        })
      },
      skillExecutor: {}
    })

    // 验证：preview 应不抛错且输出含替换后的值
    const result = dbg.previewInstruction('s', { x: 'test_value' })
    expect(result.success).toBe(true)
    expect(result.data.instruction).toContain('test_value')

    // 验证：debugger 不持有 agentOrchestrator 实例（P0-3 修复核心）
    expect(dbg._agentOrchestrator).toBeUndefined()
    expect(dbg.agentOrchestrator).toBeUndefined()
  })

  test('技能不存在时返回 success=false', () => {
    const dbg = new SkillDebugger({
      deepseekService: {},
      skillRegistry: { getSkill: () => null },
      skillExecutor: {}
    })

    const result = dbg.previewInstruction('not_exist', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('不存在')
  })

  test('非 MD 技能返回 success=false', () => {
    const dbg = new SkillDebugger({
      deepseekService: {},
      skillRegistry: {
        getSkill: () => ({ name: 'native_skill', _isMDSkill: false })
      },
      skillExecutor: {}
    })

    const result = dbg.previewInstruction('native_skill', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('不是MD技能')
  })
})

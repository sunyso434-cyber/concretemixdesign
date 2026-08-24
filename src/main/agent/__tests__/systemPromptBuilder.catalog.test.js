/**
 * systemPromptBuilder catalog 渲染单元测试（技能目录式路由 · T5）
 *
 * - renderMode 缺省/'full'：输出与旧版结构一致（回归保障）
 * - renderMode='catalog'：常驻段 / 目录段（按类别分组）/ 使用规则 三小节
 */

const { buildSystemPrompt } = require('../systemPromptBuilder')

// 构造带 resident 标记的 skillInfos（UnifiedStrategy 生产注入形态）
const SKILL_INFOS = [
  { name: 'ask_user', category: 'agent', description: '向老板提问澄清需求。', resident: true },
  { name: 'todo_manage', category: 'agent', description: '管理任务清单。', resident: true },
  { name: 'workspace_search', category: 'workspace', description: '搜索 wiki 页。', resident: true },
  { name: 'calculate_mix_design', category: 'tool', description: '计算混凝土配合比，支持 JGJ55 与自定义规范。', resident: false },
  { name: 'manage_materials', category: 'manage', description: '管理原材料台账，支持增删改查。', resident: false },
  { name: 'save_sales_quote', category: 'manage', description: '保存报价单到方案库。', resident: false }
]

describe('buildSystemPrompt renderMode=full（默认旧行为）', () => {
  test('缺省 renderMode 输出与旧版一致：按类别分组 + 「按类别分组」字样', () => {
    const prompt = buildSystemPrompt({ skillInfos: SKILL_INFOS })
    expect(prompt).toContain('# 当前可用技能')
    expect(prompt).toContain('（共 6 个，按类别分组）')
    expect(prompt).toContain('- ask_user：')
    // 常驻/目录分段不应出现
    expect(prompt).not.toContain('## 技能目录')
    expect(prompt).not.toContain('## 常驻工具')
  })

  test("renderMode='full' 显式传入同样走旧渲染", () => {
    const prompt = buildSystemPrompt({ skillInfos: SKILL_INFOS, renderMode: 'full' })
    expect(prompt).toContain('（共 6 个，按类别分组）')
    expect(prompt).not.toContain('## 技能使用规则')
  })
})

describe("buildSystemPrompt renderMode='catalog'", () => {
  test('三小节齐全：常驻清单只含 resident 项；目录只含非 resident 项并按类别分组', () => {
    const prompt = buildSystemPrompt({ skillInfos: SKILL_INFOS, renderMode: 'catalog' })

    expect(prompt).toContain('## 常驻工具（共 3 个，可直接调用）')
    expect(prompt).toContain('- ask_user：')
    expect(prompt).toContain('- workspace_search：')

    expect(prompt).toContain('## 技能目录（共 3 个，调用前必须先用 use_skill 加载）')
    expect(prompt).toContain('【tool】')
    expect(prompt).toContain('- calculate_mix_design：')
    expect(prompt).toContain('【manage】')
    expect(prompt).toContain('- manage_materials：')
    expect(prompt).toContain('- save_sales_quote：')

    // 常驻项不得混入目录段
    const catalogPart = prompt.split('## 技能目录')[1].split('## 技能使用规则')[0]
    expect(catalogPart).not.toContain('ask_user')
    expect(catalogPart).not.toContain('workspace_search')
  })

  test('使用规则段落包含 use_skill 引导与拦截说明', () => {
    const prompt = buildSystemPrompt({ skillInfos: SKILL_INFOS, renderMode: 'catalog' })
    expect(prompt).toContain('## 技能使用规则')
    expect(prompt).toContain("use_skill(name='技能名')")
    expect(prompt).toContain('needs_reload:true')
    expect(prompt).toContain('禁止猜测未加载技能的参数')
  })

  test('全部为常驻时目录为空有兜底文案', () => {
    const allResident = SKILL_INFOS.map(s => ({ ...s, resident: true }))
    const prompt = buildSystemPrompt({ skillInfos: allResident, renderMode: 'catalog' })
    expect(prompt).toContain('（目录为空，全部技能均为常驻工具）')
  })

  test('skillInfos 为空时 catalog 模式安全降级为名字列表兜底路径', () => {
    const prompt = buildSystemPrompt({ skillNames: ['only_one'], renderMode: 'catalog' })
    expect(prompt).toContain('- only_one')
    expect(prompt).not.toContain('undefined')
  })
})

/**
 * 蓝图技能创建端到端集成测试
 *
 * 覆盖闭环：
 *   主 agent system prompt（路由提示）
 *      ↓
 *   prepare_blueprint_authoring（读 md 注入对话）
 *      ↓
 *   主 agent 基于对话上下文 + guide 生成 rawBlueprint（本测试模拟这一步）
 *      ↓
 *   create_skill(format='blueprint', rawBlueprint=...)（校验 → 试算 → 落盘）
 *
 * 断言点：
 * 1. buildSystemPrompt 输出中包含蓝图路由提示
 * 2. prepare_blueprint_authoring 能读到 md 且内容非空
 * 3. 用返回 guide 中的示例蓝图去调 create_skill，能成功落盘
 * 4. 若不传 rawBlueprint，create_skill 返回引导先调 prepare 的错误
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

jest.mock('../../ipcHandlers/agentHandler', () => {
  const mockRegistry = {
    _skills: new Map(),
    discover: jest.fn().mockResolvedValue(undefined),
    size: 0
  }
  return { getSkillRegistry: () => mockRegistry }
})

const { buildSystemPrompt, BLUEPRINT_AUTHORING_ROUTE } = require('../../agent/systemPromptBuilder')
const prepareSkill = require('../../skills/prepare-blueprint-authoring')
const createSkill = require('../../skills/create-skill')

describe('蓝图技能创建端到端闭环', () => {
  let tmpHome
  let origConfigDir

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-e2e-'))
    jest.spyOn(os, 'homedir').mockReturnValue(tmpHome)
    origConfigDir = process.env.CONCRETE_CONFIG_DIR
    process.env.CONCRETE_CONFIG_DIR = tmpHome
  })

  afterEach(() => {
    os.homedir.mockRestore()
    if (origConfigDir === undefined) delete process.env.CONCRETE_CONFIG_DIR
    else process.env.CONCRETE_CONFIG_DIR = origConfigDir
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true })
    }
    jest.restoreAllMocks()
  })

  const _ctx = () => ({
    sessionId: 'e2e-session',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  })

  test('第1步：系统 prompt 包含蓝图路由提示，命名了 prepare_blueprint_authoring 和 create_skill', () => {
    const prompt = buildSystemPrompt({
      memoryContext: '',
      skillNames: ['prepare_blueprint_authoring', 'create_skill', 'manage_skills'],
      agentMdRules: ''
    })

    expect(prompt).toContain('prepare_blueprint_authoring')
    expect(prompt).toContain('create_skill')
    expect(prompt).toContain(BLUEPRINT_AUTHORING_ROUTE)
    // 引导用户不能跳过 prepare 直接猜蓝图
    expect(prompt).toMatch(/禁止跳过|先调.*prepare/)
    // rawBlueprint 参数被主 agent 感知
    expect(prompt).toContain('rawBlueprint')
  })

  test('第2步：prepare_blueprint_authoring 返回完整创作规范', async () => {
    const result = await prepareSkill.execute({}, _ctx())
    expect(result.success).toBe(true)
    expect(result.type).toBe('blueprint_authoring_guide')
    expect(result.guide.length).toBeGreaterThan(1000)
    // 关键规范：禁自引用
    expect(result.guide).toMatch(/禁止自引用|不得出现在.*expr/)
    // 关键规范：多阶段变量命名（wb_raw → wb_capped → wb_final）
    expect(result.guide).toContain('wb_raw')
    expect(result.guide).toContain('wb_final')
    // 关键规范：分段格式
    expect(result.guide).toContain('=== meta.yaml ===')
    expect(result.guide).toContain('=== blueprint.yaml ===')
  })

  test('第3步：用创作规范内示例蓝图调 create_skill → 完整闭环成功', async () => {
    // 模拟主 agent 完成了以下流程：
    // (a) 调 prepare_blueprint_authoring 拿到 guide
    const prep = await prepareSkill.execute({}, _ctx())
    expect(prep.success).toBe(true)

    // (b) 主 agent 基于对话上下文 + guide 生成蓝图（这里用一个已知合法示例代表 LLM 产出）
    const generatedRawBlueprint = `=== meta.yaml ===
name: "e2e_normal_concrete"
description: "端到端测试普通混凝土"
version: "1.0.0"
parameters:
  - name: strength_grade
    label: "强度等级"
    type: select
    required: true
    options: ["C30", "C40"]
    default: "C30"
=== blueprint.yaml ===
steps:
  - type: input
    var: fcu_k
    from: "strength_grade"
    value_map: { C30: 30, C40: 40 }
    default: 30
  - type: input
    var: sigma
    default: 5.0
  - type: const
    var: alpha_a
    value: 0.53
  - type: const
    var: alpha_b
    value: 0.20
  - type: material
    var: cement_strength
    material_query: { category: "水泥", property: "compressiveStrength28d" }
  - type: formula
    var: fb
    expr: "1.0 * cement_strength"
  - type: formula
    var: fcu_o
    expr: "fcu_k + 1.645 * sigma"
  - type: formula
    var: wb_raw
    expr: "(alpha_a * fb) / (fcu_o + alpha_a * alpha_b * fb)"
  - type: formula
    var: wb_final
    expr: "round(wb_raw * 100) / 100"
  - type: output
    var: wb_final
    name: "水胶比"
    unit: ""
    precision: 3
`

    // (c) 调 create_skill 落盘
    const result = await createSkill.execute(
      {
        skillName: 'e2e_normal_concrete',
        description: '端到端测试普通混凝土',
        format: 'blueprint',
        rawBlueprint: generatedRawBlueprint
      },
      _ctx()
    )

    expect(result.success).toBe(true)
    expect(result.data.format).toBe('blueprint')
    expect(result.data.stepCount).toBe(10)
    expect(result.data.dryRun.success).toBe(true)

    const skillDir = path.join(tmpHome, '.concrete-mixdesign', 'skills', 'e2e_normal_concrete')
    expect(fs.existsSync(path.join(skillDir, 'meta.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'blueprint.yaml'))).toBe(true)
  })

  test('第4步：跳过 prepare 直接调 create_skill（不传 rawBlueprint）→ 明确引导先调 prepare', async () => {
    const result = await createSkill.execute(
      {
        skillName: 'skip_prep_skill',
        description: '跳过prepare',
        format: 'blueprint'
        // rawBlueprint 缺失
      },
      _ctx()
    )

    expect(result.success).toBe(false)
    expect(result.error.recovery).toBe('call_prepare_blueprint_authoring_first')
    expect(result.details.nextAction).toBe('call_prepare_blueprint_authoring')
    // 错误消息告知用户/主 agent 下一步该做什么
    expect(result.details.hint).toMatch(/prepare_blueprint_authoring/)
  })

  test('第5步：主 agent 传入的蓝图违反规范（自引用），create_skill 返回具体错误让主 agent 自修', async () => {
    const badRawBlueprint = `=== meta.yaml ===
name: "bad_e2e"
description: "自引用错误"
version: "1.0.0"
parameters: []
=== blueprint.yaml ===
steps:
  - type: formula
    var: wb
    expr: "wb * 0.9"
`

    const result = await createSkill.execute(
      {
        skillName: 'bad_e2e_skill',
        description: 'bad',
        format: 'blueprint',
        rawBlueprint: badRawBlueprint
      },
      _ctx()
    )

    expect(result.success).toBe(false)
    expect(result.error.recovery).toBe('fix_raw_blueprint')
    // 主 agent 拿到这个错误可以直接从消息里判断出问题所在，无需二次 LLM
    expect(result.details.originalError).toMatch(/自引用.*wb|wb.*自引用/)
  })
})

/**
 * create-skill (format='blueprint') 单元测试
 *
 * 架构变更（v2.0.0）：不再内嵌 LLM 调用，蓝图由主 agent 生成后通过
 * rawBlueprint 参数传入，本技能只做解析、校验、试算、落盘。
 *
 * 覆盖：
 * 1. 成功路径：合法 rawBlueprint → 校验通过 → 试算通过 → 保存到正确目录
 * 2. 缺少 rawBlueprint 参数 → 返回 MISSING_RAW_BLUEPRINT 错误并引导先调 prepare_blueprint_authoring
 * 3. rawBlueprint 分段不完整 → 返回 BLUEPRINT_PARSE_FAILED
 * 4. 蓝图校验失败（如自引用） → 返回 BLUEPRINT_VALIDATE_FAILED 并携带具体报错
 * 5. 保存路径正确（含 tables 数据表）：验证 meta.yaml / blueprint.yaml / tables/*.json 落盘
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

// 屏蔽真实 agentHandler（依赖较重），用 mock 注册表替代
jest.mock('../../ipcHandlers/agentHandler', () => {
  const mockRegistry = {
    _skills: new Map(),
    discover: jest.fn().mockResolvedValue(undefined),
    size: 0
  }
  return { getSkillRegistry: () => mockRegistry }
})

const createSkill = require('../../skills/create-skill')

// ---- 测试用蓝图样例 ----

const VALID_BLUEPRINT_NO_TABLES = `=== meta.yaml ===
name: "test_normal_concrete"
description: "测试普通混凝土配制强度"
version: "1.0.0"
parameters:
  - name: strength_grade
    label: "强度等级"
    type: select
    required: true
    options: ["C30", "C35"]
    default: "C30"
=== blueprint.yaml ===
steps:
  - type: input
    var: fcu_k
    from: "strength_grade"
    value_map: { C30: 30, C35: 35 }
    default: 30
  - type: input
    var: sigma
    default: 5.0
  - type: formula
    var: fcu_o
    expr: "fcu_k + 1.645 * sigma"
  - type: output
    var: fcu_o
    name: "配制强度"
    unit: "MPa"
    precision: 2
`

const INVALID_SELF_REF_BLUEPRINT = `=== meta.yaml ===
name: "bad_skill"
description: "有自引用错误"
version: "1.0.0"
parameters: []
=== blueprint.yaml ===
steps:
  - type: formula
    var: a
    expr: "a + 1"
`

const VALID_BLUEPRINT_WITH_TABLE = `=== meta.yaml ===
name: "test_with_table"
description: "测试带数据表的蓝图"
version: "1.0.0"
parameters:
  - name: slump
    label: "坍落度"
    type: number
    default: 150
=== blueprint.yaml ===
steps:
  - type: input
    var: slump
    from: "slump"
    default: 150
  - type: const
    var: m_wo
    value: 0
  - type: table_lookup
    var: m_wo
    table: "water_table"
    lookup_mode: linear
    keys:
      坍落度: "$slump"
  - type: output
    var: m_wo
    name: "用水量"
    unit: "kg/m³"
    precision: 0
=== tables/water_table.json ===
{
  "name": "water_table",
  "description": "test water table",
  "version": "1.0",
  "dimensions": [{ "name": "坍落度", "unit": "mm", "values": [100, 200] }],
  "data": [[180, 200]],
  "interpolation": "linear"
}
`

const RAW_MISSING_META = `=== blueprint.yaml ===
steps:
  - type: input
    var: x
    default: 1
`

describe('create_skill (format=blueprint)', () => {
  let tmpHome
  let origConfigDir

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bp-'))
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
    sessionId: 'test-session',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  })

  test('成功路径：合法 rawBlueprint → 校验通过 → 试算通过 → 保存成功', async () => {
    const result = await createSkill.execute(
      {
        skillName: 'test_normal_concrete',
        description: '测试普通混凝土',
        functionality: '计算配制强度',
        type: 'tool', subType: 'blueprint',
        rawBlueprint: VALID_BLUEPRINT_NO_TABLES
      },
      _ctx()
    )

    expect(result.success).toBe(true)
    expect(result.data.format).toBe('blueprint')
    expect(result.data.skillName).toBe('test_normal_concrete')
    expect(result.data.dryRun.success).toBe(true)
    expect(result.data.dryRun.results).toBeDefined()

    const skillDir = path.join(tmpHome, '.concrete-mixdesign', 'skills', 'test_normal_concrete')
    expect(fs.existsSync(path.join(skillDir, 'meta.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'blueprint.yaml'))).toBe(true)
  })

  test('缺少 rawBlueprint 时返回 MISSING_RAW_BLUEPRINT 并引导先调 prepare', async () => {
    const result = await createSkill.execute(
      {
        skillName: 'no_raw_skill',
        description: '没传 rawBlueprint',
        type: 'tool', subType: 'blueprint'
      },
      _ctx()
    )

    expect(result.success).toBe(false)
    expect(result.error.recovery).toBe('call_prepare_blueprint_authoring_first')
    expect(result.details.nextAction).toBe('call_prepare_blueprint_authoring')
    expect(result.details.hint).toMatch(/prepare_blueprint_authoring/)
  })

  test('rawBlueprint 为空字符串时同样触发 MISSING_RAW_BLUEPRINT', async () => {
    const result = await createSkill.execute(
      {
        skillName: 'empty_raw',
        description: 'empty',
        type: 'tool', subType: 'blueprint',
        rawBlueprint: '   \n  '
      },
      _ctx()
    )
    expect(result.success).toBe(false)
    expect(result.error.recovery).toBe('call_prepare_blueprint_authoring_first')
  })

  test('rawBlueprint 分段不完整时返回 BLUEPRINT_PARSE_FAILED', async () => {
    const result = await createSkill.execute(
      {
        skillName: 'missing_meta',
        description: '缺 meta 分段',
        type: 'tool', subType: 'blueprint',
        rawBlueprint: RAW_MISSING_META
      },
      _ctx()
    )
    expect(result.success).toBe(false)
    expect(result.error.recovery).toBe('fix_raw_blueprint')
    expect(result.details.originalError).toMatch(/分段|YAML|meta\.yaml/)
  })

  test('校验失败（自引用）返回 BLUEPRINT_VALIDATE_FAILED 并携带具体错误', async () => {
    const result = await createSkill.execute(
      {
        skillName: 'self_ref_skill',
        description: '自引用测试',
        type: 'tool', subType: 'blueprint',
        rawBlueprint: INVALID_SELF_REF_BLUEPRINT
      },
      _ctx()
    )

    expect(result.success).toBe(false)
    expect(result.error.recovery).toBe('fix_raw_blueprint')
    expect(result.details.originalError).toMatch(/自引用/)
    expect(result.details.hint).toMatch(/formula\.var|自引用/)
  })

  test('保存路径正确：含 tables 时 tables/ 子目录与 .json 文件落盘', async () => {
    const result = await createSkill.execute(
      {
        skillName: 'test_with_table',
        description: '带数据表',
        type: 'tool', subType: 'blueprint',
        rawBlueprint: VALID_BLUEPRINT_WITH_TABLE
      },
      _ctx()
    )

    expect(result.success).toBe(true)
    expect(result.data.tableCount).toBe(1)

    const skillDir = path.join(tmpHome, '.concrete-mixdesign', 'skills', 'test_with_table')
    expect(fs.existsSync(path.join(skillDir, 'meta.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'blueprint.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'tables'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'tables', 'water_table.json'))).toBe(true)

    const yaml = require('js-yaml')
    const savedBlueprint = yaml.load(fs.readFileSync(path.join(skillDir, 'blueprint.yaml'), 'utf8'))
    const types = savedBlueprint.steps.map(s => s.type)
    expect(types).toContain('table_lookup')

    const { getSkillRegistry } = require('../../ipcHandlers/agentHandler')
    expect(getSkillRegistry().discover).toHaveBeenCalled()
  })

  test('技能名已存在时返回 NAME_EXISTS', async () => {
    const args = {
      skillName: 'dup_skill',
      description: '重复',
      type: 'tool', subType: 'blueprint',
      rawBlueprint: VALID_BLUEPRINT_NO_TABLES
    }
    const r1 = await createSkill.execute(args, _ctx())
    expect(r1.success).toBe(true)

    const r2 = await createSkill.execute(args, _ctx())
    expect(r2.success).toBe(false)
    // v10.2.0 方案 5：recovery 改为 use_manage_skills_update
    expect(r2.error.recovery).toBe('use_manage_skills_update')
  })

  test('技能定义中新参数 rawBlueprint 已声明', () => {
    expect(createSkill.parameters.rawBlueprint).toBeDefined()
    expect(createSkill.parameters.rawBlueprint.required).toBe(false)
    expect(createSkill.parameters.rawBlueprint.description).toMatch(/blueprint/)
  })

  test('技能不再包含内嵌 LLM 相关方法', () => {
    expect(typeof createSkill._getLLMService).toBe('undefined')
    expect(typeof createSkill._buildBlueprintPrompt).toBe('undefined')
  })
})

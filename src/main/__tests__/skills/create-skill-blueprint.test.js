/**
 * create-skill (format='blueprint') 单元测试
 *
 * 覆盖：
 * 1. 成功路径：LLM 返回合法蓝图 → 校验通过 → 试算通过 → 保存到正确目录
 * 2. 校验失败重试：LLM 第一次返回自引用错误，第二次返回合法蓝图 → 最终成功
 * 3. 保存路径正确（含 tables 数据表）：验证 meta.yaml / blueprint.yaml / tables/*.json 落盘
 *
 * 全程 mock LLM（context.llmService.invoke），不发起真实 API 调用。
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

// ---- 测试用 LLM 输出样例 ----

// 合法的简单蓝图（无 material、无 table_lookup，避免校验器对查表变量预定义的约束）
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

// 自引用错误蓝图（公式 a = a + 1，校验器会拒绝）
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

// 带数据表的合法蓝图（const 预定义变量后再 table_lookup，满足校验器约束）
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

describe('create_skill (format=blueprint)', () => {
  let tmpHome
  let origConfigDir

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bp-'))
    jest.spyOn(os, 'homedir').mockReturnValue(tmpHome)
    // 让 FeatureFlag 在临时目录下读取（不存在 config.yaml → isEnabled 返回 true）
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

  const _ctx = (llmService) => ({
    sessionId: 'test-session',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    llmService
  })

  test('成功路径：合法蓝图 → 校验通过 → 试算通过 → 保存成功', async () => {
    const invoke = jest.fn().mockResolvedValue(VALID_BLUEPRINT_NO_TABLES)
    const result = await createSkill.execute(
      {
        skillName: 'test_normal_concrete',
        description: '测试普通混凝土',
        functionality: '计算配制强度',
        format: 'blueprint'
      },
      _ctx({ invoke })
    )

    expect(result.success).toBe(true)
    expect(result.data.format).toBe('blueprint')
    expect(result.data.skillName).toBe('test_normal_concrete')
    // 只调用一次 LLM（首次即通过校验）
    expect(invoke).toHaveBeenCalledTimes(1)
    // 试算通过
    expect(result.data.dryRun.success).toBe(true)
    expect(result.data.dryRun.results).toBeDefined()
    // 文件落盘
    const skillDir = path.join(tmpHome, '.concrete-mixdesign', 'skills', 'test_normal_concrete')
    expect(fs.existsSync(path.join(skillDir, 'meta.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'blueprint.yaml'))).toBe(true)
  })

  test('校验失败重试：首次自引用错误，第二次合法 → 最终成功', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValueOnce(INVALID_SELF_REF_BLUEPRINT)
      .mockResolvedValueOnce(VALID_BLUEPRINT_NO_TABLES)

    const result = await createSkill.execute(
      {
        skillName: 'retry_skill',
        description: '测试重试',
        functionality: '先错后对',
        format: 'blueprint'
      },
      _ctx({ invoke })
    )

    // 调用两次 LLM
    expect(invoke).toHaveBeenCalledTimes(2)
    // 第二次 prompt 应包含上次错误信息
    const secondPrompt = invoke.mock.calls[1][0]
    expect(secondPrompt).toMatch(/自引用/)
    // 最终成功
    expect(result.success).toBe(true)
    expect(result.data.stepCount).toBe(4)
  })

  test('保存路径正确：含 tables 数据表时 tables/ 子目录与 .json 文件落盘', async () => {
    const invoke = jest.fn().mockResolvedValue(VALID_BLUEPRINT_WITH_TABLE)
    const result = await createSkill.execute(
      {
        skillName: 'test_with_table',
        description: '带数据表',
        functionality: '查表用水量',
        format: 'blueprint'
      },
      _ctx({ invoke })
    )

    expect(result.success).toBe(true)
    expect(result.data.tableCount).toBe(1)

    const skillDir = path.join(tmpHome, '.concrete-mixdesign', 'skills', 'test_with_table')
    expect(fs.existsSync(path.join(skillDir, 'meta.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'blueprint.yaml'))).toBe(true)
    // tables 子目录及 json 文件
    expect(fs.existsSync(path.join(skillDir, 'tables'))).toBe(true)
    expect(fs.existsSync(path.join(skillDir, 'tables', 'water_table.json'))).toBe(true)

    // 验证写入的 blueprint.yaml 可被 js-yaml 解析且包含 table_lookup 步骤
    const yaml = require('js-yaml')
    const savedBlueprint = yaml.load(fs.readFileSync(path.join(skillDir, 'blueprint.yaml'), 'utf8'))
    const types = savedBlueprint.steps.map(s => s.type)
    expect(types).toContain('table_lookup')

    // SkillRegistry.discover 被调用以重新加载
    const { getSkillRegistry } = require('../../ipcHandlers/agentHandler')
    expect(getSkillRegistry().discover).toHaveBeenCalled()
  })

  test('LLM 输出无法解析时返回失败', async () => {
    const invoke = jest.fn().mockResolvedValue('这不是有效的分段输出')
    const result = await createSkill.execute(
      {
        skillName: 'unparseable_skill',
        description: 'LLM 输出乱码',
        format: 'blueprint'
      },
      _ctx({ invoke })
    )

    expect(result.success).toBe(false)
    // 重试 3 次后仍失败
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(result.details.originalError).toMatch(/无法解析/)
  })

  test('未注入 LLM 服务时返回失败（不实例化真实 DeepSeekService）', async () => {
    // context 不含 llmService，且 _getLLMService 会尝试 new DeepSeekService(null, undefined)
    // 该实例无 systemService → _getConfig 走 legacy 分支，apiKey 为空 → invoke 会抛错
    // 此处只验证：未注入时不会因缺服务而崩溃，而是返回结构化失败
    const result = await createSkill.execute(
      {
        skillName: 'no_llm_skill',
        description: '无 LLM',
        format: 'blueprint'
      },
      { sessionId: 's', logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }
    )
    // 无 llmService 时 _getLLMService 会 lazy 实例化 DeepSeekService；
    // 但其 invoke 会因 apiKey 未配置而抛错 → 返回 CREATE_FAILED
    expect(result.success).toBe(false)
  })
})

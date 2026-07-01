/**
 * skill-manager 蓝图技能支持测试
 *
 * 覆盖：
 * 1. list：蓝图技能显示 stepCount / tableCount / llmGenerated
 * 2. info：蓝图技能展示 meta / materialCategories / referencedTables
 * 3. delete：蓝图技能删除前备份到 backups/，再删除整个目录
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

const skillManager = require('../../skills/skill-manager')

// ---- 帮助函数：在临时目录中创建蓝图技能 ----
function createBlueprintSkill(baseDir, skillName, overrides = {}) {
  const skillDir = path.join(baseDir, '.concrete-mixdesign', 'skills', skillName)
  fs.mkdirSync(skillDir, { recursive: true })

  const meta = {
    name: skillName,
    description: overrides.description || `${skillName} 描述`,
    version: '1.0.0',
    generated_by: overrides.llmGenerated ? 'llm' : undefined,
    ...(overrides.metaExtras || {})
  }
  // 清理 undefined 值
  Object.keys(meta).forEach(k => { if (meta[k] === undefined) delete meta[k] })

  const yaml = require('js-yaml')
  fs.writeFileSync(path.join(skillDir, 'meta.yaml'), yaml.dump(meta), 'utf8')

  const steps = overrides.steps || [
    { type: 'input', var: 'x', from: 'x_param', default: 10 },
    { type: 'material', var: 'cement', material_query: { category: '水泥', property: 'strength' } },
    { type: 'table_lookup', var: 'water', table: '用水量-坍落度-最大粒径', lookup_mode: 'bilinear', keys: {} },
    { type: 'formula', var: 'result', expr: 'x + cement' },
    { type: 'output', var: 'result', name: '结果', unit: 'MPa', precision: 2 }
  ]

  const blueprint = { steps }
  fs.writeFileSync(path.join(skillDir, 'blueprint.yaml'), yaml.dump(blueprint), 'utf8')

  // 可选：创建 tables/ 子目录
  if (overrides.tableCount) {
    const tablesDir = path.join(skillDir, 'tables')
    fs.mkdirSync(tablesDir, { recursive: true })
    for (let i = 0; i < overrides.tableCount; i++) {
      fs.writeFileSync(
        path.join(tablesDir, `table_${i}.json`),
        JSON.stringify({ name: `table_${i}`, data: [] }),
        'utf8'
      )
    }
  }

  return skillDir
}

function createJsSkill(baseDir, skillName) {
  const skillDir = path.join(baseDir, '.concrete-mixdesign', 'skills')
  fs.mkdirSync(skillDir, { recursive: true })
  const filePath = path.join(skillDir, `${skillName}.js`)
  fs.writeFileSync(filePath, `module.exports = { name: '${skillName}', description: '${skillName} 描述' }`, 'utf8')
  return filePath
}

describe('skill-manager (蓝图技能支持)', () => {
  let tmpHome

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-bp-'))
    jest.spyOn(os, 'homedir').mockReturnValue(tmpHome)
  })

  afterEach(() => {
    os.homedir.mockRestore()
    if (tmpHome && fs.existsSync(tmpHome)) {
      fs.rmSync(tmpHome, { recursive: true, force: true })
    }
    jest.restoreAllMocks()
  })

  const _ctx = () => ({
    sessionId: 'test-session',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  })

  // ===== list 测试 =====

  test('list：蓝图技能应显示 stepCount / tableCount / llmGenerated', async () => {
    // 创建手写蓝图（无 generated_by → llmGenerated = false）
    createBlueprintSkill(tmpHome, 'test_manual_bp', {
      steps: Array(5).fill({ type: 'const', var: 'x', value: 1 }),
      tableCount: 2
    })

    // 创建 LLM 生成蓝图
    createBlueprintSkill(tmpHome, 'test_llm_bp', {
      llmGenerated: true,
      steps: Array(8).fill({ type: 'const', var: 'y', value: 2 }),
      tableCount: 1
    })

    const result = await skillManager._listSkills(_ctx())

    expect(result.success).toBe(true)
    const skills = result.data.skills
    expect(skills.length).toBe(2)

    // 手写蓝图
    const manualBp = skills.find(s => s.name === 'test_manual_bp')
    expect(manualBp).toBeDefined()
    expect(manualBp.category).toBe('blueprint')
    expect(manualBp.stepCount).toBe(5)
    expect(manualBp.tableCount).toBe(2)
    expect(manualBp.llmGenerated).toBe(false)

    // LLM 生成蓝图
    const llmBp = skills.find(s => s.name === 'test_llm_bp')
    expect(llmBp).toBeDefined()
    expect(llmBp.category).toBe('blueprint')
    expect(llmBp.stepCount).toBe(8)
    expect(llmBp.tableCount).toBe(1)
    expect(llmBp.llmGenerated).toBe(true)
  })

  test('list：混合 .js 技能与蓝图技能应全部列出', async () => {
    createJsSkill(tmpHome, 'my_js_skill')
    createBlueprintSkill(tmpHome, 'my_bp_skill', { steps: Array(3).fill({ type: 'const', var: 'z', value: 0 }) })

    const result = await skillManager._listSkills(_ctx())

    expect(result.success).toBe(true)
    const skills = result.data.skills
    expect(skills.length).toBe(2)

    const jsSkill = skills.find(s => s.name === 'my_js_skill')
    expect(jsSkill).toBeDefined()
    expect(jsSkill.category).toBeUndefined() // .js 技能无 category

    const bpSkill = skills.find(s => s.name === 'my_bp_skill')
    expect(bpSkill).toBeDefined()
    expect(bpSkill.category).toBe('blueprint')
    expect(bpSkill.stepCount).toBe(3)
  })

  // ===== info 测试 =====

  test('info：蓝图技能应展示 meta / materialCategories / referencedTables', async () => {
    createBlueprintSkill(tmpHome, 'info_test_bp', {
      steps: [
        { type: 'input', var: 'x', from: 'x_param', default: 10 },
        { type: 'material', var: 'cement', material_query: { category: '水泥', property: 'strength' } },
        { type: 'material', var: 'sand', material_query: { category: '细骨料', property: 'fineness' } },
        { type: 'table_lookup', var: 'water', table: '表A-用水量', lookup_mode: 'bilinear', keys: {} },
        { type: 'table_lookup', var: 'sand_ratio', table: '表B-砂率', lookup_mode: 'linear', keys: {} },
        { type: 'output', var: 'water', name: '水', unit: 'kg', precision: 1 }
      ],
      tableCount: 0
    })

    const result = await skillManager._getSkillInfo('info_test_bp', _ctx())

    expect(result.success).toBe(true)
    const data = result.data
    expect(data.category).toBe('blueprint')
    expect(data.skillName).toBe('info_test_bp')
    expect(data.meta).toBeDefined()
    expect(data.meta.name).toBe('info_test_bp')
    expect(data.stepCount).toBe(6)
    expect(data.materialCategories).toEqual(['水泥', '细骨料'])
    expect(data.referencedTables).toEqual(['表A-用水量', '表B-砂率'])
  })

  // ===== delete 测试 =====

  test('delete：蓝图技能应备份到 backups/ 后再删除整个目录', async () => {
    const skillName = 'delete_test_bp'
    createBlueprintSkill(tmpHome, skillName, {
      steps: Array(4).fill({ type: 'const', var: 'k', value: 99 }),
      tableCount: 1
    })

    const blueprintDir = path.join(tmpHome, '.concrete-mixdesign', 'skills', skillName)
    expect(fs.existsSync(blueprintDir)).toBe(true)

    const result = await skillManager._deleteSkill(skillName, _ctx())

    expect(result.success).toBe(true)
    expect(result.message).toContain(skillName)
    expect(result.backupPath).toBeDefined()

    // 原目录已删除
    expect(fs.existsSync(blueprintDir)).toBe(false)

    // 备份目录存在并包含相同内容
    const backupDir = result.backupPath
    expect(fs.existsSync(backupDir)).toBe(true)
    expect(fs.existsSync(path.join(backupDir, 'meta.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(backupDir, 'blueprint.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(backupDir, 'tables'))).toBe(true)

    // 验证备份文件内容与原始一致
    const origMeta = require('js-yaml').load(fs.readFileSync(path.join(backupDir, 'meta.yaml'), 'utf8'))
    expect(origMeta.name).toBe(skillName)
  })
})

// workspaceTools.isWrite.test.js（Agent 架构 v2 任务 2.1）
// 验证 skill() 的 isWrite 参数标记：
//   - 15 个写操作 skill（7 workspace + 7 officecli + 1 一键报表）isWrite === true
//   - 12 个读操作 skill isWrite 为 falsy（默认 false）
//   - 覆盖全部 27 个技能，无遗漏

const { buildWorkspaceSkills } = require('../../agent/workspaceTools')

const WRITE_SKILLS = [
  // 7 workspace 写操作
  'workspace_writeFile',
  'workspace_ingest',
  'workspace_mkdir',
  'workspace_archiveReports',
  'workspace_organize',
  'workspace_recordAnswer',
  'workspace_analyze',
  // 7 officecli 写操作
  'edit_office_file',
  'batch_office_edit',
  'create_office_file',
  'merge_office_template',
  'refresh_office_doc',
  'move_office_element',
  'import_office_csv',
  // 1 一键 xlsx 报表（exceljs，写盘）
  'generate_xlsx_report'
]

const READ_SKILLS = [
  // 7 workspace 读操作
  'workspace_search',
  'workspace_grep',
  'workspace_readPage',
  'workspace_listFiles',
  'workspace_lint',
  'workspace_searchGraph',
  'workspace_readRaw',
  // 5 officecli 读操作（validate_office_file 只读）
  'read_office_file',
  'query_office_elements',
  'validate_office_file',
  'officecli_raw',
  'officecli_help'
]

function buildSkillsByName() {
  const skills = buildWorkspaceSkills({ workspaceManager: null, wikiEngine: null })
  return Object.fromEntries(skills.map((s) => [s.name, s]))
}

describe('buildWorkspaceSkills isWrite 标记（Task 2.1）', () => {
  test('15 个写操作 skill 的 isWrite === true', () => {
    const byName = buildSkillsByName()
    for (const name of WRITE_SKILLS) {
      expect(byName[name]).toBeDefined() // 技能应存在
      expect(byName[name].isWrite).toBe(true) // 写操作应标记 isWrite=true
    }
  })

  test('12 个读操作 skill 的 isWrite 为 falsy', () => {
    const byName = buildSkillsByName()
    for (const name of READ_SKILLS) {
      expect(byName[name]).toBeDefined() // 技能应存在
      expect(byName[name].isWrite).toBeFalsy() // 读操作应保持默认 false
    }
  })

  test('覆盖全部 27 个技能（15 写 + 12 读），无遗漏、无重复', () => {
    const skills = buildWorkspaceSkills({ workspaceManager: null, wikiEngine: null })
    const all = [...WRITE_SKILLS, ...READ_SKILLS]
    expect(all).toHaveLength(27)
    expect(new Set(all).size).toBe(27) // 无重复
    const names = skills.map((s) => s.name)
    expect(names).toHaveLength(27)
    for (const name of all) {
      expect(names).toContain(name) // 每个技能都注册
    }
  })
})

/**
 * skill-manager triggerMode 字段测试
 *
 * 覆盖：
 * 1. list 返回每个 skill 含 triggerMode（.js=function, .md 根据 frontmatter）
 * 2. info 返回 triggerMode
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

// 屏蔽真实 agentHandler
jest.mock('../../ipcHandlers/agentHandler', () => {
  const mockRegistry = {
    _skills: new Map(),
    discover: jest.fn().mockResolvedValue(undefined),
    size: 0
  }
  return { getSkillRegistry: () => mockRegistry }
})

const skillManager = require('../../skills/skill-manager')

describe('skill-manager - triggerMode 字段', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-'))
    jest.spyOn(os, 'homedir').mockReturnValue(tmpDir)

    // 创建两个测试 MD skill
    const skillsDir = path.join(tmpDir, '.concrete-mixdesign', 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })

    // tool_a — trigger_mode: function
    fs.writeFileSync(path.join(skillsDir, 'tool_a.md'), `---
name: tool_a
description: tool a
trigger_mode: function
---
body`)

    // skill_b — trigger_mode: soft
    fs.writeFileSync(path.join(skillsDir, 'skill_b.md'), `---
name: skill_b
description: skill b
trigger_mode: soft
---
body`)
  })

  afterEach(() => {
    os.homedir.mockRestore()
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    jest.restoreAllMocks()
  })

  test('list 返回每个 skill 含 triggerMode', async () => {
    const result = await skillManager.execute({ action: 'list' }, { logger: console })
    expect(result.success).toBe(true)
    const toolA = result.data.skills.find(s => s.name === 'tool_a')
    const skillB = result.data.skills.find(s => s.name === 'skill_b')
    expect(toolA).toBeDefined()
    expect(skillB).toBeDefined()
    expect(toolA.triggerMode).toBe('function')
    expect(skillB.triggerMode).toBe('soft')
  })

  test('info 返回 triggerMode', async () => {
    const result = await skillManager.execute({ action: 'info', skillName: 'skill_b' }, { logger: console })
    expect(result.success).toBe(true)
    expect(result.data.triggerMode).toBe('soft')
  })
})

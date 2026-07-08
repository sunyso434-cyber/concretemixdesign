const path = require('path')
const fs = require('fs')
const os = require('os')

describe('create_skill - type 重构', () => {
  let tmpDir, skillModule, homedirSpy

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'createskill-'))

    // Mock os.homedir() to point to tmpDir so files write to temp
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(tmpDir)

    // 清模块缓存
    delete require.cache[require.resolve('../../skills/create-skill')]
    skillModule = require('../../skills/create-skill')
  })

  afterEach(() => {
    homedirSpy.mockRestore()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('type=tool + subType=md 创建 function call tool', async () => {
    const result = await skillModule.execute({
      type: 'tool',
      subType: 'md',
      skillName: 'my_tool',
      description: '我的工具'
    }, { logger: console })

    expect(result.success).toBe(true)
    const content = fs.readFileSync(path.join(tmpDir, '.concrete-mixdesign', 'skills', 'my_tool.md'), 'utf8')
    expect(content).toContain('trigger_mode: function')
  })

  test('type=skill 创建软触发 skill（trigger_mode 强制 soft）', async () => {
    const result = await skillModule.execute({
      type: 'skill',
      skillName: 'brainstorm',
      description: '创新脑暴'
    }, { logger: console })

    expect(result.success).toBe(true)
    const content = fs.readFileSync(path.join(tmpDir, '.concrete-mixdesign', 'skills', 'brainstorm.md'), 'utf8')
    expect(content).toContain('trigger_mode: soft')
  })

  test('老 format 参数调用报 E_LEGACY_FORMAT', async () => {
    const result = await skillModule.execute({
      format: 'md',
      skillName: 'old_style',
      description: 'old'
    }, { logger: console })
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_LEGACY_FORMAT')
  })

  test('type 非法时报 E_PARAM_INVALID', async () => {
    const result = await skillModule.execute({
      type: 'invalid',
      skillName: 'foo',
      description: 'foo'
    }, { logger: console })
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('E_PARAM_INVALID')
  })
})

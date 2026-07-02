/**
 * prepare_blueprint_authoring Skill 单元测试
 *
 * 覆盖：
 * - 正常读取 md 文件并返回全文
 * - md 文件不存在时的错误返回
 * - 返回值必须包含 guide、nextAction 等约定字段
 * - 断言 md 中关键规范条款存在（防止关键条款被误删）
 */

const fs = require('fs')
const path = require('path')

const skill = require('../../skills/prepare-blueprint-authoring')

const _ctx = () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
})

describe('prepare_blueprint_authoring skill', () => {
  test('技能元数据合法', () => {
    expect(skill.name).toBe('prepare_blueprint_authoring')
    expect(typeof skill.description).toBe('string')
    expect(skill.services).toEqual([])
    expect(typeof skill.execute).toBe('function')
  })

  test('正常读取 md 并返回完整规范', async () => {
    const ctx = _ctx()
    const result = await skill.execute({}, ctx)

    expect(result.success).toBe(true)
    expect(result.type).toBe('blueprint_authoring_guide')
    expect(typeof result.guide).toBe('string')
    expect(result.guide.length).toBeGreaterThan(500)
    expect(result.nextAction).toBe('call_create_skill_with_raw_blueprint')
    expect(typeof result.message).toBe('string')
    expect(ctx.logger.info).toHaveBeenCalled()
  })

  test('返回的 md 内容包含核心规范条款', async () => {
    const result = await skill.execute({}, _ctx())
    // 关键条款：禁自引用
    expect(result.guide).toMatch(/禁止自引用|不能出现在.*expr/)
    // 关键条款：7 种操作类型
    expect(result.guide).toMatch(/input.*const.*material.*formula.*table_lookup.*if_else.*output/s)
    // 关键条款：分段输出格式
    expect(result.guide).toMatch(/===\s*meta\.yaml\s*===/)
    expect(result.guide).toMatch(/===\s*blueprint\.yaml\s*===/)
    // 关键条款：category 白名单
    expect(result.guide).toContain('水泥')
    expect(result.guide).toContain('细骨料')
    expect(result.guide).toContain('减水剂')
  })

  test('md 文件不存在时返回明确错误', async () => {
    const origReadFileSync = fs.readFileSync
    jest.spyOn(fs, 'readFileSync').mockImplementation((p, enc) => {
      if (typeof p === 'string' && p.includes('blueprint-authoring-guide.md')) {
        const err = new Error('ENOENT: no such file')
        err.code = 'ENOENT'
        throw err
      }
      return origReadFileSync(p, enc)
    })

    const ctx = _ctx()
    const result = await skill.execute({}, ctx)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('SKILL_INTERNAL_ERROR')
    expect(result.details.originalError).toMatch(/ENOENT/)
    expect(ctx.logger.error).toHaveBeenCalled()

    fs.readFileSync.mockRestore()
  })

  test('context 缺失 logger 时不崩溃', async () => {
    const result = await skill.execute({}, {})
    expect(result.success).toBe(true)
  })
})

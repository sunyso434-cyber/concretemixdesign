const SkillRegistry = require('../../agent/SkillRegistry')
const path = require('path')
const fs = require('fs')
const os = require('os')

describe('SkillRegistry.getToolSchemas - soft skill 过滤', () => {
  let tmpDir, registry

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'))
    registry = new SkillRegistry({ userDir: tmpDir })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFile(name, content) {
    fs.writeFileSync(path.join(tmpDir, name), content)
  }

  test('soft skill 不出现在 getToolSchemas() 返回值里', async () => {
    writeFile('soft.md', frontmatter({ name: 'soft_skill', trigger_mode: 'soft' }))
    writeFile('tool.md', frontmatter({ name: 'tool_skill', trigger_mode: 'function' }))

    await registry._loadFromDir(tmpDir, { builtin: false })
    const schemas = registry.getToolSchemas()
    const names = schemas.map(s => s.function.name)

    expect(names).not.toContain('soft_skill')
    expect(names).toContain('tool_skill')
  })

  test('function call 工具正常返回', async () => {
    writeFile('calc.md', frontmatter({ name: 'calc_tool', trigger_mode: 'function' }))
    await registry._loadFromDir(tmpDir, { builtin: false })
    const schemas = registry.getToolSchemas()
    expect(schemas.find(s => s.function.name === 'calc_tool')).toBeDefined()
  })
})

function frontmatter({ name, trigger_mode }) {
  return `---
name: ${name}
description: desc for ${name}
trigger_mode: ${trigger_mode}
---
# body`
}
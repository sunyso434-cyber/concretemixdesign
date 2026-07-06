const fs = require('fs')
const path = require('path')
const os = require('os')
const { isV1Format, migrateV1ToV2 } = require('../migration')

describe('老 agent.md 迁移', () => {
  let tmpDir, agentMdPath

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-md-mig-'))
    agentMdPath = path.join(tmpDir, '.agent', 'agent.md')
    fs.mkdirSync(path.dirname(agentMdPath), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('isV1Format 检测到 YAML code block 返回 true', () => {
    const content = '## 专业偏好\n```yaml\nmaterials: []\n```\n'
    expect(isV1Format(content)).toBe(true)
  })

  test('isV1Format 检测到 ## 专业偏好 section 返回 true', () => {
    const content = '## 专业偏好\n- 水泥: 海螺\n'
    expect(isV1Format(content)).toBe(true)
  })

  test('isV1Format 纯 v2 格式返回 false', () => {
    const content = '## 业务规则\n- 老板偏好 C30\n'
    expect(isV1Format(content)).toBe(false)
  })

  test('migrateV1ToV2 把老文件备份到 .v1.bak 并写 v2 模板', async () => {
    const oldContent = '## 专业偏好\n```yaml\nmaterials: []\n```\n'
    fs.writeFileSync(agentMdPath, oldContent, 'utf8')

    const result = await migrateV1ToV2(tmpDir)

    expect(result.migrated).toBe(true)
    expect(fs.existsSync(agentMdPath + '.v1.bak')).toBe(true)
    expect(fs.readFileSync(agentMdPath + '.v1.bak', 'utf8')).toBe(oldContent)
    const newContent = fs.readFileSync(agentMdPath, 'utf8')
    expect(newContent).toContain('## 回复规范')
    expect(newContent).toContain('老板您好')
  })

  test('migrateV1ToV2 v2 格式文件不迁移', async () => {
    const v2Content = '## 业务规则\n- C30\n'
    fs.writeFileSync(agentMdPath, v2Content, 'utf8')

    const result = await migrateV1ToV2(tmpDir)
    expect(result.migrated).toBe(false)
    expect(fs.readFileSync(agentMdPath, 'utf8')).toBe(v2Content)
  })
})
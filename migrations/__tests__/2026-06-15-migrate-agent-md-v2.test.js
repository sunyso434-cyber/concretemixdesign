const path = require('path')
const fs = require('fs')
const os = require('os')

describe('agent.md v1→v2 迁移', () => {
  let tmpDir
  let agentMdPath

  const oldContent = `---
version: 1
---

## 专业偏好
- 常用水泥: P.O 42.5
- 默认强度: C30
- 常用粉煤灰: 粉煤灰
`

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmd-mig-'))
    agentMdPath = path.join(tmpDir, 'agent.md')
    fs.writeFileSync(agentMdPath, oldContent, 'utf8')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('应完整备份旧文件并写入安全的 v2 模板', async () => {
    const migration = require('../2026-06-15-migrate-agent-md-v2')
    await migration.up({ context: { agentMdPath } })
    const backupPath = agentMdPath + '.backup-20260615'
    expect(fs.existsSync(backupPath)).toBe(true)
    expect(fs.readFileSync(backupPath, 'utf8')).toBe(oldContent)

    const content = fs.readFileSync(agentMdPath, 'utf8')
    expect(content).toContain('version: 2')
    expect(content).toContain('## 业务规则')
    expect(content).toContain('agent.md.backup-20260615')
    expect(content).not.toContain('```yaml')
  })

  test('幂等：再次执行应不破坏已有 v2 内容', async () => {
    const migration = require('../2026-06-15-migrate-agent-md-v2')
    await migration.up({ context: { agentMdPath } })
    const before = fs.readFileSync(agentMdPath, 'utf8')
    await migration.up({ context: { agentMdPath } })
    expect(fs.readFileSync(agentMdPath, 'utf8')).toBe(before)
    expect(fs.readFileSync(agentMdPath + '.backup-20260615', 'utf8')).toBe(oldContent)
  })

  test('回滚时应从备份恢复旧文件', async () => {
    const migration = require('../2026-06-15-migrate-agent-md-v2')
    await migration.up({ context: { agentMdPath } })
    await migration.down({ context: { agentMdPath } })
    expect(fs.readFileSync(agentMdPath, 'utf8')).toBe(oldContent)
  })
})

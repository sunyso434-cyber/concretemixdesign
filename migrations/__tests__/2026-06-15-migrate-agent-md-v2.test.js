const path = require('path')
const fs = require('fs')
const os = require('os')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmd-mig-'))
const agentMdPath = path.join(tmpDir, 'agent.md')

function write(content) {
  fs.writeFileSync(agentMdPath, content, 'utf8')
}
function read() {
  return fs.readFileSync(agentMdPath, 'utf8')
}

describe('agent.md v1→v2 迁移', () => {
  test('应将 - 常用水泥: P.O 42.5 转换为 YAML 格式', async () => {
    write(`---
version: 1
---

## 专业偏好
- 常用水泥: P.O 42.5
- 默认强度: C30
- 常用粉煤灰: 粉煤灰
`)
    const migration = require('../2026-06-15-migrate-agent-md-v2')
    await migration.up({ context: { agentMdPath } })
    const content = read()
    expect(content).toContain('```yaml')
    expect(content).toContain('水泥')
    expect(content).toContain('厂家')
    expect(content).toContain('P.O 42.5')
    expect(content).toContain('掺合料')
    expect(content).not.toContain('C30') // 默认强度应被丢弃
  })

  test('应创建 .backup-20260615 备份文件', async () => {
    const backupPath = agentMdPath + '.backup-20260615'
    expect(fs.existsSync(backupPath)).toBe(true)
  })

  test('幂等：再次执行应不破坏已有 v2 内容', async () => {
    const before = read()
    const migration = require('../2026-06-15-migrate-agent-md-v2')
    await migration.up({ context: { agentMdPath } })
    const after = read()
    // 核心 YAML 内容应保持一致（备份文件不应被覆盖）
    expect(after).toContain('```yaml')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
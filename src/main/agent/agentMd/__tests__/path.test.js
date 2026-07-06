const fs = require('fs')
const path = require('path')
const os = require('os')

// 模拟 workspaceManager 全局对象
describe('agentMd path 选择', () => {
  test('有 workspaceManager.current() 时用工作区路径', () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'))
    global.workspaceManager = { current: () => ({ path: tmpWs }) }
    jest.resetModules()
    const { agentMdPath } = require('../index')
    expect(agentMdPath).toBe(path.join(tmpWs, '.agent', 'agent.md'))
    fs.rmSync(tmpWs, { recursive: true, force: true })
  })

  test('无 workspaceManager 时 fallback 到全局路径', () => {
    global.workspaceManager = null
    jest.resetModules()
    const { agentMdPath } = require('../index')
    expect(agentMdPath).toBe(path.join(os.homedir(), '.concrete-mixdesign', 'agent.md'))
  })
})
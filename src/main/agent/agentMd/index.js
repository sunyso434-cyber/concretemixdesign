const path = require('path')
const os = require('os')
const fs = require('fs')
const { AgentMdService } = require('./AgentMdService')
const { migrateV1ToV2 } = require('./migration')

function getAgentMdPath() {
  // 优先用工作区路径
  const ws = global.workspaceManager?.current()?.path
  if (ws) {
    return path.join(ws, '.agent', 'agent.md')
  }
  // fallback: 全局路径
  return path.join(os.homedir(), '.concrete-mixdesign', 'agent.md')
}

let agentMdPath = getAgentMdPath()
let instance = null

function getInstance() {
  if (!instance) {
    instance = new AgentMdService({ path: agentMdPath })
  }
  return instance
}

function setWorkspacePath(workspacePath) {
  const newPath = path.join(workspacePath, '.agent', 'agent.md')
  if (newPath === agentMdPath) return
  // 切换路径：丢弃旧 instance，构造新的
  if (instance && instance.watcher) {
    instance.stopWatching()
  }
  instance = new AgentMdService({ path: newPath })
  agentMdPath = newPath
  // 首次启动到新工作区：迁移检测 + 模板初始化
  ensureMigrated(newPath)
  instance.init()
}

async function ensureMigrated(agentMdPath) {
  const workspacePath = path.dirname(path.dirname(agentMdPath))
  await migrateV1ToV2(workspacePath)
}

function init() {
  const svc = getInstance()
  ensureMigrated(agentMdPath)
  svc.init()
  return svc
}

function checkPathLengthWarning() {
  if (agentMdPath.length > 200) {
    console.warn(`[AgentMd] 路径过长 (${agentMdPath.length} 字符)，Win10 默认 260 限制可能报错`)
  }
}

checkPathLengthWarning()

module.exports = { getInstance, init, agentMdPath, setWorkspacePath }
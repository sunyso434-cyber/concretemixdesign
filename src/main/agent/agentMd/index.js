const path = require('path')
const os = require('os')
const { AgentMdService } = require('./AgentMdService')

const agentMdPath = path.join(os.homedir(), '.concrete-mixdesign', 'agent.md')

let instance = null

function getInstance() {
  if (!instance) {
    instance = new AgentMdService({ path: agentMdPath })
  }
  return instance
}

function init() {
  const svc = getInstance()
  svc.loadFromFile()
  svc.startWatching()
  return svc
}

function checkPathLengthWarning() {
  if (agentMdPath.length > 200) {
    console.warn(`[AgentMd] 路径过长 (${agentMdPath.length} 字符)，Win10 默认 260 限制可能报错，建议缩短用户名或启用长路径`)
  }
}

checkPathLengthWarning()

module.exports = { getInstance, init, agentMdPath }

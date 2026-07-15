'use strict'

const fs = require('fs')
const { migrateAgentMdFile } = require('../src/main/agent/agentMd/migration')

module.exports = {
  async up({ context }) {
    const { agentMdPath } = context
    if (!fs.existsSync(agentMdPath)) {
      console.log('[migrate:agent-md-v2] agent.md 不存在，跳过')
      return
    }

    const result = await migrateAgentMdFile(agentMdPath, {
      backupSuffix: '.backup-20260615'
    })
    if (result.migrated) {
      console.log('[migrate:agent-md-v2] agent.md 已备份并升级为 v2 模板')
    }
  },

  async down({ context }) {
    const { agentMdPath } = context
    const backupPath = agentMdPath + '.backup-20260615'
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, agentMdPath)
      console.log('[migrate:agent-md-v2:down] 已从备份恢复')
    }
  }
}

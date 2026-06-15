'use strict'

const fs = require('fs')
const { AgentMdParser } = require('../src/main/agent/agentMd/AgentMdParser')

// 注意：v1 键到 materials 的映射由 AgentMdParser 内部 _parseProfessionalPrefsSection 完成。
// 本脚本只负责：1) 备份 2) 把 frontmatter version 升级为 2 3) 触发一次 formatToMarkdown 重写为 fenced YAML code block。
// 不要在这里再扫描扁平行追加 materials，否则会与 parser 内部 v1 兼容逻辑重复（导致 - 常用水泥: ... 出现两次）。

module.exports = {
  async up({ context }) {
    const { agentMdPath } = context
    if (!fs.existsSync(agentMdPath)) {
      console.log('[migrate:agent-md-v2] agent.md 不存在，跳过')
      return
    }

    // 1. 备份（只备份一次）
    const backupPath = agentMdPath + '.backup-20260615'
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(agentMdPath, backupPath)
    }

    // 2. 解析（parser 已经把 v1 扁平行映射到 professionalPrefs.materials）
    const content = fs.readFileSync(agentMdPath, 'utf8')
    const parsed = AgentMdParser.parse(content)

    // 3. 强制升级到 v2 形态（无论原文件是 v1 还是已经是 v2）
    parsed.version = 2
    if (!parsed.professionalPrefs || !Array.isArray(parsed.professionalPrefs.materials)) {
      parsed.professionalPrefs = { materials: [], method: null }
    }

    // 4. 用 formatToMarkdown 重写：自动输出 fenced YAML code block
    const newContent = AgentMdParser.formatToMarkdown(parsed)
    fs.writeFileSync(agentMdPath, newContent, 'utf8')
    console.log('[migrate:agent-md-v2] agent.md 已升级为 v2 格式')
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
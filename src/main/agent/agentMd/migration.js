const fs = require('fs')
const path = require('path')

/**
 * 检测 agent.md 是否是老 v1 格式
 * 老格式特征：
 * 1. 包含 fenced YAML code block（## 专业偏好 内或独立）
 * 2. 包含 ## 专业偏好 section 标题
 */
function isV1Format(content) {
  if (!content) return false
  if (/```yaml\n[\s\S]*?\n```/.test(content)) return true
  if (/^##\s*专业偏好/m.test(content)) return true
  return false
}

/**
 * 迁移老 v1 agent.md → v2
 * 1. 检测主文件
 * 2. 备份主文件到 .v1.bak
 * 3. 覆盖主文件为 v2 模板 + 顶部迁移提示
 *
 * 注意：迁移是 advisory only，只备份 + 写模板，不尝试转换 YAML/professionalPrefs
 * 老板需要手动从 .v1.bak 提取规则到新结构
 *
 * @param {string} workspacePath
 * @returns {Promise<{migrated: boolean, backupPath: string|null}>}
 */
async function migrateAgentMdFile(agentMdPath, { backupSuffix = '.v1.bak' } = {}) {
  if (!fs.existsSync(agentMdPath)) {
    return { migrated: false, backupPath: null }
  }

  const content = fs.readFileSync(agentMdPath, 'utf8')
  if (!isV1Format(content)) {
    return { migrated: false, backupPath: null }
  }

  // 1. 备份
  const backupPath = agentMdPath + backupSuffix
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(agentMdPath, backupPath)
  }

  // 2. 写 v2 模板 + 顶部迁移提示
  const template = `<!--
⚠️ 您的老 agent.md 已备份到 ${path.basename(backupPath)}
请手动迁移您的规则到新结构（v2 模板）
新结构：## sectionName + ### subSectionName + - 列表项
详见 docs/superpowers/specs/2026-07-06-agent-md-design.md
-->

---
version: 2
---

# 我的智能助手规则

## 回复规范
- 全部使用中文回复
- 每次回复前使用固定称呼：**老板您好**

## 业务规则

### 材料
- (请从 .v1.bak 迁移您常用的材料)

### 报告
- (请从 .v1.bak 迁移您对报告的要求)

## 注意事项
- 保持耐心
- 定期反思
`

  fs.writeFileSync(agentMdPath, template, 'utf8')

  return { migrated: true, backupPath }
}

async function migrateV1ToV2(workspacePath) {
  const agentMdPath = path.join(workspacePath, '.agent', 'agent.md')
  return migrateAgentMdFile(agentMdPath)
}

module.exports = { isV1Format, migrateAgentMdFile, migrateV1ToV2 }

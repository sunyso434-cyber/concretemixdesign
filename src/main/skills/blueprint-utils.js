/**
 * 蓝图工具函数（共享给 create-skill 和 manage_skills 使用）
 *
 * v10.2.0 抽离：原本只在 create-skill.js 里 _parseRawBlueprint，
 * 现在 manage_skills update 也要支持 rawBlueprint 一次写多文件，
 * 提取到独立模块避免代码重复。
 *
 * 提供：
 * - isBlueprintSkillDir(dir): 判断目录是否包含 meta.yaml
 * - parseRawBlueprint(rawText): 解析 === 分段 === 格式
 * - resolveBlueprintDir(userDir, skillName): 智能查找蓝图目录（按 dir.name 或 meta.name）
 */

/**
 * 解析主 agent 传入的 rawBlueprint：按 "=== <文件名> ===" 分段
 * @param {string} rawText
 * @returns {object|null} { meta, blueprint, tables: [{fileName, content, raw}], rawMeta, rawBlueprint }
 */
function parseRawBlueprint(rawText) {
  if (!rawText || typeof rawText !== 'string') return null
  const cleaned = rawText.replace(/```[a-zA-Z]*/g, '').replace(/```/g, '')
  const sections = {}
  const regex = /===\s*([^=\s][^=]*?)\s*===\s*\n([\s\S]*?)(?=\n===\s*[^=]|\s*$)/g
  let match
  while ((match = regex.exec(cleaned)) !== null) {
    const fileName = match[1].trim()
    sections[fileName] = match[2].trim()
  }
  if (!sections['meta.yaml'] || !sections['blueprint.yaml']) return null

  const yaml = require('js-yaml')
  let meta, blueprint
  try {
    meta = yaml.load(sections['meta.yaml']) || {}
    blueprint = yaml.load(sections['blueprint.yaml']) || {}
  } catch (e) {
    return null
  }
  if (!meta || !blueprint || !Array.isArray(blueprint.steps)) return null

  const tables = []
  for (const [fileName, content] of Object.entries(sections)) {
    if (fileName === 'meta.yaml' || fileName === 'blueprint.yaml') continue
    const tableMatch = fileName.match(/^tables\/(.+\.json)$/)
    if (tableMatch) {
      try {
        const parsed = JSON.parse(content)
        tables.push({ fileName: tableMatch[1], content: parsed, raw: content })
      } catch (e) {
        // 单个表解析失败不致命，跳过
      }
    }
  }

  return { meta, blueprint, tables, rawMeta: sections['meta.yaml'], rawBlueprint: sections['blueprint.yaml'] }
}

/**
 * 检测目录是否是蓝图技能目录（含 meta.yaml）
 */
function isBlueprintSkillDir(dir) {
  if (!dir || typeof dir !== 'string') return false
  const fs = require('fs')
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false
  return fs.existsSync(require('path').join(dir, 'meta.yaml'))
}

/**
 * 智能查找蓝图目录
 *
 * 解决 list/source/update/delete 接口语义不一致的问题：
 * - list 返回的 name 是 meta.name（来自 meta.yaml）
 * - 但目录实际叫 dir.name
 *
 * 这个函数：
 * 1. 先按 skillName 直接拼路径（dir.name === skillName）
 * 2. 找不到时扫描所有目录，找 meta.name === skillName 的
 *
 * @param {string} userDir - skills 根目录
 * @param {string} skillName - 老板/AI 传入的技能名（可能是 dir.name 或 meta.name）
 * @returns {string|null} 蓝图目录绝对路径；找不到返回 null
 */
function resolveBlueprintDir(userDir, skillName) {
  const fs = require('fs')
  const path = require('path')
  const yaml = require('js-yaml')

  // 1. 先按 skillName 直接拼路径（最快路径）
  const directPath = path.join(userDir, skillName)
  if (isBlueprintSkillDir(directPath)) {
    return directPath
  }

  // 2. fallback：扫描所有目录，按 meta.name 反查
  if (!fs.existsSync(userDir)) return null
  const entries = fs.readdirSync(userDir, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dirPath = path.join(userDir, e.name)
    const metaPath = path.join(dirPath, 'meta.yaml')
    if (!fs.existsSync(metaPath)) continue
    try {
      const meta = yaml.load(fs.readFileSync(metaPath, 'utf8')) || {}
      if (meta.name === skillName) {
        return dirPath
      }
    } catch (_) {
      // 跳过解析失败的 meta.yaml
    }
  }

  return null
}

module.exports = {
  parseRawBlueprint,
  isBlueprintSkillDir,
  resolveBlueprintDir
}
/**
 * 蓝图技能加载器
 * 将一个目录（含 meta.yaml + blueprint.yaml + tables/*.json）包装为标准 Skill 对象
 *
 * 约定：
 *   <skillDir>/meta.yaml        —— 技能元数据（name/description/version/parameters）
 *   <skillDir>/blueprint.yaml   —— 蓝图步骤定义
 *   <skillDir>/tables/*.json     —— 查表用表格（可选）
 */

const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const BlueprintEngine = require('../services/BlueprintEngine')
// 注意：MaterialService 在 buildMaterialsIndex 内部惰性 require，
// 避免在模块加载阶段就拉起 sequelize/DB 依赖（否则会让仅 require SkillRegistry 的测试失败）

/**
 * 加载 skillDir/tables 下的所有 .json 表格，按 table.name 建立索引
 * @param {string} skillDir
 * @returns {Promise<object>} { [tableName]: tableObject }
 */
async function loadTables(skillDir) {
  const tablesDir = path.join(skillDir, 'tables')
  const tables = {}
  if (!fs.existsSync(tablesDir)) return tables

  for (const file of fs.readdirSync(tablesDir)) {
    if (!file.endsWith('.json')) continue
    const fullPath = path.join(tablesDir, file)
    try {
      const table = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
      const key = (table && table.name) || file.replace(/\.json$/, '')
      tables[key] = table
    } catch (error) {
      console.error(`[blueprint-loader] 解析表格失败: ${file}`, error.message)
    }
  }
  return tables
}

/**
 * 从数据库构建材料索引：{ [type]: material[] }
 * @returns {Promise<object>}
 */
async function buildMaterialsIndex() {
  // 惰性加载：仅在真正执行蓝图时才拉起 DB 依赖
  const MaterialService = require('../services/MaterialService')
  const materials = await MaterialService.getAllMaterials()
  const index = {}
  for (const m of materials) {
    const type = m.type || '未分类'
    if (!index[type]) index[type] = []
    index[type].push(m)
  }
  return index
}

/**
 * 将蓝图目录包装为标准 Skill 对象
 * @param {string} skillDir
 * @returns {object} 标准 skill（name/description/version/category/parameters/execute）
 */
function wrapBlueprintAsSkill(skillDir) {
  const metaPath = path.join(skillDir, 'meta.yaml')
  const blueprintPath = path.join(skillDir, 'blueprint.yaml')

  const meta = yaml.load(fs.readFileSync(metaPath, 'utf8')) || {}

  return {
    name: meta.name || path.basename(skillDir),
    description: meta.description || '',
    version: meta.version || '1.0.0',
    category: 'blueprint',
    parameters: meta.parameters || [],
    services: [],
    execute: async (args = {}, runtimeCtx = {}) => {
      const blueprint = yaml.load(fs.readFileSync(blueprintPath, 'utf8')) || {}
      const tables = await loadTables(skillDir)
      const materialsIndex = await buildMaterialsIndex()
      const engine = new BlueprintEngine({ tables, materialsIndex })
      return engine.run(blueprint, args, runtimeCtx)
    }
  }
}

module.exports = { wrapBlueprintAsSkill, loadTables, buildMaterialsIndex }

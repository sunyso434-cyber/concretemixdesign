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
 * 材料类别 → 工具参数名 映射
 * 用于将蓝图中的中文材料类别映射为工具签名中的参数名
 */
const CATEGORY_PARAM_MAP = {
  '水泥': 'cement_name',
  '细骨料': 'fine_aggregate_name',
  '粗骨料': 'coarse_aggregate_name',
  '粉煤灰': 'fly_ash_name',
  '矿渣粉': 'slag_name',
  '锂渣': 'lithium_slag_name',
  '复合粉': 'composite_powder_name',
  '减水剂': 'superplasticizer_name'
}

/**
 * 将 meta.yaml 的数组格式参数标准化为对象格式
 * 输入: [{name: 'strength_grade', type: 'string', required: true, label: '强度等级'}]
 * 输出: {strength_grade: {type: 'string', required: true, description: '强度等级'}}
 *
 * 这确保了 SchemaValidator 和 getToolSchemas 能正确识别参数名
 */
function normalizeParameters(arrayParams) {
  if (!Array.isArray(arrayParams)) {
    // 已经是对象格式，直接返回
    if (arrayParams && typeof arrayParams === 'object') return arrayParams
    return {}
  }
  const obj = {}
  for (const p of arrayParams) {
    if (!p || !p.name) continue
    // ponytail: 将项目自定义的 select 类型翻译为 OpenAI 标准 string+enum；
    // 否则 DeepSeek/OpenAI 协议会在请求阶段拒收并报 "select is not valid under anyOf" 400 错误
    const jsonType = (p.type === 'select') ? 'string' : (p.type || 'string')
    obj[p.name] = {
      type: jsonType,
      required: p.required || false,
      description: p.label || p.description || ''
    }
    if (p.options) obj[p.name].enum = p.options
    if (p.default !== undefined) obj[p.name].default = p.default
  }
  return obj
}

/**
 * 递归收集步骤中的 material_query 类别
 * 处理 if_else.then / if_else.else 中的嵌套 material 步骤
 * @param {object} step - 单个步骤
 * @param {Set} categories - 收集到的类别集合
 */
function _collectMaterialCategories(step, categories) {
  if (!step) return
  if (step.type === 'material' && step.material_query && step.material_query.category) {
    categories.add(step.material_query.category)
  }
  // 递归进入 if_else 分支
  if (step.type === 'if_else') {
    for (const subStep of step.then || []) {
      _collectMaterialCategories(subStep, categories)
    }
    for (const subStep of step.else || []) {
      _collectMaterialCategories(subStep, categories)
    }
  }
}

/**
 * 从蓝图步骤中提取材料类别，注入对应的材料选择参数
 * 递归扫描所有步骤（包括 if_else 嵌套的子步骤）
 * @param {object} blueprint - 蓝图定义
 * @param {object} normalizedParams - 已标准化的参数对象
 * @returns {object} 注入材料参数后的新参数对象
 */
function injectMaterialParams(blueprint, normalizedParams) {
  const params = { ...normalizedParams }
  const categories = new Set()

  for (const step of blueprint.steps || []) {
    _collectMaterialCategories(step, categories)
  }

  for (const category of categories) {
    const paramName = CATEGORY_PARAM_MAP[category]
    if (!paramName) continue

    if (!params[paramName]) {
      params[paramName] = {
        type: 'string',
        required: false,
        description: `选择${category}材料（名称或ID），如不指定则自动选择默认材料。先调用 list_available_materials 获取可用材料列表`
      }
    }
  }

  return params
}

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
 * 进程级材料索引缓存。
 * 材料库变更（create/update/delete/batch）时由 invalidateMaterialsCache() 显式失效，
 * 否则每次执行蓝图都复用同一份索引，避免反复查库。
 */
let _materialsCache = null

/**
 * 从数据库构建材料索引：{ [type]: material[] }
 * 命中进程级缓存时直接返回；force=true 强制重建。
 * @param {object} [options]
 * @param {boolean} [options.force=false] - 强制重建缓存（忽略已有缓存）
 * @returns {Promise<object>}
 */
async function buildMaterialsIndex(options = {}) {
  if (!options.force && _materialsCache) return _materialsCache

  // 惰性加载：仅在真正执行蓝图时才拉起 DB 依赖
  const MaterialService = require('../services/MaterialService')
  const materials = await MaterialService.getAllMaterials()
  const index = {}
  for (const m of materials) {
    const type = m.type || '未分类'
    if (!index[type]) index[type] = []
    index[type].push(m)
  }
  _materialsCache = index
  return index
}

/**
 * 使材料索引缓存失效（材料增删改后调用，下次构建取最新数据）
 */
function invalidateMaterialsCache() {
  _materialsCache = null
}

/**
 * 从 args 中提取材料选择，构建 runtimeCtx.userChoice
 * @param {object} args - LLM 传入的工具参数
 * @param {object} blueprint - 蓝图定义
 * @returns {object} { [category]: materialName }
 */
function extractMaterialChoices(args, blueprint) {
  const userChoice = {}
  const categories = new Set()

  for (const step of blueprint.steps || []) {
    _collectMaterialCategories(step, categories)
  }

  for (const category of categories) {
    const paramName = CATEGORY_PARAM_MAP[category]
    if (!paramName) continue

    const value = args[paramName]
    if (value !== undefined && value !== null && value !== '') {
      userChoice[category] = value
    }
  }

  return userChoice
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
  const blueprint = yaml.load(fs.readFileSync(blueprintPath, 'utf8')) || {}

  // 参数标准化 + 注入材料选择参数
  const normalizedParams = normalizeParameters(meta.parameters)
  const fullParams = injectMaterialParams(blueprint, normalizedParams)

  return {
    name: meta.name || path.basename(skillDir),
    description: meta.description || '',
    version: meta.version || '1.0.0',
    // 阶段2任务2.6：category 优先取 meta.concrete_type（业务蓝图类型，如 self_compacting/ordinary），
    // 无则回退 'blueprint'（旧值，过渡期由 _normalizeCategory 归并到 flow）
    category: meta.concrete_type || 'blueprint',
    // 蓝图技能标记：category 改为 concrete_type 后，SkillExecutor 靠此识别蓝图（原靠 category==='blueprint'）
    _isBlueprint: true,
    parameters: fullParams,
    services: [],
    execute: async (args = {}, skillContext = {}, runtimeCtx = {}) => {
      // 从 args 提取材料选择，构建带 userChoice 的 runtimeCtx
      const userChoice = extractMaterialChoices(args, blueprint)
      const effectiveRuntimeCtx = {
        ...runtimeCtx,
        userChoice: { ...(runtimeCtx.userChoice || {}), ...userChoice }
      }

      const tables = await loadTables(skillDir)
      const materialsIndex = await buildMaterialsIndex()
      const engine = new BlueprintEngine({ tables, materialsIndex })
      return engine.run(blueprint, args, effectiveRuntimeCtx)
    }
  }
}

module.exports = { wrapBlueprintAsSkill, loadTables, buildMaterialsIndex, invalidateMaterialsCache, normalizeParameters, injectMaterialParams, extractMaterialChoices, CATEGORY_PARAM_MAP, _collectMaterialCategories }

/**
 * Skill 结构验证 + 示例运行器
 *
 * 验证所有 skill 文件的正确性：
 * 1. 必须导出 name, description, parameters, execute
 * 2. parameters 定义格式正确
 * 3. 如果定义了 examples，用 mock context 运行一遍
 *
 * 用法: node tests/test-skill-examples.js
 */

const fs = require('fs')
const path = require('path')

const skillsDir = path.join(__dirname, '..', 'src', 'main', 'skills')
const SchemaValidator = require(path.join(__dirname, '..', 'src', 'main', 'agent', 'SchemaValidator'))

const validator = new SchemaValidator()

// Mock context（提供所有可能用到的服务的空壳）
const mockContext = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {}
  },
  materialService: { getAllMaterials: async () => [] },
  mixDesignService: { calculateMixDesign: async () => ({}) },
  mixDesignOptimizer: { optimize: async () => ({}) },
  knowledgeService: { searchClauses: async () => [] },
  salesQuoteCalculation: {},
  salesQuoteHistory: {},
  xgboostPrediction: {}
}

let totalPassed = 0
let totalFailed = 0
let totalWarnings = 0
const issues = []

function pass(name, msg) {
  totalPassed++
  console.log(`  ✅ ${msg}`)
}

function fail(name, msg) {
  totalFailed++
  issues.push({ skill: name, issue: msg })
  console.log(`  ❌ ${msg}`)
}

function warn(name, msg) {
  totalWarnings++
  console.log(`  ⚠️  ${msg}`)
}

// 加载所有 skill 文件
const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js'))

console.log('=' .repeat(60))
console.log(`Skill 结构验证 (${skillFiles.length} 个 skill)`)
console.log('=' .repeat(60))

async function runAll() {
for (const file of skillFiles) {
  const filePath = path.join(skillsDir, file)
  const skillName = file.replace('.js', '')

  console.log(`\n📦 ${skillName}`)

  try {
    const skill = require(filePath)

    // 1. 必须导出字段
    if (!skill.name) fail(skillName, '缺少 name 字段')
    else pass(skillName, `name: ${skill.name}`)

    if (!skill.description) fail(skillName, '缺少 description 字段')
    else pass(skillName, `description: ${skill.description.slice(0, 50)}...`)

    if (!skill.parameters || typeof skill.parameters !== 'object') {
      fail(skillName, '缺少 parameters 字段或格式错误')
    } else {
      pass(skillName, `parameters: ${Object.keys(skill.parameters).length} 个参数`)

      // 2. 验证参数定义格式
      for (const [paramName, paramDef] of Object.entries(skill.parameters)) {
        if (!paramDef.type) {
          fail(skillName, `参数 ${paramName} 缺少 type`)
        }
        const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object']
        if (paramDef.type && !validTypes.includes(paramDef.type)) {
          fail(skillName, `参数 ${paramName} type 无效: ${paramDef.type}`)
        }
        if (paramDef.required !== undefined && typeof paramDef.required !== 'boolean') {
          warn(skillName, `参数 ${paramName} required 应该是 boolean`)
        }
      }

      // 3. 验证 JSON Schema 生成
      try {
        const schema = validator.toJsonSchemaProperties(skill.parameters)
        const required = validator.getRequiredParams(skill.parameters)
        pass(skillName, `Schema 生成成功, ${required.length} 个必填参数`)
      } catch (e) {
        fail(skillName, `Schema 生成失败: ${e.message}`)
      }
    }

    if (typeof skill.execute !== 'function') {
      fail(skillName, '缺少 execute 函数')
    } else {
      pass(skillName, 'execute: 函数存在')
    }

    // 4. 检查可选字段
    if (skill.version) pass(skillName, `version: ${skill.version}`)
    if (skill.category) pass(skillName, `category: ${skill.category}`)
    if (skill.requiresConfirmation) pass(skillName, `requiresConfirmation: true`)

    // 5. 如果有 examples，运行它们
    if (skill.examples && Array.isArray(skill.examples)) {
      console.log(`\n  📋 运行 ${skill.examples.length} 个示例:`)
      for (let i = 0; i < skill.examples.length; i++) {
        const example = skill.examples[i]
        try {
          const result = await skill.execute(example.args || {}, mockContext)
          if (result && result.success !== undefined) {
            if (example.expectSuccess === false && !result.success) {
              pass(skillName, `示例 ${i + 1}: 预期失败，实际失败 ✓`)
            } else if (result.success) {
              pass(skillName, `示例 ${i + 1}: 执行成功`)
            } else {
              warn(skillName, `示例 ${i + 1}: 执行失败 - ${result.error?.message || '未知错误'}`)
            }
          } else {
            warn(skillName, `示例 ${i + 1}: 返回格式不标准`)
          }
        } catch (e) {
          warn(skillName, `示例 ${i + 1}: 执行异常 - ${e.message}`)
        }
      }
    }

  } catch (error) {
    fail(skillName, `加载失败: ${error.message}`)
  }
}

// 汇总
console.log('\n' + '=' .repeat(60))
console.log('汇总报告')
console.log('=' .repeat(60))
console.log(`Skill 文件数: ${skillFiles.length}`)
console.log(`✅ 通过: ${totalPassed}`)
console.log(`❌ 失败: ${totalFailed}`)
console.log(`⚠️  警告: ${totalWarnings}`)

if (issues.length > 0) {
  console.log('\n需要修复的问题:')
  for (const { skill, issue } of issues) {
    console.log(`  - [${skill}] ${issue}`)
  }
}

console.log('\n' + '=' .repeat(60))
process.exit(totalFailed > 0 ? 1 : 0)
} // end runAll

runAll().catch(err => {
  console.error('测试运行异常:', err)
  process.exit(1)
})

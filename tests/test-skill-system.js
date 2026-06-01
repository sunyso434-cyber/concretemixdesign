/**
 * Skill 系统测试
 * 验证 SkillRegistry、SkillExecutor、SchemaValidator 的正确性
 */

const path = require('path')

// 设置模块路径
const agentPath = path.join(__dirname, '..', 'src', 'main', 'agent')
const skillsPath = path.join(__dirname, '..', 'src', 'main', 'skills')

const SkillRegistry = require(path.join(agentPath, 'SkillRegistry'))
const SkillExecutor = require(path.join(agentPath, 'SkillExecutor'))
const SchemaValidator = require(path.join(agentPath, 'SchemaValidator'))
const ErrorCodes = require(path.join(agentPath, 'ErrorCodes'))

console.log('=' .repeat(60))
console.log('Skill 系统测试')
console.log('=' .repeat(60))

// 测试 1: SchemaValidator
console.log('\n【测试1】SchemaValidator 参数验证')
try {
  const validator = new SchemaValidator()

  // 测试必填参数
  const result1 = validator.validate({}, {
    strength: { type: 'string', required: true, description: '强度等级' }
  })
  console.log(`✅ 必填参数检查: ${!result1.valid ? '通过' : '失败'}`)
  if (!result1.valid) {
    console.log(`   错误码: ${result1.errorCode}`)
    console.log(`   消息: ${result1.errorMessage}`)
  }

  // 测试类型检查
  const result2 = validator.validate({ strength: 123 }, {
    strength: { type: 'string', required: true, description: '强度等级' }
  })
  console.log(`✅ 类型检查: ${!result2.valid ? '通过' : '失败'}`)

  // 测试范围检查
  const result3 = validator.validate({ slump: 500 }, {
    slump: { type: 'number', required: true, min: 10, max: 300, description: '坍落度' }
  })
  console.log(`✅ 范围检查: ${!result3.valid ? '通过' : '失败'}`)

  // 测试正常输入
  const result4 = validator.validate(
    { strength: 'C30', slump: 180 },
    {
      strength: { type: 'string', required: true },
      slump: { type: 'number', required: true, min: 10, max: 300 }
    }
  )
  console.log(`✅ 正常输入: ${result4.valid ? '通过' : '失败'}`)
} catch (error) {
  console.log('❌ SchemaValidator 测试失败:', error.message)
}

// 测试 2: ErrorCodes
console.log('\n【测试2】ErrorCodes 错误码')
try {
  const error = ErrorCodes.createError(
    ErrorCodes.PARAM_MISSING,
    '缺少必填参数: strength',
    '请提供强度等级'
  )
  console.log(`✅ 错误码创建: ${error.success === false ? '通过' : '失败'}`)
  console.log(`   错误码: ${error.error.code}`)
  console.log(`   恢复策略: ${error.error.recovery}`)
} catch (error) {
  console.log('❌ ErrorCodes 测试失败:', error.message)
}

// 测试 3: SkillRegistry
console.log('\n【测试3】SkillRegistry 注册发现')
try {
  const registry = new SkillRegistry()

  // 手动注册一个测试 skill
  registry.register({
    name: 'test_skill',
    description: '测试 Skill',
    parameters: {
      param1: { type: 'string', required: true, description: '参数1' }
    },
    async execute(args) {
      return { success: true, data: args }
    }
  })

  console.log(`✅ Skill 注册: ${registry.has('test_skill') ? '通过' : '失败'}`)
  console.log(`   Skill 数量: ${registry.size}`)
  console.log(`   Skill 列表: ${registry.skillNames.join(', ')}`)

  // 测试 getToolSchemas
  const schemas = registry.getToolSchemas()
  console.log(`✅ 工具 Schema 生成: ${schemas.length > 0 ? '通过' : '失败'}`)
  console.log(`   Schema 格式: ${schemas[0].type === 'function' ? '正确' : '错误'}`)
} catch (error) {
  console.log('❌ SkillRegistry 测试失败:', error.message)
}

// 测试 4: SkillRegistry 自动发现
console.log('\n【测试4】SkillRegistry 自动发现')
try {
  const registry = new SkillRegistry()
  registry._builtinDir = skillsPath

  // 同步发现 (需要异步)
  registry.discover().then(() => {
    console.log(`✅ 自动发现: ${registry.size > 0 ? '通过' : '失败'}`)
    console.log(`   发现的 Skills: ${registry.skillNames.join(', ')}`)

    // 测试 JSON Schema 生成
    const schemas = registry.getToolSchemas()
    console.log(`   生成的 Schema 数量: ${schemas.length}`)

    // 检查 Schema 格式
    if (schemas.length > 0) {
      const first = schemas[0]
      console.log(`   第一个 Schema: ${first.function.name}`)
      console.log(`   参数数量: ${Object.keys(first.function.parameters.properties).length}`)
    }
  })
} catch (error) {
  console.log('❌ SkillRegistry 自动发现测试失败:', error.message)
}

// 测试 5: SkillExecutor
console.log('\n【测试5】SkillExecutor 执行')
try {
  const registry = new SkillRegistry()

  // 注册测试 skill
  registry.register({
    name: 'test_execute',
    description: '测试执行',
    parameters: {
      value: { type: 'number', required: true, min: 0, max: 100 }
    },
    async execute(args, context) {
      return { success: true, data: { doubled: args.value * 2 } }
    }
  })

  // 创建 mock ContextProvider
  const mockContextProvider = {
    getForSkill: () => ({})
  }

  const executor = new SkillExecutor({
    skillRegistry: registry,
    contextProvider: mockContextProvider
  })

  // 测试正常执行
  executor.execute('test_execute', { value: 50 }).then(result => {
    console.log(`✅ 正常执行: ${result.success ? '通过' : '失败'}`)
    console.log(`   结果: ${JSON.stringify(result.data)}`)
  })

  // 测试参数验证失败
  executor.execute('test_execute', { value: 200 }).then(result => {
    console.log(`✅ 参数验证失败: ${!result.success ? '通过' : '失败'}`)
    console.log(`   错误码: ${result.error?.code}`)
  })

  // 测试 Skill 不存在
  executor.execute('nonexistent', {}).then(result => {
    console.log(`✅ Skill 不存在: ${!result.success ? '通过' : '失败'}`)
    console.log(`   错误码: ${result.error?.code}`)
  })
} catch (error) {
  console.log('❌ SkillExecutor 测试失败:', error.message)
}

console.log('\n' + '=' .repeat(60))
console.log('测试完成')
console.log('=' .repeat(60))

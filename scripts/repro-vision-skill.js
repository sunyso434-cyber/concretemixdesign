/**
 * repro-vision-skill.js
 * 用 SkillExecutor + DynamicContextProvider 跑 configure_vision_model，
 * 复现 LLM 调用的完整链路
 */
process.env.USER_DATA_PATH = process.env.APPDATA

const SystemService = require('../src/main/services/SystemService')
const SystemParam = require('../src/main/db/models/SystemParam')
const SkillRegistry = require('../src/main/agent/SkillRegistry')
const SkillExecutor = require('../src/main/agent/SkillExecutor')
const DynamicContextProvider = require('../src/main/agent/DynamicContextProvider')
const { sequelize } = require('../src/main/db/database')

async function readAll() {
  const names = ['visionEnabled', 'visionApiUrl', 'visionApiKey', 'visionModel']
  const out = {}
  for (const n of names) {
    const r = await SystemParam.findOne({ where: { paramName: n } })
    if (r) out[n] = { value: r.paramValue, updated: r.updatedAt }
  }
  return out
}

async function main() {
  // 1. 先清空
  console.log('--- 0. 清空 vision 配置 ---')
  await SystemService.clearVisionConfig()
  console.log('  清空后:', JSON.stringify(await readAll(), null, 2))

  // 2. 构造真实链路：SkillRegistry + DynamicContextProvider + SkillExecutor
  console.log('\n--- 1. 初始化真实 LLM 调用链路 ---')
  const skillRegistry = new SkillRegistry()
  await skillRegistry.discover()

  const allServices = {
    systemService: SystemService
  }
  const contextProvider = new DynamicContextProvider(allServices)
  contextProvider.setRegistry(skillRegistry)

  const skillExecutor = new SkillExecutor({ skillRegistry, contextProvider })

  // 3. 调 configure_vision_model（LLM 的实际调用方式）
  console.log('\n--- 2. 调 configure_vision_model ---')
  console.log('  老板传入: baseUrl=https://dashscope.aliyuncs.com/compatible-mode/v1, apiKey=sk-真实key, model=qwen-vl-plus')

  const result = await skillExecutor.execute('configure_vision_model', {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-真实key-abcdef123456',
    model: 'qwen-vl-plus'
  })

  console.log('\n--- 3. skill 返回 ---')
  console.log('  ', JSON.stringify(result, null, 2))

  console.log('\n--- 4. DB 状态 ---')
  console.log('  ', JSON.stringify(await readAll(), null, 2))

  console.log('\n--- 5. 调 get_vision_config ---')
  const getResult = await skillExecutor.execute('get_vision_config', {})
  console.log('  ', JSON.stringify(getResult, null, 2))

  if (!getResult.configured) {
    console.log('\n❌❌❌ 老板 bug 复现成功！')
  } else {
    console.log('\n✅ skill 链路 save→get 一致')
  }

  await sequelize.close()
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
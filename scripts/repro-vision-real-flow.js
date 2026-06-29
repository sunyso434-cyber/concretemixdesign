/**
 * repro-vision-real-flow.js
 * 复现老板真实操作流程：先 clear，再 configure，看写入是否生效
 */
process.env.USER_DATA_PATH = process.env.APPDATA

const path = require('path')
const fs = require('fs')
const os = require('os')

const SystemService = require('../src/main/services/SystemService')
const SystemParam = require('../src/main/db/models/SystemParam')
const { sequelize } = require('../src/main/db/database')

async function readAll() {
  const names = ['visionEnabled', 'visionApiUrl', 'visionApiKey', 'visionModel', 'visionMaxDimension', 'visionMaxSizeMb']
  const out = {}
  for (const n of names) {
    const r = await SystemParam.findOne({ where: { paramName: n } })
    if (r) out[n] = { value: r.paramValue, updated: r.updatedAt }
  }
  return out
}

async function main() {
  // ===== 步骤 1: 模拟 clear_vision_config =====
  console.log('--- 步骤 1: 模拟 clear_vision_config ---')
  await SystemService.clearVisionConfig()
  console.log('清空后:', JSON.stringify(await readAll(), null, 2))

  // ===== 步骤 2: 模拟老板调 configure_vision_model =====
  console.log('\n--- 步骤 2: 模拟 configure_vision_model ---')
  console.log('  老板传入: apiUrl=https://dashscope.aliyuncs.com/compatible-mode/v1, apiKey=sk-真实key, model=qwen-vl-plus')

  // 直接调 saveVisionConfig（与 vision-config.js skill 一致）
  try {
    await SystemService.saveVisionConfig({
      apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-真实key-abcdef123456',
      model: 'qwen-vl-plus',
      enabled: true
    })
    console.log('  saveVisionConfig 返回: undefined (没有 throw)')
  } catch (err) {
    console.log('  ❌ saveVisionConfig 抛错:', err.message)
    console.log('  stack 前 5 行:', err.stack?.split('\n').slice(0, 5).join('\n'))
  }

  console.log('\n  configure 后 DB 状态:')
  const after = await readAll()
  console.log('  ', JSON.stringify(after, null, 2))

  // ===== 步骤 3: 验证 =====
  console.log('\n--- 步骤 3: getVisionConfig 验证 ---')
  const cfg = await SystemService.getVisionConfig()
  const configured = !!(cfg.apiUrl && cfg.apiKey && cfg.model)
  console.log('  configured:', configured)
  console.log('  apiUrl:', cfg.apiUrl)
  console.log('  apiKey:', cfg.apiKey?.slice(0, 10) + '...')
  console.log('  model:', cfg.model)

  if (!configured) {
    console.log('\n❌❌❌ 老板 bug 复现成功：configure_vision_model 写入成功，但 get_vision_config 始终为空！')
  } else {
    console.log('\n✅ 正常情况：save→get 一致')
  }

  await sequelize.close()
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
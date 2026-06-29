/**
 * repro-vision-system.js
 * 用老板真实 DB 复现 setParam 写入失败
 *
 * 老板 DB 关键证据：
 * - visionEnabled updatedAt = 2026-06-29 16:34:46.712（被改过）
 * - visionApiUrl/Key/Model updatedAt = createdAt（从未被写过）
 *
 * 直接调 SystemService.saveVisionConfig 看写入情况
 */
process.env.USER_DATA_PATH = process.env.APPDATA  // 强制使用老板真实 DB 目录

const path = require('path')
const fs = require('fs')
const os = require('os')

const SystemService = require('../src/main/services/SystemService')
const SystemParam = require('../src/main/db/models/SystemParam')
const { sequelize } = require('../src/main/db/database')

async function readParam(name) {
  const r = await SystemParam.findOne({ where: { paramName: name } })
  return r ? r.toJSON() : null
}

async function main() {
  console.log('=== 复现：configure_vision_model 写入失败 ===\n')

  // 1. 打印当前 DB 状态
  console.log('--- 当前 DB 中 vision 相关参数 ---')
  for (const name of ['visionEnabled', 'visionApiUrl', 'visionApiKey', 'visionModel', 'visionMaxDimension', 'visionMaxSizeMb']) {
    const r = await readParam(name)
    if (r) {
      console.log(`  ${name}: value="${r.paramValue?.slice(0, 30)}${r.paramValue?.length > 30 ? '...' : ''}" created=${r.createdAt?.toISOString?.() || r.createdAt} updated=${r.updatedAt?.toISOString?.() || r.updatedAt}`)
    } else {
      console.log(`  ${name}: NOT FOUND`)
    }
  }

  // 2. 直接调 setParam（单字段）
  console.log('\n--- 测试 1：单字段 setParam(\'visionApiUrl\', ...) ---')
  try {
    const before = await readParam('visionApiUrl')
    console.log('  写入前:', JSON.stringify({ value: before.paramValue, updated: before.updatedAt }))
    const r = await SystemService.setParam('visionApiUrl', 'https://test.example.com/v1', 'ai', 'test')
    console.log('  setParam 返回:', JSON.stringify(r))
    const after = await readParam('visionApiUrl')
    console.log('  写入后:', JSON.stringify({ value: after.paramValue, updated: after.updatedAt }))
    if (after.paramValue !== 'https://test.example.com/v1') {
      console.log('  ❌❌❌ setParam 返回成功但 DB 没变！')
    } else {
      console.log('  ✅ setParam 写入成功')
    }
  } catch (err) {
    console.log('  ❌ setParam 抛错:', err.message)
    console.log('  stack:', err.stack?.split('\n').slice(0, 5).join('\n'))
  }

  // 3. 调 saveVisionConfig（完整流程）
  console.log('\n--- 测试 2：saveVisionConfig({apiUrl, apiKey, model, enabled}) ---')
  try {
    const r = await SystemService.saveVisionConfig({
      apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-test1234567890abcdefghij',
      model: 'qwen-vl-plus',
      enabled: true
    })
    console.log('  saveVisionConfig 返回:', JSON.stringify(r))

    for (const name of ['visionEnabled', 'visionApiUrl', 'visionApiKey', 'visionModel']) {
      const after = await readParam(name)
      console.log(`  写入后 ${name}: value="${after.paramValue?.slice(0, 30)}${after.paramValue?.length > 30 ? '...' : ''}" updated=${after.updatedAt}`)
    }
  } catch (err) {
    console.log('  ❌ saveVisionConfig 抛错:', err.message)
    console.log('  stack:', err.stack?.split('\n').slice(0, 5).join('\n'))
  }

  // 4. 验证 getVisionConfig
  console.log('\n--- 测试 3：getVisionConfig ---')
  const cfg = await SystemService.getVisionConfig()
  console.log('  configured:', !!(cfg.apiUrl && cfg.apiKey && cfg.model))
  console.log('  apiUrl:', cfg.apiUrl)
  console.log('  apiKey:', cfg.apiKey?.slice(0, 8) + '...')
  console.log('  model:', cfg.model)

  await sequelize.close()
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
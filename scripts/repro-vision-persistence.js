/**
 * repro-vision-persistence.js
 * 复现老板的 bug：configure_vision_model 报告成功，但 get_vision_config 返回 configured:false
 *
 * 策略：
 *   1. 调 saveVisionConfig 写入一条视觉配置
 *   2. 立刻调 getVisionConfig 读出来
 *   3. 检查 apiUrl/apiKey/model 是否真存进去了
 */

const path = require('path')

// sql.js 纯 JS 内存数据库，不依赖 native binding
const initSqlJs = require('sql.js')
const fs = require('fs')

async function main() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  // 建表（参照 SystemParam 模型）
  db.run(`
    CREATE TABLE systemParams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paramName TEXT NOT NULL UNIQUE,
      paramValue TEXT NOT NULL,
      paramType TEXT,
      description TEXT,
      status TEXT DEFAULT '正常',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 插入默认空配置（参照 initDefaultParams）
  const defaults = [
    ['visionEnabled', 'false', 'ai', '视觉模型功能开关'],
    ['visionApiUrl', '', 'ai', '视觉模型 API 基础地址'],
    ['visionApiKey', '', 'ai', '视觉模型 API 密钥'],
    ['visionModel', '', 'ai', '视觉模型名称'],
    ['visionMaxDimension', '1024', 'ai', '图片最大边长(px)'],
    ['visionMaxSizeMb', '10', 'ai', '图片最大文件大小(MB)']
  ]
  for (const [name, value, type, desc] of defaults) {
    db.run('INSERT INTO systemParams (paramName, paramValue, paramType, description) VALUES (?, ?, ?, ?)',
      [name, value, type, desc])
  }

  // 打印初始状态
  console.log('=== 初始状态（应有空值）===')
  let rows = []
  let stmt = db.prepare('SELECT paramName, paramValue FROM systemParams WHERE paramName LIKE ?')
  stmt.bind(['vision%'])
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  rows.forEach(r => console.log(`  ${r.paramName} = "${r.paramValue}"`))

  // ====== 模拟 saveVisionConfig ======
  console.log('\n=== 模拟 configure_vision_model ===')
  const cfg = {
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-test1234567890abcdef',
    model: 'qwen-vl-plus',
    enabled: true
  }

  // setParam 逻辑（更新或插入）
  function setParam(name, value, type, description) {
    const strValue = typeof value === 'boolean' ? String(value) : String(value ?? '')
    const existing = db.prepare('SELECT id FROM systemParams WHERE paramName = ?')
    existing.bind([name])
    const exists = existing.step()
    existing.free()
    if (exists) {
      db.run('UPDATE systemParams SET paramValue = ?, paramType = ?, description = ? WHERE paramName = ?',
        [strValue, type, description, name])
    } else {
      db.run('INSERT INTO systemParams (paramName, paramValue, paramType, description) VALUES (?, ?, ?, ?)',
        [name, strValue, type, description])
    }
    return { name, value: strValue }
  }

  if (cfg.enabled !== undefined) setParam('visionEnabled', String(!!cfg.enabled), 'ai', '视觉模型功能开关')
  if (cfg.apiUrl !== undefined) setParam('visionApiUrl', cfg.apiUrl || '', 'ai', '视觉模型 API 基础地址')
  if (cfg.apiKey !== undefined) setParam('visionApiKey', cfg.apiKey || '', 'ai', '视觉模型 API 密钥')
  if (cfg.model !== undefined) setParam('visionModel', cfg.model || '', 'ai', '视觉模型名称')
  console.log('  写入完成')

  // ====== 模拟 getVisionConfig ======
  console.log('\n=== 模拟 get_vision_config ===')
  rows = []
  stmt = db.prepare('SELECT paramName, paramValue FROM systemParams WHERE paramName LIKE ?')
  stmt.bind(['vision%'])
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()

  const map = {}
  rows.forEach(r => { map[r.paramName] = r.paramValue })

  const result = {
    enabled: map.visionEnabled === 'true',
    apiUrl: map.visionApiUrl || null,
    apiKey: map.visionApiKey || null,
    model: map.visionModel || null,
    maxDimension: map.visionMaxDimension ? parseInt(map.visionMaxDimension, 10) : 1024,
    maxSizeMb: map.visionMaxSizeMb ? parseInt(map.visionMaxSizeMb, 10) : 10
  }

  console.log('  enabled:', result.enabled)
  console.log('  apiUrl:', result.apiUrl)
  console.log('  apiKey:', result.apiKey ? result.apiKey.slice(0, 4) + '...' : null)
  console.log('  model:', result.model)
  console.log('  maxDimension:', result.maxDimension)
  console.log('  maxSizeMb:', result.maxSizeMb)

  // ====== 判定 ======
  console.log('\n=== 判定 ===')
  const configured = !!(result.apiUrl && result.apiKey && result.model)
  console.log('  configured:', configured)
  if (configured) {
    console.log('  ✅ sql.js 内存库复现：save→get 一致，没有 bug')
  } else {
    console.log('  ❌ sql.js 内存库复现：save→get 不一致，bug 复现！')
  }

  db.close()
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
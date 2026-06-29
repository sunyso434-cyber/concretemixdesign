/**
 * inspect-vision-db.js
 * 用 sql.js 直接读老板的真实 DB，看 vision 配置到底存成什么样
 */
const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')
const os = require('os')

const DB_PATH = process.env.DB_PATH || path.join(
  os.homedir(),
  'AppData', 'Roaming', 'concrete-mixdesign', 'concrete-mixdesign.db'
)

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('找不到 DB:', DB_PATH)
    process.exit(1)
  }
  console.log('打开 DB:', DB_PATH)
  console.log('文件大小:', fs.statSync(DB_PATH).size, 'bytes')

  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(DB_PATH))

  // 1. 列出所有表
  console.log('\n=== 所有表 ===')
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  if (tables[0]) {
    tables[0].values.forEach(row => console.log('  ', row[0]))
  }

  // 2. 找 systemParams / SystemParam / VisionConfig 等可能存视觉配置的表
  const visionRelatedTables = (tables[0]?.values || []).map(r => r[0]).filter(name =>
    name.toLowerCase().includes('vision') ||
    name.toLowerCase().includes('systemparam') ||
    name.toLowerCase().includes('config')
  )
  console.log('\n=== 视觉/配置相关表 ===')
  visionRelatedTables.forEach(t => console.log('  ', t))

  // 3. 直接查 vision 配置
  console.log('\n=== 查所有 vision* 参数 ===')
  let res = db.exec("SELECT * FROM systemParams WHERE paramName LIKE 'vision%' ORDER BY paramName")
  if (res[0]) {
    const cols = res[0].columns
    res[0].values.forEach(row => {
      const obj = {}
      cols.forEach((c, i) => obj[c] = row[i])
      console.log('  ', JSON.stringify(obj))
    })
  } else {
    console.log('  ⚠️ systemParams 表里没有任何 vision* 记录')
  }

  // 4. 看 deepseekApiKey 是否存在（确认 save 流程对其他字段是否工作）
  console.log('\n=== 查 deepseekApiKey（参照）===')
  res = db.exec("SELECT paramName, paramValue FROM systemParams WHERE paramName IN ('deepseekApiKey','agentEnabled')")
  if (res[0]) {
    res[0].values.forEach(row => {
      console.log(`  ${row[0]} = "${row[1]?.slice(0, 20)}${row[1]?.length > 20 ? '...' : ''}"`)
    })
  }

  // 5. systemParams 表结构
  console.log('\n=== systemParams 表结构 ===')
  res = db.exec("PRAGMA table_info(systemParams)")
  if (res[0]) {
    res[0].values.forEach(row => {
      console.log(`  ${row[1]} ${row[2]} ${row[3] ? 'NOT NULL' : ''} ${row[5] ? 'PK' : ''}`)
    })
  } else {
    console.log('  ⚠️ systemParams 表不存在')
  }

  // 6. 看 systemParams 总行数
  res = db.exec("SELECT COUNT(*) FROM systemParams")
  if (res[0]) {
    console.log('\n=== systemParams 总行数 ===', res[0].values[0][0])
  }

  // 7. 列出所有参数名（确认是不是有别的表/不同的列名）
  console.log('\n=== 所有参数名 ===')
  res = db.exec("SELECT paramName FROM systemParams ORDER BY paramName")
  if (res[0]) {
    res[0].values.forEach(row => console.log('  ', row[0]))
  }

  db.close()
}

main().catch(e => {
  console.error('脚本异常:', e)
  process.exit(1)
})
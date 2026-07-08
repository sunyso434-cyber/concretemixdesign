/**
 * 查询 CSP-8 相关：systemParams 字段 + chat_history 完整会话
 */
const sqlite3 = require('sqlite3').verbose()
const dbPath = 'C:/Users/sunys/AppData/Roaming/concrete-mixdesign/concrete-mixdesign.db'
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY)

db.serialize(() => {
  // 1. systemParams 表结构
  db.all("PRAGMA table_info(systemParams)", (err, cols) => {
    console.log('=== systemParams 字段 ===')
    cols.forEach(c => console.log(`  ${c.name} (${c.type})`))

    // 查 superplasticizerDosage 相关
    db.all(
      `SELECT * FROM systemParams
       WHERE paramKey LIKE '%superplasticizer%'
          OR paramKey LIKE '%Dosage%'
       ORDER BY paramKey`,
      (e2, params) => {
        const paramCount = params ? params.length : 0
        console.log('\n=== superplasticizer/Dosage 相关的 systemParams（' + paramCount + ' 条）===')
        if (params && params.length > 0) {
          params.forEach(p => {
            console.log(`  [${p.paramKey}] = ${p.paramValue} (${p.category || '-'} updatedAt=${p.updatedAt})`)
          })
        } else {
          console.log('  (无)')
        }

        // 2. 查所有 CSP-8 / C40+减水剂 chat_history（取全部列）
        db.all(
          `SELECT id, sessionId, role, content, toolCalls, toolCallId, createdAt
           FROM chat_history
           WHERE content LIKE '%CSP-8%'
              OR toolCalls LIKE '%CSP-8%'
              OR content LIKE '%西站%'
              OR toolCalls LIKE '%西站%'
              OR (content LIKE '%C40%' AND (content LIKE '%减水剂%' OR toolCalls LIKE '%减水剂%'))
           ORDER BY createdAt DESC
           LIMIT 30`,
          (e3, rows) => {
            const rowCount = rows ? rows.length : 0
            console.log('\n=== 含 CSP-8/西站/C40+减水剂 的 chat_history（' + rowCount + ' 条）===')
            if (rows && rows.length > 0) {
              rows.forEach(r => {
                console.log(`\n--- id=${r.id} session=${r.sessionId} role=${r.role} createdAt=${r.createdAt}`)
                if (r.content) console.log(`  content:\n${r.content}`)
                if (r.toolCalls) console.log(`  toolCalls: ${r.toolCalls.substring(0, 1500)}${r.toolCalls.length > 1500 ? '...(truncated)' : ''}`)
              })
            } else {
              console.log('  (无)')
            }
            db.close()
          }
        )
      }
    )
  })
})
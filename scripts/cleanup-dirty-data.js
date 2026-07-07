/**
 * 清理历史脏数据（P1-3）
 * - toolCalls 存成空数组 → 改 null
 * - content 存成 [object Object] 的 → 改 ''
 * - stopReason 不是 'aborted' 的 → 改 null
 */
const { Op } = require('sequelize')
const { ChatHistory } = require('../src/main/db/database')

async function clean() {
  const [results] = await Promise.all([
    ChatHistory.update({ toolCalls: null }, { where: { toolCalls: '[]' } }),
    ChatHistory.update({ content: '' }, { where: { content: '[object Object]' } }),
    ChatHistory.update({ stopReason: null }, { where: { stopReason: { [Op.not]: null, [Op.ne]: 'aborted' } } })
  ])
  console.log('清理完成')
}

if (require.main === module) clean().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
module.exports = { clean }

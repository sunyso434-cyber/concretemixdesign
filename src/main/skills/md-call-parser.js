/**
 * MD 技能调用解析器 (v1.1)
 *
 * 从 Markdown 技能文件中解析 "调用：技能名" 块，
 * 使 MD 技能能编排蓝图/其他技能。
 */

/**
 * 解析 MD 内容中的技能调用块
 *
 * 语法：
 *   调用：技能名
 *   参数：
 *     - param1: value1
 *     - param2: "字符串值"
 *   捕获结果到：{{result_var}}
 *
 * @param {string} md - Markdown 内容
 * @returns {{ calls: Array<{skillName, params, resultVar}>, raw: string }}
 */
function parseMdSkill(md) {
  const calls = []
  // 匹配 "调用：技能名" 块 + 参数列表 + 可选捕获
  const callRegex = /调用[：:]\s*`?([^\n`]+?)`?(?:\s*\(类型[:：]\s*(\w+)\))?\s*\n参数[：:]?\s*\n((?:\s+-\s+\w+:.*\n?)*)\s*(?:捕获结果到[：:]\s*`?\{\{(\w+)\}\}`?)?/g
  let m
  while ((m = callRegex.exec(md)) !== null) {
    const params = {}
    const paramLines = (m[3] || '').split('\n').filter(l => l.trim())
    for (const line of paramLines) {
      const pm = line.match(/-\s+(\w+):\s*(.+)/)
      if (pm) {
        let val = pm[2].trim()
        // 去掉引号
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        params[pm[1].trim()] = val
      }
    }
    calls.push({
      skillName: m[1].trim(),
      skillType: m[2] || 'blueprint',  // 默认待调用技能为 blueprint
      params,
      resultVar: m[4] || null
    })
  }
  return { calls, raw: md }
}

module.exports = { parseMdSkill }

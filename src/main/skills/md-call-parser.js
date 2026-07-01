/**
 * MD 技能调用解析器 (v1.1)
 *
 * 从 Markdown 技能文件中逐行解析 "调用：技能名" 块，
 * 使 MD 技能能编排蓝图/其他技能。
 *
 * 语法：
 *   调用：技能名 (类型: blueprint)
 *   参数：
 *     - param1: value1
 *     - param2: "带空格的字符串"
 *   捕获结果到：{{result_var}}
 */

// 解析器状态
const STATE_IDLE = 'idle'
const STATE_IN_CALL = 'in_call'

/**
 * 去掉字符串两端的引号（单引号或双引号）
 */
function stripQuotes(val) {
  const t = val.trim()
  if ((t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * 逐行解析 MD 内容中的技能调用块
 *
 * @param {string} md - Markdown 内容
 * @returns {{ calls: Array<{skillName, skillType, params, resultVar}>, raw: string }}
 */
function parseMdSkill(md) {
  const calls = []
  const lines = md.split('\n')

  let state = STATE_IDLE
  let currentCall = null

  for (const line of lines) {
    const trimmed = line.trim()

    // 检测 "调用：技能名" 或 "调用: 技能名"
    const callMatch = trimmed.match(/^调用[：:]\s*(.+)$/)
    if (callMatch) {
      // 保存前一个完成的调用
      if (currentCall) {
        calls.push(currentCall)
        currentCall = null
      }

      // 解析调用行：技能名 (类型: xxx)
      const skillSpec = callMatch[1].trim()
      // 去掉反引号
      const cleanSpec = skillSpec.replace(/`/g, '')
      const typeMatch = cleanSpec.match(/^(.+?)\s*\(\s*类型[：:]\s*(\w+)\s*\)$/)
      if (typeMatch) {
        currentCall = {
          skillName: typeMatch[1].trim(),
          skillType: typeMatch[2],
          params: {},
          resultVar: null
        }
      } else {
        currentCall = {
          skillName: cleanSpec,
          skillType: 'blueprint', // 默认待调用技能为 blueprint
          params: {},
          resultVar: null
        }
      }
      state = STATE_IN_CALL
      continue
    }

    // 只解析调用块内的行
    if (state !== STATE_IN_CALL) continue

    // 空行 → 调用结束
    if (trimmed === '') {
      calls.push(currentCall)
      currentCall = null
      state = STATE_IDLE
      continue
    }

    // "参数：" 声明行本身 → 跳过（参数内容在后续 - 开头行中）
    if (trimmed.match(/^参数[：:]\s*$/)) continue

    // 参数行：- param_name: value
    const paramMatch = trimmed.match(/^-\s+(\w+)[：:]\s*(.+)$/)
    if (paramMatch) {
      const key = paramMatch[1]
      const val = stripQuotes(paramMatch[2])
      currentCall.params[key] = val
      continue
    }

    // 捕获行：捕获结果到：{{var}}（反引号可选）
    const captureMatch = trimmed.match(/^捕获结果到[：:]\s*`?\{\{(\w+)\}\}`?\s*$/)
    if (captureMatch) {
      currentCall.resultVar = captureMatch[1]
      continue
    }

    // 遇到非调用语法的行（非 "-" 开头、非 "参数"、"捕获"）→ 调用结束
    if (!trimmed.startsWith('-') && !trimmed.startsWith('参数') && !trimmed.startsWith('捕获')) {
      calls.push(currentCall)
      currentCall = null
      state = STATE_IDLE
    }
  }

  // 最后一个未闭合的调用
  if (currentCall) {
    calls.push(currentCall)
  }

  return { calls, raw: md }
}

module.exports = { parseMdSkill }

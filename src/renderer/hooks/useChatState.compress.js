// src/renderer/hooks/useChatState.compress.js
//
// 上下文压缩核心实现（纯函数，可被 useChatState hook 与测试共用）
//
// 设计：把"调 IPC + dispatch + 错误处理"这部分与 React 状态分离，
// 让 useChatState hook 只负责包 useCallback 和 useState 状态。
// 这样可被 jest 直接 require，无需 @testing-library/react。

import { message } from 'antd'

/**
 * 上下文压缩核心实现
 * @param {Object} params
 * @param {Function} params.dispatch  agentStore dispatch
 * @param {Function} params.setIsCompressing  React setState
 * @param {Function} params.setPreviousSummary  React setState
 * @param {Array}    params.messages  当前 messages
 * @param {string}   params.previousSummary  上次摘要（用于增量总结）
 * @returns {Promise<{ok: boolean, skipped?: string}>}
 */
export async function handleCompressContextImpl({
  dispatch,
  setIsCompressing,
  setPreviousSummary,
  messages,
  previousSummary
}) {
  const list = messages || []

  // 边缘 case：少于 2 轮对话（2 user + 2 assistant = 4 条）无需压缩
  const userCount = list.filter(m => m.role === 'user').length
  if (userCount < 2) {
    message.info('对话过短，无需压缩')
    return { ok: false, skipped: 'too-short' }
  }

  setIsCompressing(true)
  try {
    const result = await window.electronAPI.invoke('aiAnalysis:compressContext', {
      messages: list,
      previousSummary
    })

    if (!result?.success) {
      message.error(result?.error || '压缩失败，请重试')
      return { ok: false, skipped: 'ipc-failed' }
    }

    const { summary, recentMessages, realTokens } = result.data

    // 1. dispatch COMPRESS_MESSAGES 替换 messages
    dispatch({
      type: 'COMPRESS_MESSAGES',
      payload: { summary, recentMessages }
    })

    // 2. 写入真实 tokens
    dispatch({
      type: 'SET_CONTEXT_STATS',
      payload: { realTokens: realTokens || 0 }
    })

    // 3. 更新 previousSummary
    setPreviousSummary(summary || '')

    message.success('上下文已压缩')
    return { ok: true }
  } catch (error) {
    console.error('压缩上下文失败:', error)
    message.error(`压缩失败：${error.message || '未知错误'}`)
    return { ok: false, skipped: 'exception' }
  } finally {
    setIsCompressing(false)
  }
}

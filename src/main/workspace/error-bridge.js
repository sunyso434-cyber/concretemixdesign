const { WorkspaceError } = require('./WorkspaceError')
const ErrorCodes = require('../agent/ErrorCodes')

/**
 * 包装异步函数：捕获 WorkspaceError 并转为 ErrorCodes.createError 格式
 * 用法：ipcMain.handle('workspace:open', wrapWorkspaceCall(async (event, args) => { ... }))
 */
function wrapWorkspaceCall(fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return ErrorCodes.createError(err.code, err.message, _hintFor(err), { retryable: err.retryable })
      }
      // 普通 Error 包装为 UNKNOWN
      console.error('[error-bridge] 未捕获错误:', err)
      return ErrorCodes.createError(ErrorCodes.UNKNOWN, err.message, '请稍后重试', { stack: err.stack })
    }
  }
}

/**
 * 把一个 promise 包装为 IPC 标准响应格式（{success, ...}）
 * 适用于已经返回对象的工具调用（如 WikiEngine.search 返回 SearchHit[]）
 */
async function toIPCResult(promise) {
  try {
    const data = await promise
    if (data && typeof data === 'object' && 'success' in data) {
      return data  // 已经是 IPC 格式
    }
    return { success: true, ...data }
  } catch (err) {
    if (err instanceof WorkspaceError) {
      return ErrorCodes.createError(err.code, err.message, _hintFor(err), { retryable: err.retryable })
    }
    console.error('[error-bridge] toIPCResult 未捕获错误:', err)
    return ErrorCodes.createError(ErrorCodes.UNKNOWN, err.message, '请稍后重试', { stack: err.stack })
  }
}

function _hintFor(err) {
  // 错误码 → 用户可读 hint
  const hints = {
    NOT_OPEN: '请先打开工作区',
    PATH_INVALID: '路径无效或不存在',
    PAGE_NOT_FOUND: 'Wiki 页不存在',
    FILE_NOT_FOUND: '文件不存在',
    READ_FAIL: '读取文件失败，请重试',
    WRITE_FAIL: '写入文件失败，请检查权限',
    LLM_FAIL: 'LLM 调用失败',
    LLM_RATE_LIMIT: 'LLM 配额已用完，已切只读模式',
    LLM_TIMEOUT: 'LLM 调用超时',
    PARSE_FAIL: '文件解析失败（可能损坏或格式不支持）',
    ATOMIC_FAIL: '原子写入失败',
    INDEX_CORRUPT: '索引文件损坏，将重建',
    INDEX_TOO_LARGE: '索引过大，请运行 compact',
    SIZE_EXCEEDED: '文件超过大小限制',
    PATH_TOO_LONG: '路径过长',
    WORKSPACE_MOVED: '工作区已被移动',
    CHAT_HISTORY_EXPORT_FAIL: '聊天历史导出失败',
    CHAT_HISTORY_IMPORT_FAIL: '聊天历史导入失败',
    CHAT_HISTORY_CROSS_WORKSPACE: '聊天历史跨工作区操作被拒绝',
    KG_EXTRACT_FAIL: '知识图谱提取失败（已降级）',
    KG_GRAPH_CORRUPT: '知识图谱文件损坏，将重建'
  }
  return hints[err.code] || '请稍后重试'
}

module.exports = { wrapWorkspaceCall, toIPCResult }
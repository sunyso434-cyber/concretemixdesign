const WorkspaceErrorCode = Object.freeze({
  NOT_OPEN: 'NOT_OPEN',
  PATH_INVALID: 'PATH_INVALID',
  PAGE_NOT_FOUND: 'PAGE_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  READ_FAIL: 'READ_FAIL',
  WRITE_FAIL: 'WRITE_FAIL',
  LLM_FAIL: 'LLM_FAIL',
  LLM_RATE_LIMIT: 'LLM_RATE_LIMIT',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  PARSE_FAIL: 'PARSE_FAIL',
  ATOMIC_FAIL: 'ATOMIC_FAIL',
  INDEX_CORRUPT: 'INDEX_CORRUPT',
  INDEX_TOO_LARGE: 'INDEX_TOO_LARGE',
  SIZE_EXCEEDED: 'SIZE_EXCEEDED',
  PATH_TOO_LONG: 'PATH_TOO_LONG',
  WORKSPACE_MOVED: 'WORKSPACE_MOVED',
  CHAT_HISTORY_EXPORT_FAIL: 'CHAT_HISTORY_EXPORT_FAIL',
  CHAT_HISTORY_IMPORT_FAIL: 'CHAT_HISTORY_IMPORT_FAIL',
  CHAT_HISTORY_CROSS_WORKSPACE: 'CHAT_HISTORY_CROSS_WORKSPACE',
  KG_EXTRACT_FAIL: 'KG_EXTRACT_FAIL',
  KG_GRAPH_CORRUPT: 'KG_GRAPH_CORRUPT'
})

class WorkspaceError extends Error {
  constructor(code, message, retryable = false, cause = null) {
    super(message)
    this.name = 'WorkspaceError'
    this.code = code
    this.retryable = retryable
    this.cause = cause
  }
}

module.exports = { WorkspaceError, WorkspaceErrorCode }

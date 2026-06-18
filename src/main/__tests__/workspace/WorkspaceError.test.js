const { WorkspaceError, WorkspaceErrorCode } = require('../../workspace/WorkspaceError')

describe('WorkspaceError', () => {
  test('21 个错误码全部存在', () => {
    const expected = [
      'NOT_OPEN', 'PATH_INVALID', 'PAGE_NOT_FOUND', 'FILE_NOT_FOUND',
      'READ_FAIL', 'WRITE_FAIL', 'LLM_FAIL', 'LLM_RATE_LIMIT',
      'LLM_TIMEOUT', 'PARSE_FAIL', 'ATOMIC_FAIL', 'INDEX_CORRUPT',
      'INDEX_TOO_LARGE', 'SIZE_EXCEEDED', 'PATH_TOO_LONG',
      'WORKSPACE_MOVED', 'CHAT_HISTORY_EXPORT_FAIL',
      'CHAT_HISTORY_IMPORT_FAIL', 'CHAT_HISTORY_CROSS_WORKSPACE',
      'KG_EXTRACT_FAIL', 'KG_GRAPH_CORRUPT'
    ]
    expect(Object.keys(WorkspaceErrorCode).sort()).toEqual(expected.sort())
  })

  test('抛错带 code 和 retryable', () => {
    const err = new WorkspaceError('READ_FAIL', 'test', true)
    expect(err.code).toBe('READ_FAIL')
    expect(err.retryable).toBe(true)
    expect(err.message).toBe('test')
    expect(err.name).toBe('WorkspaceError')
    expect(err).toBeInstanceOf(Error)
  })

  test('retryable 默认 false', () => {
    const err = new WorkspaceError('NOT_OPEN', 'test')
    expect(err.retryable).toBe(false)
  })
})
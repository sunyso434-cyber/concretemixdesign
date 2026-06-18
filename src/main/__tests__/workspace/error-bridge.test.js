const { wrapWorkspaceCall, toIPCResult } = require('../../workspace/error-bridge')
const { WorkspaceError, WorkspaceErrorCode } = require('../../workspace/WorkspaceError')
const ErrorCodes = require('../../agent/ErrorCodes')

describe('error-bridge', () => {
  test('wrapWorkspaceCall 成功 → 透传 result', async () => {
    const wrapped = wrapWorkspaceCall(async () => ({ ok: 1 }))
    const out = await wrapped()
    expect(out).toEqual({ ok: 1 })
  })

  test('wrapWorkspaceCall 抛 WorkspaceError → 转 ErrorCodes 格式', async () => {
    const wrapped = wrapWorkspaceCall(async () => {
      throw new WorkspaceError('READ_FAIL', '读取失败', true)
    })
    const out = await wrapped()
    expect(out).toMatchObject({
      success: false,
      error: '读取失败',
      errorCode: 'READ_FAIL',
      recovery: 'retry'  // 来自 ErrorCodes._getRecoveryStrategy
    })
  })

  test('wrapWorkspaceCall 抛普通 Error → 包装为 UNKNOWN', async () => {
    const wrapped = wrapWorkspaceCall(async () => {
      throw new Error('boom')
    })
    const out = await wrapped()
    expect(out.success).toBe(false)
    expect(out.errorCode).toBe('UNKNOWN')
    expect(out.error).toContain('boom')
  })

  test('toIPCResult 把 success 包装成 IPC 标准格式', async () => {
    const r1 = await toIPCResult(Promise.resolve({ files: [] }))
    expect(r1).toEqual({ success: true, files: [] })

    const r2 = await toIPCResult(Promise.reject(new WorkspaceError('PATH_INVALID', 'x', false)))
    expect(r2).toMatchObject({ success: false, errorCode: 'PATH_INVALID' })
  })
})
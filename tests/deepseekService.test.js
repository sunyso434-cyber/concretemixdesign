/**
 * Task 3: DeepSeekService 拆 HTTP 状态码 + 抛 createError 完整结构
 * Spec: docs/superpowers/specs/2026-06-23-ai-error-code-display-design.md § 2.2 / § 3.3
 * Plan: docs/superpowers/plans/2026-06-23-ai-error-code-display-plan.md (Task 3)
 *
 * 方向 A: DeepSeekService 三个 catch 分支（chat / analyzeMixDesign / chatWithToolsStream）
 *        直接 throw createError(code, null, null, { httpStatus, endpoint, rawMessage, callSite, occurredAt })
 *        不引入 classifyError（classifyError 是上游分类器，Task 4 在 agentHandler 入口接入）。
 */

// mock axios —— 单元测试不真实发请求；DeepSeekService 通过 axios.post(...) 调 API
// 注意：DeepSeekService.js 用 `const axios = require('axios')`，拿到的是模块导出本身（含 post），
// 不是 { default: { post } }。所以 mock 必须让 require('axios') 直接返回带 post 的对象。
jest.mock('axios', () => ({
  post: jest.fn(),
  create: jest.fn(() => ({ post: jest.fn() })),
}))

const axios = require('axios')
const DeepSeekService = require('../src/main/services/DeepSeekService')

// 简易构造：跳过 systemService，默认配置生效；提供 apiKey 即可
function makeService() {
  return new DeepSeekService('sk-test-key')
}

describe('DeepSeekService 错误抛出格式（方向 A：createError 完整结构）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ==================== chat() ====================
  test('chat() 401 → 抛 createError 完整结构（含 E-LLM-401 + title + callSite）', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 401, data: { error: { message: 'Invalid key' } } },
    })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({
        code: 'E-LLM-401',
        title: 'AI 密钥无效或未配置',
        details: { callSite: 'DeepSeekService.chat', httpStatus: 401 },
      })
  })

  test('chat() 413 → 抛 E-LLM-413', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 413, data: { error: { message: 'context length exceeded' } } },
    })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({ code: 'E-LLM-413' })
  })

  test('chat() 402 → 抛 E-LLM-402', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 402, data: {} } })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({ code: 'E-LLM-402', title: 'AI 账户余额不足' })
  })

  test('chat() 403 → 抛 E-LLM-403', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 403, data: {} } })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({ code: 'E-LLM-403', title: 'AI 接口无访问权限' })
  })

  test('chat() 500 → 抛 E-LLM-500', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({ code: 'E-LLM-500' })
  })

  test('chat() 503 → 抛 E-LLM-503', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 503, data: {} } })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({ code: 'E-LLM-503' })
  })

  test('chat() ECONNABORTED → 抛 E-NET-408', async () => {
    axios.post.mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout' })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({ code: 'E-NET-408' })
  })

  test('chat() 未知错误（无 status 无 code）→ 抛 E-SYS-999 兜底', async () => {
    axios.post.mockRejectedValueOnce(new Error('weird thing'))
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({
        code: 'E-SYS-999',
        details: { callSite: 'DeepSeekService.chat', rawMessage: 'weird thing' },
      })
  })

  // ==================== chatWithToolsStream() ====================
  test('chatWithToolsStream() 401 → 抛 E-LLM-401', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 401, data: {} } })
    const svc = makeService()
    await expect(svc.chatWithToolsStream([], [], () => {}))
      .rejects.toMatchObject({
        code: 'E-LLM-401',
        details: { callSite: 'DeepSeekService.chatWithToolsStream' },
      })
  })

  test('chatWithToolsStream() 500 → 抛 E-LLM-500', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    await expect(makeService().chatWithToolsStream([], [], () => {}))
      .rejects.toMatchObject({ code: 'E-LLM-500' })
  })

  // ==================== 数据契约回归（createError 6 字段） ====================
  test('抛出的错误对象只包含 createError 契约字段（无 error / errorCode 别名）', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 401, data: {} } })
    let caught
    try {
      await makeService().chat([{ role: 'user', content: 'x' }])
    } catch (e) {
      caught = e
    }
    expect(caught).toBeDefined()
    expect(caught.error).toBeUndefined()
    expect(caught.errorCode).toBeUndefined()
    // 6 个契约字段
    expect(Object.keys(caught).sort()).toEqual(
      ['code', 'details', 'hint', 'recovery', 'success', 'title'].sort()
    )
  })

  test('details.endpoint 等于 DEEPSEEK_API_URL', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 401, data: {} } })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({
        details: { endpoint: 'https://api.deepseek.com/v1/chat/completions' },
      })
  })

  test('details.occurredAt 是 ISO 时间串', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 401, data: {} } })
    await expect(makeService().chat([{ role: 'user', content: 'x' }]))
      .rejects.toMatchObject({
        details: { occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) },
      })
  })
})

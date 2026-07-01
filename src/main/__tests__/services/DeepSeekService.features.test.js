/**
 * DeepSeekService._applyProviderFeatures 厂商特性开关测试
 * 验证各厂商请求体字段构造是否符合官方文档
 */

// DeepSeekService 的依赖（agentConstants/ErrorCodes/axios）无需 mock
const DeepSeekService = require('../../services/DeepSeekService')

describe('DeepSeekService._applyProviderFeatures 厂商特性开关', () => {
  // 通过原型访问实例方法，避免 _getConfig 干扰
  // _applyProviderFeatures 内部不使用 this，可通过原型直接调用
  const service = DeepSeekService.prototype

  test('DeepSeek：thinking=true + reasoning_effort=high + max_tokens', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'deepseek',
      maxTokens: 4096,
      thinkingEnabled: true,
      reasoningEffort: 'high',
      features: { supportsThinking: true, supportsReasoningEffort: true, supportsMaxTokens: true, supportsMaxCompletionTokens: false },
    })
    expect(body.max_tokens).toBe(4096)
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.chat_template_kwargs).toBeUndefined()
  })

  test('DeepSeek：thinking=false 不发送 thinking', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'deepseek',
      maxTokens: 4096,
      thinkingEnabled: false,
      features: { supportsThinking: true, supportsReasoningEffort: true, supportsMaxTokens: true },
    })
    expect(body.thinking).toBeUndefined()
    expect(body.max_tokens).toBe(4096)
  })

  test('Agnes AI：thinking=true 用 chat_template_kwargs', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'agnes',
      maxTokens: 4096,
      thinkingEnabled: true,
      features: { supportsThinking: true, supportsMaxTokens: true },
    })
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
    expect(body.thinking).toBeUndefined()
    expect(body.max_tokens).toBe(4096)
    expect(body.reasoning_effort).toBeUndefined()
  })

  test('Agnes AI：thinking=false 不发送 chat_template_kwargs', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'agnes',
      maxTokens: 4096,
      thinkingEnabled: false,
      features: { supportsThinking: true, supportsMaxTokens: true },
    })
    expect(body.chat_template_kwargs).toBeUndefined()
  })

  test('MiniMax M3：thinking=false 发送 thinking: { type: "disabled" }', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'minimax',
      maxTokens: 8192,
      thinkingEnabled: false,
      features: { supportsThinking: true, supportsMaxTokens: true, supportsMaxCompletionTokens: true },
    })
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.max_completion_tokens).toBe(8192)
    expect(body.max_tokens).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  test('MiniMax M3：thinking=true 发送 thinking: { type: "adaptive" }', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'minimax',
      maxTokens: 8192,
      thinkingEnabled: true,
      features: { supportsThinking: true, supportsMaxCompletionTokens: true },
    })
    expect(body.thinking).toEqual({ type: 'adaptive' })
  })

  test('OpenAI：用 max_completion_tokens + reasoning_effort', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'openai',
      maxTokens: 4096,
      reasoningEffort: 'medium',
      features: { supportsReasoningEffort: true, supportsMaxTokens: false, supportsMaxCompletionTokens: true },
    })
    expect(body.max_completion_tokens).toBe(4096)
    expect(body.max_tokens).toBeUndefined()
    expect(body.reasoning_effort).toBe('medium')
    expect(body.thinking).toBeUndefined()
  })

  test('Moonshot：用 max_completion_tokens，不支持 reasoning_effort', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'moonshot',
      maxTokens: 4096,
      features: { supportsMaxCompletionTokens: true, supportsMaxTokens: false, supportsReasoningEffort: false },
    })
    expect(body.max_completion_tokens).toBe(4096)
    expect(body.max_tokens).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  test('Moonshot：thinking=true 发送 thinking: { type: "enabled" }', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'moonshot',
      maxTokens: 4096,
      thinkingEnabled: true,
      features: { supportsThinking: true, supportsMaxCompletionTokens: true },
    })
    expect(body.thinking).toEqual({ type: 'enabled' })
  })

  test('智谱 GLM：用 max_tokens，不发送 thinking/reasoning_effort', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'zhipu',
      maxTokens: 1024,
      features: { supportsMaxTokens: true, supportsMaxCompletionTokens: false },
    })
    expect(body.max_tokens).toBe(1024)
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.thinking).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  test('通义千问：supportsMaxCompletionTokens=true 优先 max_completion_tokens', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'qwen',
      maxTokens: 4096,
      features: { supportsMaxTokens: true, supportsMaxCompletionTokens: true },
    })
    expect(body.max_completion_tokens).toBe(4096)
    expect(body.max_tokens).toBeUndefined()
  })

  test('Ollama：用 max_tokens', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'ollama',
      maxTokens: 300,
      features: { supportsMaxTokens: true, supportsMaxCompletionTokens: false },
    })
    expect(body.max_tokens).toBe(300)
  })

  test('无 maxTokens 时不发送任何 token 限制字段', () => {
    const body = {}
    service._applyProviderFeatures(body, {
      provider: 'deepseek',
      features: { supportsMaxTokens: true },
    })
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBeUndefined()
  })

  test('无 features 字段时不崩溃', () => {
    const body = {}
    expect(() => {
      service._applyProviderFeatures(body, { provider: 'deepseek' })
    }).not.toThrow()
  })
})

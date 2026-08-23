// LLM provider 静态预设表（从 SystemService.js 拆分，行为不变）
// 纯静态数据、零依赖：8 个 provider 的 baseUrl/defaults/features，
// 供设置页下拉选择与 llm:save 合并厂商默认值使用。

const LLM_PROVIDER_PRESETS = [
      {
        value: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaults: {
          model: 'deepseek-v4-flash',
          maxTokens: 32768,
          timeout: 120000,
          contextLimit: 800000,
          thinkingEnabled: true,
          reasoningEffort: 'high',
        },
        features: {
          // 官方文档：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
          // thinking: { type: 'enabled' | 'disabled' }
          // reasoning_effort: high | max（low/medium 映射为 high，xhigh 映射为 max）
          // 思考模式不支持 temperature/top_p/presence_penalty/frequency_penalty
          // 工具调用轮次必须回传 reasoning_content，否则 400
          supportsThinking: true,
          supportsReasoningEffort: true,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 默认模型 deepseek-v4-flash 不支持
        },
      },
      {
        value: 'agnes',
        label: 'Agnes AI',
        baseUrl: 'https://apihub.agnes-ai.com/v1',
        defaults: {
          model: 'agnes-2.0-flash',
          maxTokens: 65536, // 官方文档：最大输出 65.5K
          timeout: 120000,
          contextLimit: 512000, // 官方文档：上下文窗口 512K
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://www.agnes-ai.com/zh-Hans/docs/agnes-20-flash
          // thinking 用 chat_template_kwargs: { enable_thinking: true }（OpenAI 兼容格式）
          // 原生支持 image_url 图片输入
          // 旧代码用 DeepSeek 格式 thinking 会导致 503
          supportsThinking: true,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // 原生支持 image_url
        },
      },
      {
        value: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaults: {
          model: 'gpt-4o-mini',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
          reasoningEffort: 'medium',
        },
        features: {
          // 官方文档：https://platform.openai.com/docs/api-reference/chat/create
          // max_tokens 已弃用，推荐 max_completion_tokens
          // reasoning_effort 仅 o1/o3 系列支持（low/medium/high，o3 还支持 minimal/xhigh）
          // gpt-4o 系列原生支持 image_url
          supportsThinking: false,
          supportsReasoningEffort: true,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // gpt-4o 系列原生支持
        },
      },
      {
        value: 'moonshot',
        label: 'Moonshot',
        baseUrl: 'https://api.moonshot.cn/v1',
        defaults: {
          model: 'kimi-k2.7-code',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://platform.moonshot.cn/docs/api/chat
          // max_tokens 已弃用，推荐 max_completion_tokens
          // thinking 仅 kimi-k2.7-code 支持，且仅 enabled（传 disabled 会报错）
          // Kimi K2.5 原生支持视觉输入
          supportsThinking: false, // 默认关闭避免误用（仅 kimi-k2.7-code 支持）
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // Kimi K2.5 原生支持视觉
        },
      },
      {
        value: 'zhipu',
        label: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaults: {
          model: 'glm-4-flash',
          maxTokens: 1024, // 官方文档：默认 1024，最大 4095
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://open.bigmodel.cn/dev/api/normal-model/glm-4
          // 支持 max_tokens（最大 4095），不支持 max_completion_tokens
          // 不支持 thinking/reasoning_effort
          // glm-4v 是独立视觉模型，默认模型不支持
          supportsThinking: false,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 默认模型不支持；glm-4v 是独立模型
        },
      },
      {
        value: 'qwen',
        label: '通义千问',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaults: {
          model: 'qwen-plus',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
          // OpenAI 兼容，支持 tools
          // 不支持 thinking/reasoning_effort
          // qwen-vl 是独立视觉模型，默认模型不支持
          supportsThinking: false,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 默认模型不支持；qwen-vl 是独立模型
        },
      },
      {
        value: 'ollama',
        label: 'Ollama（本地）',
        baseUrl: 'http://localhost:11434/v1',
        defaults: {
          model: 'llama3.2',
          maxTokens: 4096,
          timeout: 120000,
          contextLimit: 128000,
          thinkingEnabled: false,
        },
        features: {
          // 官方文档：https://github.com/ollama/ollama/blob/main/docs/openai.md
          // OpenAI 兼容性为实验性，支持 max_tokens 和 tools
          // 不支持 thinking/reasoning_effort/max_completion_tokens
          // vision 取决于本地加载的模型（llava 等支持，llama3.2 不支持）
          supportsThinking: false,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: false,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: false, // 取决于本地模型，默认关闭
        },
      },
      {
        value: 'minimax',
        label: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        defaults: {
          model: 'MiniMax-M3', // 官方文档：最新 M 系列
          maxTokens: 8192,
          timeout: 120000,
          contextLimit: 1000000, // 官方文档：1M 上下文
          thinkingEnabled: false, // M3 省略时默认开启 thinking，这里显式关闭
        },
        features: {
          // 官方文档：https://platform.minimaxi.com/docs/api-reference/text-openai-api
          // M3 支持 thinking: { type: 'disabled' | 'adaptive' }，省略时默认开启
          // M2.x 系列 thinking 无法关闭
          // 同时支持 max_tokens（旧版）和 max_completion_tokens（推荐）
          // M3 支持多模态：image_url（图片）和 video_url（视频）
          // 不支持 reasoning_effort（用 thinking 控制而非 reasoning_effort）
          // 旧代码发 DeepSeek 格式 thinking 会导致 503
          supportsThinking: true,
          supportsReasoningEffort: false,
          supportsMaxTokens: true,
          supportsMaxCompletionTokens: true,
          supportsTools: true,
          supportsStreaming: true,
          supportsVision: true, // M3 支持 image_url 和 video_url
          thinkingFormat: 'inline', // M3 把思考混在 content 里（<think>...</think>），不走 reasoning_content
        },
      },
]

function getLlmProviderPresets() {
  return LLM_PROVIDER_PRESETS
}

module.exports = { getLlmProviderPresets }

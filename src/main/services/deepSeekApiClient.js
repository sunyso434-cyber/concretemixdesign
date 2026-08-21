// DeepSeek API 客户端方法集（从 DeepSeekService.js 拆分，优化项 2，行为不变）
// 这些函数作为原型方法挂回 DeepSeekService 类（主文件 Object.assign），
// 方法内通过 this 访问 _getConfig/_buildClassifiedError 等主文件方法。
const axios = require('axios')
const { TOOLS, getSkillRegistry } = require('./deepSeekTools')
const { parseInlineThinking } = require('./streamParser')

  /**
   * 根据厂商特性开关向请求体注入可选字段
   * 特性来源：各厂商官方文档（详见 docs/superpowers/plans/2026-07-01-llm-provider-configs-plan.md）
   *
   * thinking 格式差异：
   * - DeepSeek/Moonshot: thinking: { type: 'enabled' }
   * - Agnes AI: chat_template_kwargs: { enable_thinking: true }（OpenAI 兼容格式）
   * - MiniMax M3: thinking: { type: 'disabled' | 'adaptive' }，省略时默认开启
   *
   * max_tokens vs max_completion_tokens：
   * - OpenAI/Moonshot: max_tokens 已弃用，用 max_completion_tokens
   * - MiniMax M3: 两者都支持，推荐 max_completion_tokens
   * - DeepSeek/智谱/Ollama: 只支持 max_tokens
   *
   * reasoning_effort：
   * - DeepSeek: high | max（low/medium 映射为 high，xhigh 映射为 max）
   * - OpenAI: low | medium | high（仅 o1/o3 系列）
   */
  function _applyProviderFeatures(requestBody, cfg) {
    const features = cfg.features || {}

    // v11.7.9: max_tokens 优先（兼容性更广，火山引擎等第三方网关均支持）
    // max_completion_tokens 作为备选（OpenAI/Moonshot 推荐但网关可能不支持）
    // v11.7.5: 强制 Number() 防止前端传字符串导致 API 400（如 "1024" 而非 1024）
    if (features.supportsMaxTokens && cfg.maxTokens) {
      requestBody.max_tokens = Number(cfg.maxTokens)
    } else if (features.supportsMaxCompletionTokens && cfg.maxTokens) {
      requestBody.max_completion_tokens = Number(cfg.maxTokens)
    }

    // thinking：各厂商格式不同
    if (features.supportsThinking) {
      if (cfg.provider === 'agnes') {
        // Agnes AI OpenAI 兼容格式
        if (cfg.thinkingEnabled === true) {
          requestBody.chat_template_kwargs = { enable_thinking: true }
        }
      } else if (cfg.provider === 'minimax') {
        // MiniMax M3：省略时默认开启 thinking，显式关闭用 disabled，显式开启用 adaptive
        requestBody.thinking = { type: cfg.thinkingEnabled ? 'adaptive' : 'disabled' }
      } else if (cfg.provider === 'deepseek' || cfg.provider === 'moonshot') {
        // DeepSeek/Moonshot：仅开启时发送，不发送则走默认
        if (cfg.thinkingEnabled === true) {
          requestBody.thinking = { type: 'enabled' }
        }
      }
    }

    // reasoning_effort：DeepSeek 支持 high/max，OpenAI 支持 low/medium/high
    if (features.supportsReasoningEffort && cfg.reasoningEffort) {
      requestBody.reasoning_effort = cfg.reasoningEffort
    }
  }

  /**
   * 调用 DeepSeek API 发送请求
   * @param {Array} messages - 消息列表
   * @param {boolean} includeTools - 是否携带工具定义
   * @returns {Promise<Object>} - API返回的message对象
   */
  async function _callAPI(messages, includeTools = false) {
    const cfg = await this._getConfig()
    const requestBody = {
      model: cfg.model,
      messages,
    }
    this._applyProviderFeatures(requestBody, cfg)
    if (includeTools) {
      const features = cfg.features || {}
      if (features.supportsTools !== false) {
        const registry = getSkillRegistry()
        requestBody.tools = registry ? registry.getToolSchemas() : TOOLS
      }
    }

    const apiUrl = `${(cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`
    try {
      const response = await axios.post(apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey || this.config.apiKey}`
        },
        timeout: cfg.timeout
      })
      return response.data.choices[0].message
    } catch (error) {
      if (error.response) {
        console.error(`API ${error.response.status}: ${JSON.stringify(error.response.data).slice(0, 500)}`)
        throw error
      }
      throw error
    }
  }

  /**
   * 携带自定义工具定义调用 API（供 AgentOrchestrator 使用）
   */
  async function chatWithTools(messages, tools) {
    const cfg = await this._getConfig()
    const requestBody = {
      model: cfg.model,
      messages,
      tools
    }
    this._applyProviderFeatures(requestBody, cfg)

    const apiUrl = `${(cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`
    try {
      const response = await axios.post(apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey || this.config.apiKey}`
        },
        timeout: cfg.timeout
      })
      return response.data.choices[0].message
    } catch (error) {
      if (error.response) {
        console.error(`API ${error.response.status}: ${JSON.stringify(error.response.data).slice(0, 500)}`)
        throw error
      }
      throw error
    }
  }

  /**
   * 携自定义工具定义流式调用 API（供 Agent 模式使用）
   * @param {Array} messages - 消息列表
   * @param {Array} tools - 工具定义数组
   * @param {Function} onEvent - 流式事件回调 ({ type, content, toolCallId, toolName, args })
   * @returns {Promise<Object>} - 完整的 assistant message（含 content + tool_calls）
   */
  async function chatWithToolsStream(messages, tools, onEvent, signal) {
    try {
      return await this._callAPIStream(messages, true, onEvent, tools, signal)
    } catch (error) {
      if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError') {
        throw { name: 'AbortError', message: 'Stream interrupted by user', code: 'ERR_CANCELED' }
      }
      throw await this._buildClassifiedError(error, 'DeepSeekService.chatWithToolsStream')
    }
  }

  async function _callAPIStream(messages, includeTools = false, onEvent = null, customTools = null, signal) {
    const cfg = await this._getConfig()
    const requestBody = {
      model: cfg.model,
      messages,
      stream: true,
    }
    this._applyProviderFeatures(requestBody, cfg)
    if (customTools) {
      requestBody.tools = customTools
    } else if (includeTools) {
      const features = cfg.features || {}
      if (features.supportsTools !== false) {
        const registry = getSkillRegistry()
        requestBody.tools = registry ? registry.getToolSchemas() : TOOLS
      }
    }

    const apiUrl = `${(cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`

    // v11.7.5: HTTP 错误时预读响应体，注入 error._apiErrorBody，避免 _buildClassifiedError 再去读已消耗的 stream
    let response
    try {
      response = await axios.post(apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.apiKey || this.config.apiKey}`
        },
        responseType: 'stream',
        timeout: cfg.timeout,
        signal   // v3.0：axios 原生支持，abort 时抛 ERR_CANCELED
      })
    } catch (postError) {
      // v3.1 要点 3：响应头前 abort 静默跳过，不打吓人日志
      if (postError.code === 'ERR_CANCELED' || postError.name === 'CanceledError' || postError.name === 'AbortError') {
        throw { name: 'AbortError', message: 'Stream interrupted by user (pre-headers)', code: 'ERR_CANCELED' }
      }
      const status = postError.response?.status || '?'
      let errorBody = ''
      const data = postError.response?.data
      if (data) {
        if (typeof data.on === 'function') {
          // 流式数据：先读完再保存（会消耗 stream，所以一并注入到 error 上）
          try {
            errorBody = await this._readErrorBody(data)
            if (typeof errorBody === 'object') errorBody = JSON.stringify(errorBody)
          } catch (_) {}
          // 替换 response.data 为已读字符串，防止 _buildClassifiedError 读到空流
          postError.response.data = errorBody || ''
        } else if (typeof data === 'string') {
          errorBody = data
        } else {
          errorBody = JSON.stringify(data)
        }
      }
      const shortBody = (typeof errorBody === 'string' ? errorBody : '').slice(0, 500)
      console.error(`[DeepSeek] 💥 流式 HTTP ${status} 错误:`, shortBody || postError.message)
      console.error(`[DeepSeek]     provider=${cfg.provider}, model=${cfg.model}, url=${apiUrl}`)
      postError._apiErrorBody = shortBody
      throw postError
    }

    return new Promise((resolve, reject) => {
      let buffer = ''
      const finalMessage = { role: 'assistant', content: '' }
      const toolCallMap = new Map()
      const streamStartTime = Date.now()
      let lastDataTime = Date.now()
      let chunkCount = 0
      const STREAM_IDLE_TIMEOUT = 60000 // 60秒无数据视为卡住

      // [DEBUG] 流式响应超时检测定时器
      const idleTimer = setInterval(() => {
        const idleTime = Date.now() - lastDataTime
        if (idleTime > STREAM_IDLE_TIMEOUT) {
          console.error(`[DeepSeek] ⏰ 流式响应超时: ${idleTime}ms 无数据, chunks=${chunkCount}, 耗时=${Date.now() - streamStartTime}ms`)
          clearInterval(idleTimer)
          reject(new Error(`流式响应超时: ${idleTime}ms 无数据`))
        }
      }, 10000) // 每10秒检查一次

      // 内联思考状态机（跨 chunk 持久）：MiniMax 等厂商把  thinking 混在 content 里
      const inlineState = { inThink: false, buffer: '' }

      const mergeToolCallDelta = (deltaToolCall) => {
        const index = deltaToolCall.index || 0
        const existing = toolCallMap.get(index) || {
          id: deltaToolCall.id || `tool-call-${index}`,
          type: deltaToolCall.type || 'function',
          function: { name: '', arguments: '' }
        }

        if (deltaToolCall.id) existing.id = deltaToolCall.id
        if (deltaToolCall.type) existing.type = deltaToolCall.type
        if (deltaToolCall.function?.name) {
          existing.function.name += deltaToolCall.function.name
        }
        if (deltaToolCall.function?.arguments) {
          existing.function.arguments += deltaToolCall.function.arguments
        }

        toolCallMap.set(index, existing)
      }

      const handlePayload = (payload) => {
        if (!payload || payload === '[DONE]') return

        let parsed
        try {
          parsed = JSON.parse(payload)
        } catch (_) {
          return
        }

        const delta = parsed.choices?.[0]?.delta || {}
        // v8.4.x：提取 DeepSeek 流式最后一个 chunk 的 usage 字段（prompt_tokens / completion_tokens / total_tokens）
        if (parsed.usage) {
          finalMessage.usage = parsed.usage
        }
        if (delta.reasoning_content) {
          finalMessage.reasoning_content = (finalMessage.reasoning_content || '') + delta.reasoning_content
          if (onEvent) {
            onEvent({ type: 'reasoning_delta', content: delta.reasoning_content })
          }
        }
        if (delta.content) {
          const thinkingFormat = cfg.thinkingFormat || (cfg.features && cfg.features.thinkingFormat)
          if (thinkingFormat === 'inline') {
            // 内联思考模式（MiniMax M3）：解析  thinking 标签，分流到 reasoning / text
            const parts = parseInlineThinking(delta.content, inlineState)
            for (const part of parts) {
              if (part.type === 'reasoning') {
                finalMessage.reasoning_content = (finalMessage.reasoning_content || '') + part.content
                if (onEvent) onEvent({ type: 'reasoning_delta', content: part.content })
              } else {
                finalMessage.content += part.content
                if (onEvent) onEvent({ type: 'text_delta', content: part.content })
              }
            }
          } else {
            finalMessage.content += delta.content
            if (onEvent) {
              onEvent({ type: 'text_delta', content: delta.content })
            }
          }
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            mergeToolCallDelta(toolCallDelta)
          }
        }
      }

      response.data.on('data', chunk => {
        lastDataTime = Date.now() // [DEBUG] 更新最后数据时间
        chunkCount++
        buffer += chunk.toString('utf8')
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const eventText of events) {
          const lines = eventText.split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              handlePayload(trimmed.slice(5).trim())
            }
          }
        }
      })

      response.data.on('end', () => {
        clearInterval(idleTimer) // [DEBUG] 清理超时检测
        console.log(`[DeepSeek] ✅ 流式响应结束: chunks=${chunkCount}, 耗时=${Date.now() - streamStartTime}ms`)

        if (buffer.trim()) {
          const lines = buffer.split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              handlePayload(trimmed.slice(5).trim())
            }
          }
        }

        const toolCalls = Array.from(toolCallMap.values())
          .filter(tc => tc.function?.name)
        if (toolCalls.length > 0) {
          finalMessage.tool_calls = toolCalls
        }
        resolve(finalMessage)
      })

      response.data.on('error', (err) => {
        clearInterval(idleTimer) // [DEBUG] 清理超时检测
        console.error(`[DeepSeek] 💥 流式响应错误: chunks=${chunkCount}, 耗时=${Date.now() - streamStartTime}ms, error=${err.message}`)
        reject(err)
      })
    })
  }

  /**
   * 读取错误响应体（兼容 Stream / JSON / 字符串三种格式）
   */
  async function _readErrorBody(data) {
    if (!data) return null
    // Stream 对象（流式请求返回 400 时 error.response.data 是 ReadableStream）
    if (typeof data.on === 'function') {
      return new Promise((resolve) => {
        let chunks = ''
        data.on('data', chunk => { chunks += chunk.toString('utf8') })
        data.on('end', () => {
          try { resolve(JSON.parse(chunks)) } catch (_) { resolve(chunks) }
        })
        data.on('error', () => resolve(null))
      })
    }
    // 已经是对象或字符串
    return data
  }

module.exports = { _applyProviderFeatures, _callAPI, chatWithTools, chatWithToolsStream, _callAPIStream, _readErrorBody }

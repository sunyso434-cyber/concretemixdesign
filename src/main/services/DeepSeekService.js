/**
 * DeepSeek API 服务
 * 用于调用云端AI分析混凝土配合比数据
 *
 * 拆分说明（优化项 2，行为不变）：
 * - 工具定义 fallback 与 Skill 注册表状态 → ./deepSeekTools
 * - 流式思考解析器 → ./streamParser
 * - API 客户端方法（_callAPI/_callAPIStream/chatWithTools±Stream 等）→ ./deepSeekApiClient
 * - 上下文压缩（_callSummaryAPI/compressContext/clearHistory）→ ./contextCompressor
 * 拆出的方法以 Object.assign 挂回原型，this 调用链与对外导出签名均不变。
 */

const { DEFAULT_AGENT_MAX_STEPS, AGENT_CONFIG_CACHE_TTL_MS } = require('../utils/agentConstants')
const { createError } = require('../agent/ErrorCodes')
const { getToolDefinitions, setSkillRegistry, setSkillExecutor, getSkillExecutor } = require('./deepSeekTools')
const { _applyProviderFeatures, _callAPI, chatWithTools, chatWithToolsStream, _callAPIStream, _readErrorBody } = require('./deepSeekApiClient')
const { _callSummaryAPI, compressContext, clearHistory } = require('./contextCompressor')
const { parseInlineThinking } = require('./streamParser')

class DeepSeekService {
  constructor(apiKeyOrConfig, systemService = null) {
    // 支持两种构造方式：
    // 1. DeepSeekService(apiKey, systemService) — 旧兼容
    // 2. DeepSeekService(config, systemService) — config 驱动
    if (typeof apiKeyOrConfig === 'string') {
      this.isLegacy = true
      this.config = {
        apiKey: apiKeyOrConfig,
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
        thinkingEnabled: true,
        maxTokens: 32768,
        timeout: 120000,
        contextLimit: 800000,
      }
      this._systemService = systemService
    } else {
      this.isLegacy = false
      this.config = apiKeyOrConfig || {}
      this._systemService = systemService
    }
    this.conversationHistory = []
    this._configCache = null
  }

  /**
   * 返回当前配置（config 驱动模式直接返回 this.config）
   */
  async _getConfig() {
    if (this.isLegacy) {
      // 旧兼容模式：走 database 查询
      if (this._configCache && this._configCacheTime && (Date.now() - this._configCacheTime) < AGENT_CONFIG_CACHE_TTL_MS) {
        return this._configCache
      }
      if (!this._systemService) {
        this._configCache = {
          model: this.config.model,
          maxTokens: this.config.maxTokens,
          timeout: this.config.timeout,
          contextLimit: this.config.contextLimit,
          thinkingEnabled: this.config.thinkingEnabled,
          maxSteps: DEFAULT_AGENT_MAX_STEPS,
          baseUrl: this.config.baseUrl,
          apiKey: this.config.apiKey,
          provider: this.config.provider,
        }
      } else {
        const all = await this._systemService.getAgentConfig()
        this._configCache = {
          model: all.deepseekModel,
          maxTokens: all.deepseekMaxTokens,
          timeout: all.deepseekTimeout,
          contextLimit: all.deepseekContextLimit,
          thinkingEnabled: all.deepseekThinkingEnabled,
          maxSteps: all.agentMaxSteps,
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: this.config.apiKey,
          provider: 'deepseek',
        }
      }
      this._configCacheTime = Date.now()
      return this._configCache
    }
    // config 驱动模式：直接返回 this.config
    return this.config
  }

  // v1.2: 返回可用模型列表（config 驱动模式取当前配置 model）
  getAvailableModels() {
    if (this.isLegacy) {
      return ['deepseek-v4-flash', 'deepseek-v4-pro']
    }
    return [this.config.model || 'unknown']
  }

  // v1.2: 清掉本实例的 config 缓存
  clearConfigCache() {
    this._configCache = null
    this._configCacheTime = null
  }

  /**
   * 把任意 axios / network 异常归一为 createError 标准结构。
   */
  async _buildClassifiedError(error, callSite) {
    const status = error && error.response && error.response.status
    const code = (() => {
      const httpToCode = {
        400: 'E-LLM-400', 401: 'E-LLM-401', 402: 'E-LLM-402', 403: 'E-LLM-403',
        413: 'E-LLM-413', 429: 'E-LLM-429', 503: 'E-LLM-503',
      }
      if (status && httpToCode[status]) return httpToCode[status]
      if (status && status >= 500) return 'E-LLM-500'
      if (error && error.code === 'ECONNABORTED') return 'E-NET-408'
      if (error && ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNRESET'].includes(error.code)) {
        return 'E-NET-500'
      }
      return 'E-SYS-999'
    })()

    const data = error && error.response && error.response.data
    let rawMessage = ''
    if (data && typeof data.on === 'function') {
      // 仍是 readable stream（_callAPI 非流式或 _callAPIStream 未预读场景）
      try {
        const body = await this._readErrorBody(data)
        if (body != null) {
          if (typeof body === 'string') {
            rawMessage = body.slice(0, 500)
          } else if (body.error && body.error.message) {
            rawMessage = body.error.message
          } else {
            try { rawMessage = JSON.stringify(body).slice(0, 500) } catch (_) {}
          }
        }
      } catch (_) { }
    } else if (data && data.error && data.error.message) {
      rawMessage = data.error.message
    } else if (data && typeof data === 'string') {
      // v11.7.5: _callAPIStream 已将 stream 预读为字符串
      rawMessage = data.slice(0, 500)
    } else if (data && typeof data === 'object') {
      try {
        rawMessage = JSON.stringify(data).slice(0, 500)
      } catch (_) { }
    }
    // v11.7.5: 兜底取 _apiErrorBody（_callAPIStream 预注入）
    if (!rawMessage && error && error._apiErrorBody) {
      rawMessage = String(error._apiErrorBody).slice(0, 500)
    }
    if (!rawMessage && error && error.message) rawMessage = String(error.message)

    return createError(code, null, null, {
      httpStatus: status,
      endpoint: `${this.config.baseUrl || 'https://api.deepseek.com/v1'}/chat/completions`,
      rawMessage,
      callSite,
      occurredAt: new Date().toISOString(),
    })
  }

  /**
   * 设置 Skill 注册表 (静态方法)
   * @param {object} registry - SkillRegistry 实例
   */
  static setSkillRegistry(registry) {
    setSkillRegistry(registry)
  }

  /**
   * 设置 Skill 执行器 (静态方法)
   * @param {object} executor - SkillExecutor 实例
   */
  static setSkillExecutor(executor) {
    setSkillExecutor(executor)
  }

  /**
   * 获取工具定义 (优先从 SkillRegistry)
   * @returns {object[]} 工具定义数组
   */
  static getToolDefinitions() {
    return getToolDefinitions()
  }

  /**
   * 获取 Skill 执行器
   * @returns {object|null} SkillExecutor 实例
   */
  static getSkillExecutor() {
    return getSkillExecutor()
  }

  async chatStream(message, context = null, options = {}) {
    return this.chat(message, context, {
      ...options,
      stream: true
    })
  }

  /**
   * 简单调用 LLM：发送 prompt，返回纯文本响应。
   */
  async invoke(prompt) {
    const cfg = await this._getConfig()
    if (!cfg.apiKey) {
      throw new Error('LLM API密钥未配置')
    }
    const messages = [{ role: 'user', content: prompt }]
    const response = await this._callAPI(messages, false)
    return response.content || ''
  }

  /**
   * 与AI对话（支持 Function Calling 工具调用循环）
   */
  async chat(message, context = null, options = {}) {
    const cfg = await this._getConfig()
    if (!cfg.apiKey) {
      throw new Error('LLM API密钥未配置')
    }

    const { toolExecutor, rawMode, systemPrompt: customSystemPrompt, stream, onEvent } = options

    let systemPrompt
    if (rawMode) {
      // rawMode: 使用自定义系统提示词，不使用默认对话系统提示词
      systemPrompt = customSystemPrompt || ''
    } else {
      systemPrompt = `你是一个混凝土配合比分析专家，擅长分析材料性能参数对混凝土性能的影响。
你可以回答关于混凝土配合比设计、材料选择、性能优化、成本控制等各方面的问题。
请用专业的知识帮助用户解答疑问。

## 函数调用指南

你可以使用以下工具来辅助用户完成配合比设计和成本优化：

1. **list_available_materials**: 查询材料库。在帮助用户做材料选择之前，先调用此工具了解可用材料。
2. **calculate_mix_design**: 计算配合比。用户提供了完整参数后调用。
3. **optimize_mix_cost**: 成本优化。用户要找最低成本方案时调用。
4. **predict_performance**: 性能预测。根据配合比参数和材料属性，预测28d强度、减水剂掺量、容重。用户提到目标坍落度时，必须从对话中提取数值传入 slump 参数（单位 mm），否则模型精度会大幅下降。
   - 用户询问"强度能达到多少"、"这个配比性能怎么样"、"预测一下"时调用
   - 优化配合比后，补充预测验证时调用
   - 注意：先通过 list_available_materials 确认材料ID存在，再调用预测

### 材料选择流程（重要）
- 使用内置工具（如 calculate_mix_design）进行配合比设计时，第一次请求先调用 list_available_materials 获取可用材料
- 如果已有匹配的用户自定义技能（如 self_compacting_concrete_design、scc_mix_design），直接调用该技能，不需要先查材料——自定义技能内部会自行获取材料数据
- 向用户展示可选材料并做定性对比建议（基于材料属性：强度、价格、活性等）
- 用户说"用默认值"或明确选定时，再调用计算工具
- **不要过度追问**：当用户意图已经足够明确时（如已指定方案、材料、替代方式），使用合理默认值直接计算，然后让用户调整。常见默认值：掺合料掺量10%、粉煤灰掺量15%。计算完成后告诉用户"使用了默认掺量XX%，如需调整请告诉我"

### 材料列表输出格式（强制要求）

**绝对禁止的行为：**
1. 分隔符行禁止使用冒号（正确写法是每列用至少5个减号，外面加竖线）
2. 价格禁止使用千位分隔符（正确：1400元/吨，错误：1,400元/吨）
3. 材料名称前禁止加序号（如细骨料①、水泥01都是错的）
4. 材料名称中禁止使用emoji
5. 禁止用列表格式展示材料，必须用Markdown表格

**推荐格式：**
| 材料类型 | 材料名称 | 厂商 | ID | 价格 | 推荐 |
|---------|---------|------|----|------|------|
| 水泥 | P·O 42.5R | 拉法基 | 25 | 300元/吨 | 是 |
| 细骨料 | 机制砂（中砂） | 汶川 | 7 | 89元/吨 | 是 |
| 细骨料 | 河砂（细砂） | 乐山 | 8 | 93元/吨 | 否 |
| 锂渣 | 锂渣 | 青白江 | 40 | 65元/吨 | 否 |
| 减水剂 | SSJS（标准型） | 同升 | 11 | 1400元/吨 | 是 |

**推荐列说明：** 如果需要标注推荐材料，用"是/否"在单独一列标注，不要在名称里加任何符号。

### 参数规则（重要）
- 必填参数: strength, slump, cementId, sandIds, stoneIds
- 缺少必填参数时必须向用户追问，不可自行填充
- 非必填参数（如 flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage）可使用合理默认值（掺合料10%，粉煤灰15%），计算后告知用户
- 用户说"方案X加"、"在XX基础上加"时，结合上下文理解意图，用默认值先算，让用户调整

### 砂率参数传递规则（重要）
- **用户明确指定砂率时**：必须将用户说的砂率值传递给 sandRatio 参数（数字类型，单位%）
  - 例：用户说"砂率47%" → sandRatio: 47
  - 例：用户说"砂率设为45" → sandRatio: 45
- **用户未指定砂率时**：不传 sandRatio 参数，系统会根据规范自动计算
- **不要自行修改用户指定的砂率值**：用户说47%就传47，不要改成其他值
- **每次调用都要检查**：如果对话中用户指定了砂率，每次调用 calculate_mix_design 时都要带上这个参数

### 细骨料组合规则（重要）
- **不要建议具体比例**：用户选择多种细骨料时，配合比计算工具会根据目标组合细度模数自动计算最佳比例。你不需要也不应该建议"60%砂A + 40%砂B"这类具体比例。
- **组合细度模数的默认值**：系统默认C30的目标组合细度模数为2.7，每提高一个强度等级（5MPa）细度模数增加0.1。
- **用户指定组合细度模数**：当用户提出细骨料组合的细度模数要求时（如"C45目标细度模数3.0"），通过 tempSettings.targetFinenessModulusBase 参数传入。注意：这个值代表用户对**当前强度等级**最终组合细度模数的要求，而非C30的基准值。

### 材料对比
- 能力1（免费）: 获取材料列表后，基于属性做定性对比（如"P.O 42.5比P.O 42.5R便宜40元/吨"）
- 能力2（精确）: 用户追问"具体差多少"时，循环调用 calculate_mix_design，每次替换材料 ID，汇总对比结果

### 销售报价流程（v10.10 双模式）
- 用户询问报价、对客户解释特种混凝土、为什么贵、怎么报价时，进入销售报价流程。
- **普通混凝土**（目标市价已定）→ 调 \`reverse_sales_quote\`，传 \`targetUnitPrice\` + 配合比
- **特殊混凝土**（正向议价测算）→ 调 \`forward_sales_quote\`，传完整成本 + 可选设备摊销
- 算出 quote 后若需导出报告 → 调 \`format_quote_report\` 写到工作区 reports/
- **严格禁止**：在销售报价场景下，不能自动调用 list_available_materials、calculate_mix_design、optimize_mix_cost、predict_performance 等工具。
- 如果还没有配合比方案，必须先停下来告诉用户："没有找到 XX 强度 XX 类型 的配合比。请选择已有方案，或明确授权后我会帮您生成新配合比。"
  **禁止自动生成配合比、禁止替用户选择材料。**
- 报价统一为单方价格，不能询问数量，不能输出总金额。
- 运输费、泵送费、税费默认计入；税费默认按13%增值税。
- 特种混凝土额外费用统一叫技术服务费。

### 保存方案
- 用户说"保存方案"、"把这个存起来"、"保存这个配合比"等，调用 save_mix_design 保存到方案库。
- **必须先完成配合比计算或成本优化才能保存**。如果还没有计算结果，告诉用户先进行计算。
- 保存成功后告诉用户已保存，让用户放心。
- **已废弃**：v10.10 起基准配合比库已下线，不要再调用 save_to_basic_mix_library / save_basic_mix_design / list_basic_mix_designs / delete_basic_mix_design 等旧 skill。

### 创建自定义技能
- 用户说"我想加一个XX功能"、"帮我创建一个XX工具"、"能不能支持XX"时，先检查是否已有功能重复的已有技能（通过 manage_skills(list) 查看）。如果有，直接使用已有技能，不要重复创建
- 只有确认没有匹配的已有技能时，才调用 create_skill 创建新技能
- 创建技能时需要收集：技能名称（英文）、描述、功能说明、参数定义
- 技能创建后会自动加载，用户可以立即使用

### 管理自定义技能
- 用户说"我有哪些技能"、"查看自定义技能"、"删除XX技能"时，调用 manage_skills。
- 操作类型：list=列表, delete=删除, info=查看信息, help=帮助。

## 视觉模型配置

如果用户没有配置视觉模型（base url / api key / model），而当前消息涉及图片分析，
请主动引导用户配置：

用户可以说：「配置视觉模型，base url 是 xxx，api key 是 yyy，模型名 zzz」

调用 configure_vision_model 技能完成配置。配置完成后即可使用 analyze_concrete_image。
如需查看当前配置，调用 get_vision_config；如需清除配置，调用 clear_vision_config。

## 图片分析能力

你可以调用 analyze_concrete_image 技能识别图片内容（混凝土缺陷、试块、配合比表、仪表读数等）。
该技能**只负责抽取图片中的结构化信息**（缺陷描述、OCR 数字、试块外观等），**不做诊断**。

诊断、调参、报告生成由你（Agent）结合现有工具（calculate_mix_design、predict_performance 等）综合推理完成。

工作区中的图片可通过绝对路径传入 imagePath 参数调用该技能。

## 联网搜索能力

你可以调用 web_search 技能联网搜索最新资料（规范条文、材料参数、行情等时效性信息），
返回结果仅含标题/URL/摘要，不含网页正文。

何时调用：仅当工作区 wiki 知识不足以回答用户问题时才搜，不要每轮都搜。

未配置时：引导用户说「配置联网搜索，服务商 bocha/tavily/tinyfish，api key 是 xxx」，调用 configure_web_search 完成配置。
服务商说明：bocha（国内免费）/ tavily（海外）/ tinyfish（海外免费，其 key 同时可用于 web_fetch 抓取网页正文）。
查看配置调 get_web_search_config，清除调 clear_web_search_config。

## 网页抓取能力

你可以调用 web_fetch 技能抓取任意 URL 的完整正文，返回干净的 Markdown/JSON/HTML/Text。
web_search 返回的 URL 想看完整正文时调用 web_fetch（如规范全文、行情详情、技术博客、新闻报道）。

provider 默认 auto：web_search 配了 tinyfish 就用 tinyfish（150 URL/分钟），否则用 Jina Reader（免 key，约 20 RPM）。
两者都是国外服务，国内网络需开启全局代理或 TUN 模式；若用户网络无法访问，请改用 web_search 查看摘要。

配置切换调 configure_web_fetch（provider: auto/jina/tinyfish），查看调 get_web_fetch_config，清除调 clear_web_fetch_config。
注意：tinyfish 的 key 与 web_search 共用，不单独配置；选 tinyfish 前需先配 web_search 的 tinyfish key。

## 学术搜索能力

你可以调用 academic_search 技能搜索科技论文（中英文期刊、预印本），
返回结构化字段：标题/作者/年份/期刊/摘要/DOI/引用数/开放获取 PDF 链接。
支持 search（按关键词搜索论文列表）和 fetch（拿单篇论文全文信息）两种模式。

何时调用：用户问「最新研究/论文/某某方法/引用文献」时；老板粘出版社 URL 时自动抽 DOI 再查。

学术搜索 vs 联网搜索：找论文/方法/引用 → academic_search；找新闻/规范/行情 → web_search。

PDF 下载：仅当老板明确指名（如「下载第 3 篇」、「下载这篇」）才下载并入工作区知识库，默认不下载，避免无意义流量。

学术搜索配置（全部走对话，无需 UI）：
- 老板说「学术搜索用 OpenAlex」 → configure_academic_search
- 老板说「禁用 arxiv 兜底」 → configure_academic_search
- 老板说「学术搜索现在用哪家」 → get_academic_search_config
- 老板说「清除学术搜索配置」 → clear_academic_search_config
默认配置：provider=semantic_scholar, arxivFallback=true。无需 API key，所有 API 免费。

中文搜索优化：使用 semantic_scholar 或 openalex 搜索时，如果 query 含中文，先自行翻译成英文再传入。例：query="C50 自密实混凝土抗冻性" → 翻译为 "C50 self-compacting concrete frost resistance"。用 wanfang 搜中文期刊时保留中文 query，不用翻译。
`
    }

    let userMessage = message
    if (context) {
      userMessage = `用户问题是：${message}\n\n相关配合比数据背景：\n${JSON.stringify(context, null, 2)}`
    }

    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20)
    }

    const historyStr = JSON.stringify(this.conversationHistory)
    const totalInputChars = systemPrompt.length + historyStr.length + userMessage.length
    const estimatedTokens = Math.ceil(totalInputChars / 4)
    if (estimatedTokens > cfg.contextLimit) {
      throw new Error(`对话上下文过大（约 ${estimatedTokens} tokens，超过 ${cfg.contextLimit} 上限），请清空对话历史后重试。`)
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: userMessage }
    ]

    try {
      // First API call (with tools if toolExecutor provided)
      let aiMessage = stream
        ? await this._callAPIStream(messages, !!toolExecutor, onEvent)
        : await this._callAPI(messages, !!toolExecutor)

      // Tool call loop
      // v1.2: 复用上方的 cfg 变量（不加 TTL 也只多调一次数据库；加 TTL 后完全免费）
      const MAX_TOOL_ROUNDS = cfg.maxSteps
      let round = 0

      while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0 && toolExecutor && round < MAX_TOOL_ROUNDS) {
        round++

        // Add AI tool_calls message to history
        messages.push(aiMessage)

        // Execute each tool call and add results
        for (const tc of aiMessage.tool_calls) {
          let toolResult
          let args = {}
          try {
            args = JSON.parse(tc.function.arguments)
            if (onEvent) {
              onEvent({
                type: 'tool_start',
                toolCallId: tc.id,
                toolName: tc.function.name,
                args
              })
            }
            toolResult = await toolExecutor(tc.function.name, args)
          } catch (execError) {
            toolResult = { success: false, error: `工具执行失败: ${execError.message}` }
          }
          if (onEvent) {
            onEvent({
              type: toolResult?.success === false ? 'tool_error' : 'tool_done',
              toolCallId: tc.id,
              toolName: tc.function.name,
              args,
              result: toolResult,
              error: toolResult?.error
            })
          }
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult)
          })
        }

        // Call API again (always include tools when in tool loop)
        aiMessage = stream
          ? await this._callAPIStream(messages, true, onEvent)
          : await this._callAPI(messages, true)
      }

      const content = aiMessage.content || '（AI 未返回文本内容）'

      if (!rawMode) {
        this.conversationHistory.push({ role: 'user', content: userMessage })
        const assistantMsg = { role: 'assistant', content: content }
        if (aiMessage.reasoning_content) {
          assistantMsg.reasoning_content = aiMessage.reasoning_content
        }
        this.conversationHistory.push(assistantMsg)
      }

      return {
        reply: content,
        toolCalls: aiMessage.tool_calls || null,
        messages, // Return full message list for frontend to extract tool_call display data
        usage: aiMessage.usage || null,
        contextLimit: cfg.contextLimit || 800000,
      }
    } catch (error) {
      throw await this._buildClassifiedError(error, 'DeepSeekService.chat')
    }
  }
}

// 挂载从独立模块拆出的原型方法（优化项 2，行为不变）
Object.assign(DeepSeekService.prototype, {
  _applyProviderFeatures,
  _callAPI,
  chatWithTools,
  chatWithToolsStream,
  _callAPIStream,
  _readErrorBody,
  _callSummaryAPI,
  compressContext,
  clearHistory
})

module.exports = DeepSeekService
// 导出内联思考解析器，供测试和诊断脚本使用
module.exports.parseInlineThinking = parseInlineThinking
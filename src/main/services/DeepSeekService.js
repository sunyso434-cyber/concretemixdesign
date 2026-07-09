/**
 * DeepSeek API 服务
 * 用于调用云端AI分析混凝土配合比数据
 */

const axios = require('axios')
const { DEFAULT_AGENT_MAX_STEPS, AGENT_CONFIG_CACHE_TTL_MS } = require('../utils/agentConstants')
const { createError } = require('../agent/ErrorCodes')

// Skill 系统引用 (由 agentHandler 设置)
let _skillRegistry = null
let _skillExecutor = null

// 注意：TOOLS 数组仅供 standalone chat 模式作为 fallback 使用
// Agent 模式和流式聊天均通过 _skillRegistry 获取工具定义
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_available_materials',
      description: '查询材料库中可用的原材料列表。用于了解有哪些材料可选，帮助用户做材料选择。同时基于材料属性做定性对比分析。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: '材料类型筛选：水泥/细骨料/粗骨料/粉煤灰/矿渣粉/锂渣/复合粉/减水剂。不填返回全部。',
            enum: ['水泥', '细骨料', '粗骨料', '粉煤灰', '矿渣粉', '锂渣', '复合粉', '减水剂']
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate_mix_design',
      description: '根据给定参数计算混凝土配合比。返回各材料用量、水胶比、砂率、容重、成本等结果。当用户要设计新配合比时调用此工具。调用前必须确认所有必填参数已由用户提供。',
      parameters: {
        type: 'object',
        properties: {
          strength: { type: 'string', description: '强度等级，如 C30、C40' },
          slump: { type: 'number', description: '坍落度(mm)，如 180' },
          cementId: { type: 'integer', description: '水泥材料ID' },
          sandIds: { type: 'array', items: { type: 'integer' }, description: '细骨料ID列表，支持1-2种' },
          stoneIds: { type: 'array', items: { type: 'integer' }, description: '粗骨料ID列表，支持1-2种' },
          flyAshId: { type: 'integer', description: '粉煤灰材料ID（可选）' },
          slagId: { type: 'integer', description: '矿渣粉材料ID（可选）' },
          lithiumSlagId: { type: 'integer', description: '锂渣材料ID（可选）' },
          compositePowderId: { type: 'integer', description: '复合粉材料ID（可选）' },
          superplasticizerId: { type: 'integer', description: '减水剂材料ID（可选）' },
          flyAshDosage: { type: 'number', description: '粉煤灰掺量(%)，如 15' },
          slagDosage: { type: 'number', description: '矿渣粉掺量(%)，如 20' },
          lithiumSlagDosage: { type: 'number', description: '锂渣掺量(%)' },
          compositePowderDosage: { type: 'number', description: '复合粉掺量(%)' },
          sandRatio: { type: 'number', description: '砂率(%)，不填则根据规范自动计算' },
          calculationMethod: { type: 'string', enum: ['absolute', 'mass'], description: '计算方法：absolute=绝对体积法(默认), mass=质量法' },
          targetDensity: { type: 'number', description: '目标容重(kg/m³)，仅质量法时使用' },
          airContent: { type: 'number', description: '含气量(%)，默认1.0' },
          tempSettings: {
            type: 'object',
            description: '温度参数（可选），用于覆盖系统默认值',
            properties: {
              regressionAlphaA: { type: 'number', description: '回归系数 αa，默认0.53' },
              regressionAlphaB: { type: 'number', description: '回归系数 αb，默认0.20' },
              strengthStdDev: { type: 'number', description: '强度标准差 σ(MPa)' },
              mbInfluence: { type: 'number', description: 'MB值影响(%)，默认0.1' },
              finenessInfluence: { type: 'number', description: '细度模数影响(%)，默认0.1' },
              strengthInfluence: { type: 'number', description: '强度等级影响(%)，默认0.1' },
              targetFinenessModulusBase: { type: 'number', description: '用户指定的当前强度等级最终目标组合细度模数（不是C30基准值）。例如用户说"C45目标细度模数3.0"则传3.0，系统直接使用该值作为C45的最终目标。' }
            }
          }
        },
        required: ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'optimize_mix_cost',
      description: '对给定材料和约束条件执行网格搜索，找出成本最低的混凝土配合比方案。当用户要寻找最低成本方案时调用此工具。计算量较大，默认后台运行。',
      parameters: {
        type: 'object',
        properties: {
          strength: { type: 'string', description: '强度等级，如 C30' },
          slump: { type: 'number', description: '坍落度(mm)' },
          cementId: { type: 'integer', description: '水泥材料ID' },
          sandIds: { type: 'array', items: { type: 'integer' }, description: '细骨料候选ID列表' },
          stoneIds: { type: 'array', items: { type: 'integer' }, description: '粗骨料候选ID列表' },
          flyAshIds: { type: 'array', items: { type: 'integer' }, description: '粉煤灰候选ID列表（可选）' },
          slagIds: { type: 'array', items: { type: 'integer' }, description: '矿渣粉候选ID列表（可选）' },
          lithiumSlagIds: { type: 'array', items: { type: 'integer' }, description: '锂渣候选ID列表（可选）' },
          compositePowderIds: { type: 'array', items: { type: 'integer' }, description: '复合粉候选ID列表（可选）' },
          superplasticizerIds: { type: 'array', items: { type: 'integer' }, description: '减水剂候选ID列表（可选）' },
          flyAshRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '粉煤灰掺量范围 [min, max]，默认 [0, 30]' },
          slagRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '矿渣粉掺量范围，默认 [0, 20]' },
          lithiumSlagRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '锂渣掺量范围，默认 [0, 20]' },
          compositePowderRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '复合粉掺量范围，默认 [0, 20]' },
          gridStep: { type: 'number', description: '网格搜索步长，默认 5' },
          background: { type: 'boolean', description: '是否后台运行，默认 true' },
          tempSettings: {
            type: 'object',
            description: '温度参数（可选），用于覆盖系统默认值',
            properties: {
              regressionAlphaA: { type: 'number', description: '回归系数 αa，默认0.53' },
              regressionAlphaB: { type: 'number', description: '回归系数 αb，默认0.20' },
              strengthStdDev: { type: 'number', description: '强度标准差 σ(MPa)' },
              mbInfluence: { type: 'number', description: 'MB值影响(%)，默认0.1' },
              finenessInfluence: { type: 'number', description: '细度模数影响(%)，默认0.1' },
              strengthInfluence: { type: 'number', description: '强度等级影响(%)，默认0.1' },
              targetFinenessModulusBase: { type: 'number', description: '用户指定的当前强度等级最终目标组合细度模数（不是C30基准值）。例如用户说"C45目标细度模数3.0"则传3.0，系统直接使用该值作为C45的最终目标。' }
            }
          }
        },
        required: ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'predict_performance',
      description: '基于XGBoost模型预测混凝土性能指标（28d抗压强度、坍落度、容重）。输入配合比参数和材料ID，自动从数据库查询材料属性，输出预测值及置信度。支持质量(kg/m³)和百分比(%)两种输入格式，优先使用质量格式。',
      parameters: {
        type: 'object',
        properties: {
          waterBinderRatio: { type: 'number', description: '水胶比' },
          cementAmount: { type: 'number', description: '水泥用量kg/m³' },
          flyAshDosage: { type: 'number', description: '粉煤灰掺量%未用填0' },
          slagDosage: { type: 'number', description: '矿渣粉掺量%未用填0' },
          lithiumSlagDosage: { type: 'number', description: '锂渣掺量%未用填0' },
          compositePowderDosage: { type: 'number', description: '复合粉掺量%未用填0' },
          sandRatio: { type: 'number', description: '砂率%' },
          superplasticizerDosage: { type: 'number', description: '减水剂掺量%未用填0' },
          waterAmount: { type: 'number', description: '用水量kg/m³（与水胶比二选一，质量优先）' },
          flyAshAmount: { type: 'number', description: '粉煤灰用量kg/m³' },
          slagAmount: { type: 'number', description: '矿渣粉用量kg/m³' },
          lithiumSlagAmount: { type: 'number', description: '锂渣用量kg/m³' },
          compositePowderAmount: { type: 'number', description: '复合粉用量kg/m³' },
          sandAmount: { type: 'number', description: '砂用量kg/m³' },
          stoneAmount: { type: 'number', description: '石用量kg/m³' },
          superplasticizerAmount: { type: 'number', description: '减水剂用量kg/m³' },
          cementId: { type: 'integer', description: '水泥材料ID' },
          sandId: { type: 'integer', description: '细骨料材料ID' },
          stoneId: { type: 'integer', description: '粗骨料材料ID' },
          flyAshId: { type: 'integer', description: '粉煤灰材料ID未用填0' },
          slagId: { type: 'integer', description: '矿渣粉材料ID未用填0' },
          lithiumSlagId: { type: 'integer', description: '锂渣材料ID未用填0' },
          compositePowderId: { type: 'integer', description: '复合粉材料ID未用填0' },
          superplasticizerId: { type: 'integer', description: '减水剂材料ID未用填0' },
          temperature: { type: 'number', description: '养护温度℃默认20' },
          humidity: { type: 'number', description: '相对湿度%默认95' },
          curingAge: { type: 'number', description: '龄期天数默认28' }
        },
        required: ['cementId', 'sandId', 'stoneId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reverse_sales_quote',
      description: '【普通混凝土·反向套价】按市场价反推。必传 targetUnitPrice（含税元/m³）+ 配合比(mixDesignId 或 materials)。利润区间默认 [0.5%, 3%]，可由用户动态调整。利润偏离区间时自动按"材料单价包装"/"制造费包装"/"人工费包装"等策略藏利润。**与 forward_sales_quote 区别**：本工具反向套市价；forward 是正向测算。当用户说"按市场价 X 算报价"调用本工具。',
      parameters: {
        type: 'object',
        properties: {
          mixDesignId: { type: 'integer', description: '正式方案 ID（与 materials 二选一）' },
          materials: { type: 'array', description: '配合比材料明细' },
          targetUnitPrice: { type: 'number', description: '目标市价（含税元/m³），必填' },
          strengthGrade: { type: 'string', description: '强度等级' },
          concreteType: { type: 'string', description: '混凝土类型' },
          slump: { type: 'number', description: '坍落度 mm' },
          fixedFees: { type: 'object', description: '固定费用明细' },
          polishStrategy: { type: 'string', description: '包装策略：none / material_price（默认）/ manufacturing / labor' },
          profitSafeRange: { type: 'array', items: { type: 'number' }, description: '安全利润率区间 [min, max]，默认 [0.005, 0.03]，可由用户动态调整' },
          vatRate: { type: 'number', description: '增值税率，默认 0.13' }
        },
        required: ['targetUnitPrice']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'forward_sales_quote',
      description: '【特殊混凝土·正向议价测算】按成本+利润出三档议价区间。必传 mixDesignId 或 materials + fixedFees（费用明细）。可选 equipmentAmortization {purchaseCost, totalAmortizeVolume, currentOrderVolume} 用于新进设备摊销（采购价÷预计总方量）。利润区间默认 [10%, 40%]，输出最低/建议/最高三档含税价。**与 reverse_sales_quote 区别**：本工具正向测算；reverse 反向套市价。当用户说"算特殊混凝土报价（含新设备分摊）"调用本工具。',
      parameters: {
        type: 'object',
        properties: {
          mixDesignId: { type: 'integer', description: '正式方案 ID（与 materials 二选一）' },
          materials: { type: 'array', description: '配合比材料明细' },
          strengthGrade: { type: 'string' },
          concreteType: { type: 'string' },
          slump: { type: 'number' },
          fixedFees: { type: 'object', description: '固定费用明细 {manufacturingFee, laborFee, technicalServiceFee, transportDistance, transportUnitPrice}' },
          equipmentAmortization: { type: 'object', description: '设备摊销 {purchaseCost, totalAmortizeVolume, currentOrderVolume}' },
          profitRange: { type: 'array', items: { type: 'number' }, description: '利润区间 [min, max]，默认 [0.10, 0.40]' },
          vatRate: { type: 'number', description: '增值税率，默认 0.13' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'format_quote_report',
      description: '【报价单导出】把 reverse_sales_quote / forward_sales_quote 算出的 quote 对象，转换成 workspace_writeFile 接受的 {title, sections} payload，写入工作区 reports/ 目录。文件类型支持 docx / xlsx / md。**与 workspace_writeFile 的区别**：本工具专门处理 quote 对象，自动应用 9 块结构（材料/制造/人工/技术/运输/设备/利润/增值税/总价）和报价说明（reverse 体现包装策略、forward 体现设备费/技术服务费说明）。',
      parameters: {
        type: 'object',
        properties: {
          quote: { type: 'object', description: 'reverse_sales_quote / forward_sales_quote 返回的 data 字段' },
          mode: { type: 'string', description: 'reverse / forward，影响报告 sections 内容' },
          type: { type: 'string', description: 'docx / xlsx / md，默认 docx' },
          filename: { type: 'string', description: '输出文件名，默认 "C{强度}报价单-{日期}.docx"' }
        },
        required: ['quote']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_mix_design',
      description: '将当前配合比方案保存到方案库。当用户说"保存方案"、"把这个存起来"、"保存这个配合比"时调用。必须先完成配合比计算或成本优化。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '方案名称（可选），不填则自动生成' },
          projectName: { type: 'string', description: '项目名称（可选），默认"AI智能设计"' }
        },
        required: []
      }
    }
  },
  ]

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
    } else if (data && typeof data === 'object') {
      try {
        rawMessage = JSON.stringify(data).slice(0, 500)
      } catch (_) { }
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

  async _readErrorBody(data) {
    if (!data) return null
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
    return data
  }

  /**
   * 设置 Skill 注册表 (静态方法)
   * @param {object} registry - SkillRegistry 实例
   */
  static setSkillRegistry(registry) {
    _skillRegistry = registry
  }

  /**
   * 设置 Skill 执行器 (静态方法)
   * @param {object} executor - SkillExecutor 实例
   */
  static setSkillExecutor(executor) {
    _skillExecutor = executor
  }

  /**
   * 获取工具定义 (优先从 SkillRegistry)
   * @returns {object[]} 工具定义数组
   */
  static getToolDefinitions() {
    if (_skillRegistry) {
      return _skillRegistry.getToolSchemas()
    }
    return TOOLS
  }

  /**
   * 获取 Skill 执行器
   * @returns {object|null} SkillExecutor 实例
   */
  static getSkillExecutor() {
    return _skillExecutor
  }

  async chatStream(message, context = null, options = {}) {
    return this.chat(message, context, {
      ...options,
      stream: true
    })
  }

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
  _applyProviderFeatures(requestBody, cfg) {
    const features = cfg.features || {}

    // max_completion_tokens 优先（MiniMax-M3/OpenAI/Moonshot 推荐），其次 max_tokens
    if (features.supportsMaxCompletionTokens && cfg.maxTokens) {
      requestBody.max_completion_tokens = cfg.maxTokens
    } else if (features.supportsMaxTokens && cfg.maxTokens) {
      requestBody.max_tokens = cfg.maxTokens
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
  async _callAPI(messages, includeTools = false) {
    const cfg = await this._getConfig()
    const requestBody = {
      model: cfg.model,
      messages,
    }
    this._applyProviderFeatures(requestBody, cfg)
    if (includeTools) {
      const features = cfg.features || {}
      if (features.supportsTools !== false) {
        requestBody.tools = _skillRegistry ? _skillRegistry.getToolSchemas() : TOOLS
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
  async chatWithTools(messages, tools) {
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
  async chatWithToolsStream(messages, tools, onEvent) {
    try {
      return await this._callAPIStream(messages, true, onEvent, tools)
    } catch (error) {
      throw await this._buildClassifiedError(error, 'DeepSeekService.chatWithToolsStream')
    }
  }

  async _callAPIStream(messages, includeTools = false, onEvent = null, customTools = null) {
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
        requestBody.tools = _skillRegistry ? _skillRegistry.getToolSchemas() : TOOLS
      }
    }

    const apiUrl = `${(cfg.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '')}/chat/completions`
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey || this.config.apiKey}`
      },
      responseType: 'stream',
      timeout: cfg.timeout
    })

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
          finalMessage.content += delta.content
          if (onEvent) {
            onEvent({ type: 'text_delta', content: delta.content })
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
  async _readErrorBody(data) {
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

  /**
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
4. **predict_performance**: 性能预测。根据配合比参数和材料属性，预测28d强度、坍落度、容重。
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
        messages // Return full message list for frontend to extract tool_call display data
      }
    } catch (error) {
      throw await this._buildClassifiedError(error, 'DeepSeekService.chat')
    }
  }

  /**
   * 清空对话历史
   */
  clearHistory() {
    this.conversationHistory = []
  }

  // ========== Task 4: 上下文压缩（context monitor ring button）==========

  /**
   * 调用 DeepSeek API 生成对话摘要（单次非流式）。
   * 不走工具、不走对话历史，temperature 调低（0.3）保证摘要稳定性。
   * @param {object} cfg - _getConfig() 返回的配置
   * @param {string} systemPrompt - 系统提示词
   * @param {string} userPrompt - 用户提示词（含 5 段模板 + 历史文本）
   * @returns {Promise<{summary: string, realTokens: number}>} 摘要文本 + 真实 token
   */
  async _callSummaryAPI(cfg, systemPrompt, userPrompt) {
    const baseUrl = cfg.baseUrl || 'https://api.deepseek.com/v1'
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`LLM API 错误：${response.status} ${errText}`)
    }

    const data = await response.json()
    const summary = data.choices?.[0]?.message?.content || ''
    const realTokens = data.usage?.total_tokens || 0
    return { summary, realTokens }
  }

  /**
   * 压缩上下文：把长对话历史的"head"部分摘要化，"tail"部分保留原样。
   * 用法：返回的 { summary, recentMessages } 由 IPC 传给渲染层，
   *       渲染层把 summary 注入到 system 提示，recentMessages 作为 messages 数组的后半段。
   * @param {Array} messages - 完整 messages 数组
   * @param {string} [previousSummary=''] - 之前累积的摘要（增量摘要）
   * @returns {Promise<{summary: string, recentMessages: Array, realTokens: number}>}
   */
  async compressContext(messages, previousSummary = '') {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('对话为空，无法压缩')
    }
    const userCount = messages.filter(m => m && m.role === 'user').length
    if (userCount < 2) {
      throw new Error('对话过短，无需压缩')
    }

    const cfg = await this._getConfig()
    const contextLimit = cfg.contextLimit || DEFAULT_CONTEXT_LIMIT
    // 预算 = contextLimit * 25%，再夹到 [2000, 8000] 区间
    const budget = Math.min(
      MAX_PRESERVE_RECENT_TOKENS,
      Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(contextLimit * 0.25))
    )

    // 1. 按预算把 messages 切成 head（待压缩） + tail（保留原样）
    const { head, tail } = selectTail(messages, budget)

    // 2. head → 文本
    const messagesText = messagesToText(head)
    if (!messagesText) {
      throw new Error('无可压缩的对话内容')
    }

    // 3. 拼 5 段 prompt，调 API
    const userPrompt = buildCompressUserPrompt(messagesText, previousSummary)
    const { summary, realTokens } = await this._callSummaryAPI(cfg, COMPRESS_SYSTEM_PROMPT, userPrompt)

    if (!summary || !summary.trim()) {
      throw new Error('AI 未返回有效摘要，请重试')
    }

    return {
      summary: summary.trim(),
      recentMessages: tail,
      // 取 API 真实 token（API 返回 0 时退化为 0）
      realTokens: realTokens || 0
    }
  }
}

// ========== Task 4: 压缩相关常量与辅助函数 ==========

const { messagesToText, DEFAULT_CONTEXT_LIMIT } = require('../../shared/utils/contextStats')

const MIN_PRESERVE_RECENT_TOKENS = 2000
const MAX_PRESERVE_RECENT_TOKENS = 8000

/**
 * 5 段摘要系统提示词
 */
const COMPRESS_SYSTEM_PROMPT = `你是一个混凝土配合比设计领域的专业对话摘要助手。
你的任务是把一段长对话历史压缩成结构化摘要，供后续 AI agent 继续工作时参考。
摘要必须保留所有可执行的关键信息：用户需求、关键参数、已完成步骤、待办事项。`

/**
 * 拼接 5 段摘要用户提示词，previousSummary 非空时附加在末尾
 */
function buildCompressUserPrompt(messagesText, previousSummary) {
  const base = `请将以下对话历史压缩为结构化摘要，严格按以下模板：

---
## Goal

[用户想要达成的目标是什么？]

## Instructions

- [用户给出过哪些关键指令、约束、偏好？]
- [如果有配合比/方案相关的参数（强度等级、坍落度、材料用量），必须保留具体数值]
- [如果用户引用了规范条文（GB/T、JGJ 等），必须保留条文编号]

## Discoveries

- [对话过程中发现了哪些关键事实？（已验证的假设、隐藏的约束、可复用的数据）]

## Accomplished

- ✅ 已完成：[...具体完成的动作、生成的方案、调用的工具]
- 🔄 进行中：[...未完成的步骤]
- ⏳ 待办：[...接下来需要做的事]

## Relevant data

- 配合比参数：[...所有具体数值，包括水胶比、砂率、外加剂掺量等]
- 引用规范：[...所有用到的规范编号]
- 文件/方案 ID：[...相关的方案 ID、材料 ID、文件路径]
---

对话历史：
"""
${messagesText}
"""`

  const summaryHint = previousSummary
    ? `\n\n补充：以下是之前的摘要，请把新对话的内容合并进去：\n${previousSummary}\n`
    : ''

  return `${base}${summaryHint}\n\n只输出摘要内容，不要任何额外解释。`
}

/**
 * 按 token 预算从 messages 尾部反向累积，保留最近的 N 个 user 轮。
 * - 每一轮 = 从某条 user 起到下一条 user 之前的连续切片
 * - tokens 估算：Math.ceil(sum(content.length) / 4)
 * - 至少要保留第一个能放进去的轮（即使超预算）
 *
 * @param {Array} messages
 * @param {number} budget - token 预算
 * @returns {{head: Array, tail: Array}}
 */
function selectTail(messages, budget) {
  // 1. 把 messages 按 user 轮分组
  const turns = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i] && messages[i].role === 'user') {
      let end = messages.length
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j] && messages[j].role === 'user') { end = j; break }
      }
      turns.push({ start: i, end })
    }
  }
  if (turns.length === 0) return { head: messages, tail: [] }

  // 2. 从最新轮往旧方向累加
  let total = 0
  let tailStartIdx = null
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = messages.slice(turns[i].start, turns[i].end)
    const turnTokens = Math.ceil(
      turn.reduce((s, m) => s + ((m && m.content && m.content.length) || 0), 0) / 4
    )
    // 已至少装下 1 轮，再加就会爆预算 → 停止
    if (total + turnTokens > budget && tailStartIdx !== null) break
    total += turnTokens
    tailStartIdx = turns[i].start
  }

  if (tailStartIdx === null) {
    return { head: messages, tail: [] }
  }
  return {
    head: messages.slice(0, tailStartIdx),
    tail: messages.slice(tailStartIdx)
  }
}

module.exports = DeepSeekService

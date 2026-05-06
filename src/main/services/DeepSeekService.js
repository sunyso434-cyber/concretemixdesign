/**
 * DeepSeek API 服务
 * 用于调用云端AI分析混凝土配合比数据
 */

const axios = require('axios')

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

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
          airContent: { type: 'number', description: '含气量(%)，默认1.0' }
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
          background: { type: 'boolean', description: '是否后台运行，默认 true' }
        },
        required: ['strength', 'slump', 'cementId', 'sandIds', 'stoneIds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compare_materials',
      description: '对比不同材料对配合比结果的影响。对每个候选材料调用 calculate_mix_design 并汇总关键指标（28d强度、成本、水胶比）。当用户追问具体材料差异时调用。',
      parameters: {
        type: 'object',
        properties: {
          strength: { type: 'string', description: '强度等级，如 C30' },
          slump: { type: 'number', description: '坍落度(mm)' },
          compareType: { type: 'string', enum: ['cement', 'flyAsh', 'slag', 'lithiumSlag', 'compositePowder', 'superplasticizer', 'sand', 'stone'], description: '要对比的材料品类' },
          baseParams: {
            type: 'object',
            description: '固定不变的参数。必须包含 strength, slump 以及不参与对比的材料ID组（如对比水泥时需填 sandIds、stoneIds 等）',
            properties: {
              cementId: { type: 'integer' },
              sandIds: { type: 'array', items: { type: 'integer' } },
              stoneIds: { type: 'array', items: { type: 'integer' } },
              flyAshId: { type: 'integer' },
              slagId: { type: 'integer' },
              lithiumSlagId: { type: 'integer' },
              compositePowderId: { type: 'integer' },
              superplasticizerId: { type: 'integer' },
              flyAshDosage: { type: 'number' },
              slagDosage: { type: 'number' },
              lithiumSlagDosage: { type: 'number' },
              compositePowderDosage: { type: 'number' },
              sandRatio: { type: 'number', description: '砂率(%)，不填则根据规范自动计算' },
              calculationMethod: { type: 'string', enum: ['absolute', 'mass'], description: '计算方法：absolute=绝对体积法(默认), mass=质量法' }
            }
          },
          candidateIds: { type: 'array', items: { type: 'integer' }, description: '候选材料ID列表' },
          dosages: { type: 'array', items: { type: 'number' }, description: '对应掺量(%)，仅对比粉煤灰/矿渣粉/锂渣/复合粉时需要' }
        },
        required: ['strength', 'slump', 'compareType', 'baseParams', 'candidateIds']
      }
    }
  }
]

class DeepSeekService {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.conversationHistory = []
  }

  /**
   * 调用 DeepSeek API 发送请求
   * @param {Array} messages - 消息列表
   * @param {boolean} includeTools - 是否携带工具定义
   * @returns {Promise<Object>} - API返回的message对象
   */
  async _callAPI(messages, includeTools = false) {
    const requestBody = {
      model: 'deepseek-v4-flash',
      messages,
      max_tokens: 4096,
      extra_body: {
        thinking: { type: 'enabled' }
      }
    }
    if (includeTools) {
      requestBody.tools = TOOLS
    }

    const response = await axios.post(DEEPSEEK_API_URL, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      timeout: 120000
    })

    return response.data.choices[0].message
  }

  /**
   * 与AI对话（支持 Function Calling 工具调用循环）
   * @param {string} message - 用户消息
   * @param {Array} context - 上下文数据（配合比数据等）
   * @param {Object} options - 可选配置
   * @param {Function} options.toolExecutor - 工具执行回调，签名为 async (toolName, args) => result
   * @returns {Promise<Object>} - { reply, toolCalls, messages }
   */
  async chat(message, context = null, options = {}) {
    if (!this.apiKey) {
      throw new Error('DeepSeek API密钥未配置')
    }

    const { toolExecutor } = options
    const systemPrompt = `你是一个混凝土配合比分析专家，擅长分析材料性能参数对混凝土性能的影响。
你可以回答关于混凝土配合比设计、材料选择、性能优化、成本控制等各方面的问题。
请用专业的知识帮助用户解答疑问。

## 函数调用指南

你可以使用以下工具来辅助用户完成配合比设计和成本优化：

1. **list_available_materials**: 查询材料库。在帮助用户做材料选择之前，先调用此工具了解可用材料。
2. **calculate_mix_design**: 计算配合比。用户提供了完整参数后调用。
3. **optimize_mix_cost**: 成本优化。用户要找最低成本方案时调用。
4. **compare_materials**: 材料对比。用户要求定量对比两种材料时调用。

### 材料选择流程（重要）
- 第一次收到配合比设计或优化请求时，先调用 list_available_materials 获取可用材料
- 向用户展示可选材料并做定性对比建议（基于材料属性：强度、价格、活性等）
- 用户说"用默认值"或明确选定时，再调用计算工具
- 永远不要跳过参数确认直接调用计算工具

### 参数规则（重要）
- 必填参数: strength, slump, cementId, sandIds, stoneIds
- 缺少必填参数时必须向用户追问，不可自行填充
- 只有当用户明确说"用默认值"、"默认就行"时，才允许省略非必填参数

### 材料对比
- 能力1（免费）: 获取材料列表后，基于属性做定性对比（如"P.O 42.5比P.O 42.5R便宜40元/吨"）
- 能力2（精确）: 用户追问"具体差多少"时，调用 compare_materials 工具给出量化对比`

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
    if (estimatedTokens > 120000) {
      throw new Error(`对话上下文过大（约 ${estimatedTokens} tokens），请清空对话历史后重试。`)
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: userMessage }
    ]

    try {
      // First API call (with tools if toolExecutor provided)
      let aiMessage = await this._callAPI(messages, !!toolExecutor)

      // Tool call loop
      const MAX_TOOL_ROUNDS = 5
      let round = 0

      while (aiMessage.tool_calls && aiMessage.tool_calls.length > 0 && toolExecutor && round < MAX_TOOL_ROUNDS) {
        round++

        // Add AI tool_calls message to history
        messages.push(aiMessage)

        // Execute each tool call and add results
        for (const tc of aiMessage.tool_calls) {
          let toolResult
          try {
            const args = JSON.parse(tc.function.arguments)
            toolResult = await toolExecutor(tc.function.name, args)
          } catch (execError) {
            toolResult = { success: false, error: `工具执行失败: ${execError.message}` }
          }
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult)
          })
        }

        // Call API again (always include tools when in tool loop)
        aiMessage = await this._callAPI(messages, true)
      }

      const content = aiMessage.content || '（AI 未返回文本内容）'

      this.conversationHistory.push({ role: 'user', content: userMessage })
      this.conversationHistory.push({ role: 'assistant', content: content })

      return {
        reply: content,
        toolCalls: aiMessage.tool_calls || null,
        messages // Return full message list for frontend to extract tool_call display data
      }
    } catch (error) {
      if (error.response) {
        const status = error.response.status
        const data = error.response.data
        if (status === 401) {
          throw new Error('DeepSeek API密钥无效')
        } else if (status === 429) {
          throw new Error('DeepSeek API请求频率超限，请稍后重试')
        } else {
          throw new Error(`DeepSeek API错误: ${data.error?.message || status}`)
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('DeepSeek API请求超时，请检查网络连接')
      } else {
        throw new Error(`DeepSeek API调用失败: ${error.message}`)
      }
    }
  }

  /**
   * 清空对话历史
   */
  clearHistory() {
    this.conversationHistory = []
  }

  /**
   * 构建分析系统提示词
   */
  buildSystemPrompt(data, customPrompt = '') {
    const req = data.analysisRequirements || {}

    // 提取试验目的（从用户自定义提示词中）
    let testPurposeText = ''
    if (customPrompt && customPrompt.trim()) {
      testPurposeText = `\n\n## 用户试验目的\n${customPrompt.trim()}\n\n重要：上述试验目的应贯穿所有分析项。每个分析项都应优先聚焦与试验目的相关的参数、材料和问题，有针对性地展开分析。`
    }

    let prompt = `你是一个混凝土配合比分析专家，擅长分析材料性能参数对混凝土性能的影响。
请基于提供的数据，按照以下工作流逐项进行分析，输出JSON格式的分析报告。
${testPurposeText}

═══════════════════════════════════════`

    // ========== 1. 材料性能影响分析 ==========
    if (req.analyzeMaterialInfluences !== false) {
      prompt += `
## 1. 材料性能影响分析

**分析决策树：按强度等级分组后，根据数据情况选择分析路径**

### 第一步：按强度等级分组
将配合比数据按强度等级分组，每组独立执行后续分析。跨强度等级的处理规则：
- 各强度等级间材料选择不同 → 各等级独立分析，不做跨等级比较
- 各强度等级间材料选择相同 → 重点分析同一材料在不同强度等级下的差异化表现，以及配合比参数调整如何实现强度等级的提升

### 第二步：判断分析路径（每组内）
- 若该组内配合比数量 ≥ 2：
  - 对比各配合比的材料选择（水泥、粉煤灰、矿渣粉、锂渣、复合粉、细骨料、粗骨料、减水剂是否有不同品牌/规格/等级）
  - 材料选择有差异 → 走路径A（材料差异分析）
  - 材料选择无差异 → 走路径B（配合比参数差异分析）
- 若该组内仅1条配合比 → 走路径C（单条数据分析）

### 第三步A — 材料差异分析（路径A）
先列出同组内各配合比所选材料的对比表：

| 材料类型 | 配合比X所选 | 配合比Y所选 | 具体参数及数值差异 |

然后逐材料、逐参数追溯差异链条：
- 格式：配合比X使用[材料名称]，[参数名]=[数值][单位]；配合比Y使用[材料名称]，[参数名]=[数值][单位]。[参数名]差异为[差值]，这解释了配合比X的[试验结果指标]比配合比Y[高/低][差值]
- 示例："配合比A使用水泥P.O 42.5，28d强度60MPa、比表面积380m²/kg；配合比B使用水泥P.O 42.5R，28d强度52MPa、比表面积320m²/kg。水泥28d强度差异8MPa、比表面积差异60m²/kg，是配合比A的R28高出配合比B 8MPa的主要原因"
- 若同一材料类型多个参数均有差异，按影响程度排序，指出哪个参数差异是主导因素
- 同时关注材料价格差异对每方成本的影响

### 第三步B — 配合比参数差异分析（路径B）
材料相同时，排除材料变量，聚焦配合比参数差异（水胶比、胶材用量、砂率、减水剂掺量等），找出是哪个参数的差异导致了两者试验结果的差异。此部分做定性归因（找出谁在起作用），定量分析留待第2部分完成。

### 第三步C — 单条数据分析（路径C）
仅1条数据无法做同等级对比。逐材料参数做定性关联分析。末尾注明"该强度等级仅1组数据，结论仅供参考"。

### 质量要求
- 必须引用数据中的具体数值，禁止泛泛而谈
- 数据为0或缺失的参数不分析，不可编造
- 每个判断必须有数据支撑
- 若用户提供了试验目的，优先聚焦与试验目的相关的材料参数`
    }

    // ========== 2. 配合比参数影响分析 ==========
    if (req.analyzeMixDesignInfluences !== false) {
      prompt += `

═══════════════════════════════════════

## 2. 配合比参数影响分析

承接第1部分（路径B）发现的线索，对配合比参数进行系统量化分析。

### 第一步：按强度等级分组
每组独立分析。

### 第二步：识别可变参数
列出该组内各配合比中实际存在差异的参数（数值相同的参数不分析）。常见参数：水胶比、水泥用量、粉煤灰用量、矿渣粉用量、锂渣用量、复合粉用量、砂率、减水剂掺量、减水剂用量。

### 第三步：单参数量化分析
- 固定其他参数相近的情况下，分析单个参数变化与试验结果变化的关联
- 给出量化关系：如"水胶比每降低0.01，R28约提升X MPa"
- 若存在多参数同时变化无法隔离的情况，注明"存在多参数协同变化，无法完全隔离单参数影响"

### 第四步：参数影响程度排序
- 按各参数对R28强度的影响程度（influence值）排序
- 标注每个参数对坍落度、扩展度、成本的影响方向和程度

### 第五步：跨强度等级归纳
- 不同强度等级间，同一参数的影响规律是否一致？
- 例如：水胶比降低在低等级和高等级的边际效应是否有差异

### 质量要求
- 量化数据必须来源于输入数据，不可凭空推算
- 若用户提供了试验目的，优先量化与试验目的相关的参数`
    }

    // ========== 3. 最优配合比设计 ==========
    if (req.generateOptimalMixDesign !== false) {
      prompt += `

═══════════════════════════════════════

## 3. 最优配合比设计

**核心要求：预测而非挑选。不要从现有配合比中选择编号输出，而是基于第1、2部分发现的规律，推算一组全新的、优于现有任何一条的配合比参数。**

### 第一步：汇总前两部分发现
- 从第1部分提取：哪些材料/参数组合对性能提升最有利且价格合理
- 从第2部分提取：各参数（水胶比、胶材用量、砂率等）对强度、工作性、成本的影响方向和量化关系

### 第二步：确定优化目标
- 目标强度：采用该强度等级的配制强度（配制强度 = 强度等级标准值 + 1.645×σ），σ固定取6MPa。示例：C30标准值30MPa，配制强度 = 30 + 1.645×6 ≈ 39.9MPa
- 目标工作性：基于数据中表现良好的坍落度和扩展度范围设定
- 成本约束：在数据覆盖的材料价格范围内，选择性价比最高的材料组合

### 第三步：预测生成
- 利用第2部分发现的参数-性能量化关系，推算达成配制强度所需的最小胶材用量和合理水胶比
- **预测强度约束**：预测配合比的预期28d强度应在配制强度±2MPa范围内（即配制强度-2MPa ≤ 预期R28 ≤ 配制强度+2MPa），不可偏离过远
- 利用第1部分的材料对比结论，选择成本低且性能达标的材料组合
- **自行计算**各材料用量、砂率、减水剂掺量等关键参数（这些值应基于规律推算，而非照搬某条现有数据）
- 输出完整配合比及预期性能、预期成本
- **输出的strengthGrade不要带"预测-"前缀，直接写强度等级如"C30"**

### 第四步：与现有配合比对比
- 将预测配合比与数据中现有配合比逐条对比，说明改进点
- comparisonWithExisting中的id应填写现有配合比的编号（不是预测配合比的编号）

### 第五步：可行性说明
- 指明预测基于的数据范围和假设条件
- 若数据样本不足，注明预测置信度有限
- 若用户提供了试验目的，配合比优化方向应服务于该目的`
    }

    // ========== 4. 参数调整建议 ==========
    if (req.provideSuggestions !== false) {
      prompt += `

═══════════════════════════════════════

## 4. 参数调整建议

问题先行——先识别问题，再追溯原因，最后给出调整方案。

### 第一步：问题识别
逐配合比扫描，对照该强度等级的合格标准，标识存在的问题：
- 性能问题：R28强度不达标、坍落度过低/过高、经时损失过大、扩展度不足等
- 经济问题：成本明显高于同等级其他配合比，或某材料用量偏高导致成本浪费
- 每个问题标注严重程度：严重（不达标）/ 一般（达标但偏弱或偏贵）

### 第二步：问题归因
对每个问题追溯原因：
- 性能问题 → 回到第1、2部分的分析结论，定位是材料参数不行还是配合比参数不合理
- 经济问题 → 定位是材料单价过高还是某材料用量不合理

### 第三步：给出建议
每条建议按以下结构输出：
- 问题描述：配合比X的[指标]=[数值]，存在[具体问题]
- 问题原因：经第1、2部分分析，原因为[具体原因]
- 调整方案：将[参数名]从[当前值]调整为[建议值]（若涉及更换材料，说明替换方案）
- 预期效果：预期[指标]从[当前值]改善至[预期值]

### 第四步：优先级排序
- 严重性能问题（不达标）→ 最高优先级
- 一般性能问题（达标但偏弱）+ 明显经济浪费 → 次优先级
- 优化空间较小的微调 → 低优先级
- 若用户提供了试验目的，与试验目的直接相关的问题应提高优先级`
    }

    // ========== 5. 进一步试验建议 ==========
    if (req.furtherTestSuggestions !== false) {
      prompt += `

═══════════════════════════════════════

## 5. 进一步试验建议

围绕用户提供的试验目的，设计验证性和探索性试验方案。

### 第一步：明确试验目标
- 从用户提供的试验目的中提取具体的试验目标
- 若用户未提供试验目的，基于前4部分分析中发现的问题和规律，主动列出几个可能的试验方向供参考

### 第二步：识别当前数据缺口
- 数据量不足：哪些强度等级配合比数量<3，需要补充验证
- 参数覆盖不全：材料性能参数中有哪些关键参数缺失
- 结论不确定：前4部分分析中哪些结论因数据不足而置信度有限

### 第三步：验证性试验建议
- 针对第3部分预测的最优配合比，建议进行验证试验
- 明确验证目标：是否达到配制强度、预期成本、预期工作性
- 建议同时做对比试验（预测配合比 vs 现有最优配合比）

### 第四步：探索性试验建议
- 围绕试验目的，设计单因素或多因素试验
- 试验方案包含：
  - 试验变量：调整哪个参数，调整范围和步长
  - 对照组：基于现有数据中最优配合比作为基准
  - 预期结果：基于第1、2部分发现的规律，预测各试验组的性能
  - 评价指标：R28强度、坍落度、成本等关键指标的目标值

### 第五步：试验矩阵
以表格形式给出具体的试验配合比：

| 编号 | 试验变量 | 水泥 | 粉煤灰 | 矿渣粉 | 锂渣 | 复合粉 | 砂1 | 砂2 | 碎石 | 减水剂掺量 | 水胶比 | 预期R28 | 预期成本 |
|------|---------|------|--------|--------|------|--------|-----|-----|------|-----------|--------|---------|---------|

### 第六步：优先级与资源建议
- 按试验目的的主次排序试验顺序
- 预估所需原材料量、试验周期
- 若某试验依赖补测材料性能参数，先列出前置工作

### 第七步（未提供试验目的时）
- 根据分析发现，主动列出3-5个可能的试验方向供用户选择
- 提醒用户在下一次分析前填写试验目的，以获取更精准的试验方案`
    }

    // ========== 通用规则 ==========
    prompt += `

═══════════════════════════════════════

## 通用规则

**数据处理：**
- R28强度是必填项，其他试验结果可为空，数据为0或缺失的指标不参与分析
- 减水剂用量对成本有直接影响，分析时应考虑
- 请确保输出的JSON格式正确，可以被JSON.parse解析

**成本计算规则：**
- 每条配合比数据中已包含预先计算的 costPerCubicMeter（每方成本，单位：元/m³）和 costDetail（各项材料成本明细），请直接使用这些数值
- 计算公式：每方成本 = Σ(胶凝材料用量kg × 单价元/吨 / 1000) + Σ(骨料用量kg × 单价元/吨 / 1000) + 减水剂用量kg × 减水剂单价元/吨 / 1000
- 若 costPerCubicMeter 为 0，说明材料价格缺失，请在报告中注明

**试验目的贯穿：**
- 若用户提供了试验目的，所有分析项都应优先聚焦与试验目的相关的参数、材料和问题
- 在每项分析的输出中体现与试验目的的关联

**分析质量：**
- 所有结论必须有数据支撑，引用具体数值
- 无法从数据中得出的结论，应注明"基于当前数据无法判断"
- 不可编造数据或参数值`

    return prompt
  }

  /**
   * 分析配合比数据
   * @param {Object} data - 包含summary, groupedStatistics, mixDesigns, analysisRequirements
   * @param {string} customPrompt - 用户自定义的额外提示词（试验目的）
   * @returns {Promise<Object>} - AI返回的分析报告
   */
  async analyzeMixDesign(data, customPrompt = '') {
    if (!this.apiKey) {
      throw new Error('DeepSeek API密钥未配置')
    }

    const systemPrompt = this.buildSystemPrompt(data, customPrompt)
    const userPrompt = this.buildPrompt(data)

    const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4)
    if (estimatedTokens > 120000) {
      throw new Error(`输入数据量过大（约 ${estimatedTokens} tokens），超出分析限制。请减少配合比数量后重试。`)
    }

    try {
      const response = await axios.post(
        DEEPSEEK_API_URL,
        {
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 8192,
          extra_body: {
            thinking: { type: 'enabled' }
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 120000
        }
      )

      const content = response.data.choices[0].message.content
      return this.parseResponse(content)
    } catch (error) {
      if (error.response) {
        const status = error.response.status
        const data = error.response.data
        if (status === 401) {
          throw new Error('DeepSeek API密钥无效')
        } else if (status === 429) {
          throw new Error('DeepSeek API请求频率超限，请稍后重试')
        } else {
          throw new Error(`DeepSeek API错误: ${data.error?.message || status}`)
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('DeepSeek API请求超时，请检查网络连接')
      } else {
        throw new Error(`DeepSeek API调用失败: ${error.message}`)
      }
    }
  }

  /**
   * 构建用户Prompt（数据 + 输出Schema）
   */
  buildPrompt(data) {
    const req = data.analysisRequirements || {}
    const schemaParts = []

    if (req.analyzeMaterialInfluences !== false) {
      schemaParts.push(`  "materialInfluenceAnalysis": [
    {
      "strengthGrade": "强度等级",
      "analysisPath": "路径A/B/C",
      "materialComparison": "同等级内材料选择对比说明",
      "findings": [
        {
          "material": "材料类型",
          "materialNameA": "配合比A所选材料",
          "materialNameB": "配合比B所选材料",
          "parameter": "参数名称",
          "valueA": "配合比A的参数值",
          "valueB": "配合比B的参数值",
          "difference": "差异描述",
          "influence": 0.0-1.0,
          "direction": "正相关/负相关",
          "affectedProperty": "影响的性能指标",
          "description": "详细追溯：哪条配合比的哪个材料的哪个参数差异，导致哪个试验结果的差异"
        }
      ]
    }
  ]`)
    }

    if (req.analyzeMixDesignInfluences !== false) {
      schemaParts.push(`  "mixDesignInfluenceAnalysis": [
    {
      "strengthGrade": "强度等级",
      "findings": [
        {
          "param": "参数名称",
          "influence": 0.0-1.0,
          "direction": "正相关/负相关",
          "affectedProperty": "影响的性能指标",
          "quantification": "量化关系描述（如每变化0.01带来X MPa变化）",
          "crossGradeComparison": "跨等级对比说明（如有）",
          "description": "具体影响描述"
        }
      ]
    }
  ]`)
    }

    if (req.generateOptimalMixDesign !== false) {
      schemaParts.push(`  "optimalMixDesignRecommendation": {
    "strengthGrade": "强度等级",
    "configurationStrength": "配制强度值及计算过程（σ=6）",
    "optimizationGoal": "优化目标说明（含用户试验目的关联）",
    "targetCost": 目标成本,
    "mixDesign": {
      "water": 用水量,
      "cement": 水泥用量,
      "flyAsh": 粉煤灰用量,
      "slag": 矿渣粉用量,
      "lithiumSlag": 锂渣用量,
      "compositePowder": 复合粉用量,
      "fineAggregate1": 砂1用量,
      "fineAggregate2": 砂2用量,
      "coarseAggregate": 碎石用量,
      "waterReducerDosage": 减水剂掺量,
      "waterReducerAmount": 减水剂用量kg/m³,
      "waterBinderRatio": 水胶比,
      "sandRate": 砂率
    },
    "expectedPerformance": {
      "slump": 预期坍落度,
      "slumpFlow": 预期扩展度,
      "strength28d": 预期28d强度,
      "costPerCubicMeter": 每方成本
    },
    "predictionBasis": "预测依据：基于第1、2部分哪些发现推算的",
    "comparisonWithExisting": [
      {"id": "编号", "strength28d": 28d强度, "cost": 成本, "advantage": "优势说明"}
    ],
    "feasibilityNote": "可行性说明"
  }`)
    }

    if (req.provideSuggestions !== false) {
      schemaParts.push(`  "adjustmentSuggestions": [
    {
      "priority": "高/中/低",
      "problem": "问题描述",
      "severity": "严重/一般",
      "cause": "问题原因（引用第1、2部分分析结论）",
      "suggestion": "调整方案（材料层面或配合比层面）",
      "currentValue": "当前值",
      "targetValue": "建议值",
      "expectedEffect": "预期效果",
      "reason": "建议依据"
    }
  ]`)
    }

    if (req.furtherTestSuggestions !== false) {
      schemaParts.push(`  "furtherTestSuggestions": {
    "testPurpose": "从用户提示词提取的试验目的（若未提供则说明）",
    "dataGaps": ["数据缺口说明"],
    "verificationTests": [
      {
        "objective": "验证目标",
        "testMixDesign": "待验证的配合比参数",
        "benchmark": "对照组设置",
        "expectedOutcome": "预期结果",
        "evaluationCriteria": ["评价指标"]
      }
    ],
    "exploratoryTests": [
      {
        "objective": "探索目标",
        "variable": "试验变量",
        "range": "调整范围",
        "step": "步长",
        "expectedTrend": "预期趋势"
      }
    ],
    "testMatrix": [
      {
        "id": "试验编号",
        "variableDescription": "变量说明",
        "cement": 水泥用量,
        "flyAsh": 粉煤灰用量,
        "slag": 矿渣粉用量,
        "lithiumSlag": 锂渣用量,
        "compositePowder": 复合粉用量,
        "fineAggregate1": 砂1用量,
        "fineAggregate2": 砂2用量,
        "coarseAggregate": 碎石用量,
        "waterReducerDosage": 减水剂掺量,
        "waterBinderRatio": 水胶比,
        "expectedR28": 预期28d强度,
        "expectedCost": 预期成本
      }
    ],
    "priorityAndResources": "优先级排序与资源估算",
    "alternativeDirections": ["未提供试验目的时，建议的试验方向"]
  }`)
    }

    const schemaBody = schemaParts.length > 0 ? schemaParts.join(',\n') : '  // 根据数据自行输出合适的分析结果'

    return `请分析以下混凝土配合比数据，严格按照系统提示中的工作流逐项分析，输出JSON格式的分析报告。

## 数据摘要
- 配合比总数：${data.summary.totalMixDesigns}
- 强度等级：${data.summary.strengthGrades.join(', ')}
- 材料数量：${data.summary.totalMaterials}

## 分组统计（按强度等级）
${JSON.stringify(data.groupedStatistics, null, 2)}

## 配合比详情
${JSON.stringify(data.mixDesigns, null, 2)}

## 输出要求
请输出JSON格式的分析报告，只包含用户选择的分析项：
{
${schemaBody}
}`
  }

  /**
   * 解析AI返回的响应（含自动修复）
   */
  parseResponse(content) {
    // 1. 提取 JSON 文本
    let jsonStr = content

    // 尝试提取 markdown 代码块中的 JSON
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim()
    } else {
      // 提取最外层 {...}
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        jsonStr = jsonMatch[0]
      }
    }

    // 2. 尝试直接解析
    try {
      return JSON.parse(jsonStr)
    } catch (directError) {
      // 3. 修复常见 JSON 问题后重试
      try {
        const repaired = this.repairJSON(jsonStr)
        return JSON.parse(repaired)
      } catch (repairError) {
        // 4. 最终尝试：处理截断的 JSON
        try {
          const truncatedRepair = this.repairTruncatedJSON(jsonStr)
          if (truncatedRepair) return JSON.parse(truncatedRepair)
        } catch (_) { /* 忽略 */ }
        throw new Error(`解析AI响应失败: ${directError.message}`)
      }
    }
  }

  /**
   * 修复常见 JSON 格式问题
   */
  repairJSON(jsonStr) {
    let fixed = jsonStr

    // 移除对象/数组末尾多余逗号: ,}  ,]
    fixed = fixed.replace(/,\s*([}\]])/g, '$1')

    // 移除 JS 风格注释
    fixed = fixed.replace(/\/\/[^\n]*/g, '')

    // 移除多余连续逗号: ,,
    fixed = fixed.replace(/,\s*,/g, ',')

    return fixed
  }

  /**
   * 修复截断的 JSON（max_tokens 不足时常见）
   */
  repairTruncatedJSON(jsonStr) {
    let fixed = jsonStr

    // 移除尾部不完整的 key-value
    // 不完整的字符串值: "key": "incomplete...
    fixed = fixed.replace(/:\s*"[^"]*$/g, ': ""')
    // 不完整的数字: "key": 123...
    fixed = fixed.replace(/:\s*[\d.]*$/g, ': 0')
    // 不完整的数组元素
    fixed = fixed.replace(/\[\s*[^\]]*$/g, '[]')
    // 不完整的布尔/null
    fixed = fixed.replace(/:\s*(?:tru|fals|nu)[^\s,}\]\n]*/gi, ': null')

    // 移除末尾逗号
    fixed = fixed.replace(/,\s*$/g, '')

    // 统计并补全未闭合的括号
    const stack = []
    let inString = false
    let escaped = false

    for (const ch of fixed) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\' && inString) { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue

      if (ch === '{') stack.push('}')
      else if (ch === '}') { if (stack[stack.length - 1] === '}') stack.pop() }
      else if (ch === '[') stack.push(']')
      else if (ch === ']') { if (stack[stack.length - 1] === ']') stack.pop() }
    }

    if (stack.length > 0) {
      // 再次确保末尾没有逗号
      fixed = fixed.replace(/,\s*$/g, '')
      // 按栈顺序补全闭合括号
      fixed += stack.reverse().join('')
    }

    // 移除补全后可能出现的多余逗号
    fixed = fixed.replace(/,\s*([}\]])/g, '$1')

    return fixed
  }
}

module.exports = DeepSeekService

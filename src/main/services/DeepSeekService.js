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
              sandRatio: { type: 'number' },
              calculationMethod: { type: 'string' }
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
   * 与AI对话
   * @param {string} message - 用户消息
   * @param {Array} context - 上下文数据（配合比数据等）
   * @returns {Promise<Object>} - AI返回的对话响应
   */
  async chat(message, context = null) {
    if (!this.apiKey) {
      throw new Error('DeepSeek API密钥未配置')
    }

    // 构建系统提示
    const systemPrompt = `你是一个混凝土配合比分析专家，擅长分析材料性能参数对混凝土性能的影响。
你可以回答关于混凝土配合比设计、材料选择、性能优化、成本控制等各方面的问题。
请用专业的知识帮助用户解答疑问。`

    // 添加上下文到消息中
    let userMessage = message
    if (context) {
      userMessage = `用户问题是：${message}\n\n相关配合比数据背景：\n${JSON.stringify(context, null, 2)}`
    }

    try {
      const response = await axios.post(
        DEEPSEEK_API_URL,
        {
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.conversationHistory,
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 2048
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

      // 保存对话历史
      this.conversationHistory.push({ role: 'user', content: userMessage })
      this.conversationHistory.push({ role: 'assistant', content: content })

      return { reply: content }
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
   * 分析配合比数据
   * @param {Object} data - 包含summary, groupedStatistics, mixDesigns, analysisRequirements
   * @returns {Promise<Object>} - AI返回的分析报告
   */
  async analyzeMixDesign(data) {
    if (!this.apiKey) {
      throw new Error('DeepSeek API密钥未配置')
    }

    const prompt = this.buildPrompt(data)

    try {
      const response = await axios.post(
        DEEPSEEK_API_URL,
        {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `你是一个混凝土配合比分析专家，擅长分析材料性能参数对混凝土性能的影响。
请基于提供的数据进行全面分析，输出JSON格式的分析报告。
分析应包括：
1. 材料性能影响分析 - 分析各项材料性能参数对混凝土性能的影响
2. 配合比影响分析 - 分析配合比参数对试验结果的影响程度
3. 最优配合比设计 - 基于数据分析输出最优配合比（考虑成本和性能）
4. 参数调整建议 - 结合材料性能参数给出具体建议
5. 综合评价 - 同强度等级内评价和跨强度等级评价

重要：
- R28强度是必填的，其他试验结果可为空
- 请确保输出的JSON格式正确，可以被JSON.parse解析
- 最优配合比设计应包含具体参数和预期性能
- 成本计算应基于原材料单价计算每立方米混凝土成本`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 4096
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 120000 // 120秒超时
        }
      )

      const content = response.data.choices[0].message.content
      return this.parseResponse(content)
    } catch (error) {
      if (error.response) {
        // API返回错误
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
   * 构建Prompt
   */
  buildPrompt(data) {
    return `请分析以下混凝土配合比数据，输出JSON格式的分析报告。

## 数据摘要
- 配合比总数：${data.summary.totalMixDesigns}
- 强度等级：${data.summary.strengthGrades.join(', ')}
- 材料数量：${data.summary.totalMaterials}

## 分组统计（按强度等级）
${JSON.stringify(data.groupedStatistics, null, 2)}

## 配合比详情
${JSON.stringify(data.mixDesigns, null, 2)}

## 分析要求
请输出JSON格式的分析报告，包含以下部分：
{
  "materialInfluenceAnalysis": [
    {
      "material": "材料类型",
      "parameter": "参数名称",
      "influence": 0.0-1.0的影响程度值,
      "direction": "正相关/负相关",
      "affectedProperty": "影响的性能指标",
      "description": "具体影响描述"
    }
  ],
  "mixDesignInfluenceAnalysis": [
    {
      "param": "参数名称",
      "influence": 0.0-1.0的影响程度值,
      "direction": "正相关/负相关",
      "affectedProperty": "影响的性能指标",
      "description": "具体影响描述"
    }
  ],
  "optimalMixDesignRecommendation": {
    "strengthGrade": "强度等级",
    "targetCost": 目标成本,
    "targetStrength": 目标强度,
    "mixDesign": {
      "water": 用水量,
      "cement": 水泥用量,
      "flyAsh": 粉煤灰用量,
      "slag": 矿渣粉用量,
      "fineAggregate1": 砂1用量,
      "fineAggregate2": 砂2用量,
      "coarseAggregate": 碎石用量,
      "waterReducerDosage": 减水剂掺量,
      "waterBinderRatio": 水胶比
    },
    "expectedPerformance": {
      "slump": 预期坍落度,
      "slumpFlow": 预期扩展度,
      "strength28d": 预期28d强度,
      "costPerCubicMeter": 每方成本
    },
    "optimizationRationale": "优化依据说明",
    "comparisonWithExisting": [
      {"id": "编号", "strength28d": 28d强度, "cost": 成本, "advantage": "优势说明"}
    ]
  },
  "adjustmentSuggestions": [
    {
      "category": "材料层面/配合比层面",
      "suggestion": "具体建议",
      "reason": "建议原因"
    }
  ],
  "comprehensiveEvaluation": {
    "withinSameGrade": {
      "C30": {
        "optimalMixDesign": "最优配合比编号",
        "score": 评分0-100,
        "summary": "评价总结",
        "reasons": ["原因1", "原因2"]
      }
    },
    "acrossGrades": {
      "summary": "跨强度等级综合评价",
      "materialRecommendations": ["建议1", "建议2"]
    }
  }
}`
  }

  /**
   * 解析AI返回的响应
   */
  parseResponse(content) {
    try {
      // 尝试提取JSON部分
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
      throw new Error('无法从AI响应中提取JSON数据')
    } catch (error) {
      if (error.message.includes('JSON')) {
        throw error
      }
      throw new Error(`解析AI响应失败: ${error.message}`)
    }
  }
}

module.exports = DeepSeekService

/**
 * DeepSeek API 服务
 * 用于调用云端AI分析混凝土配合比数据
 */

const axios = require('axios')

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

class DeepSeekService {
  constructor(apiKey) {
    this.apiKey = apiKey
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

/**
 * DeepSeek 工具定义 fallback 数组 + Skill 注册表状态
 * 从 DeepSeekService.js 拆分（优化项 2），行为不变：
 * - TOOLS 仅供 standalone chat 模式作为 fallback 使用（Agent 模式和流式聊天通过 _skillRegistry 获取工具定义）
 * - _skillRegistry / _skillExecutor 集中于此，供 deepSeekApiClient 与 DeepSeekService 静态方法共享
 */

let _skillRegistry = null
let _skillExecutor = null

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
      description: '基于XGBoost模型预测混凝土性能指标（28d抗压强度、减水剂掺量、容重）。输入配合比参数和材料ID，自动从数据库查询材料属性，输出预测值及置信度。支持质量(kg/m³)和百分比(%)两种输入格式，优先使用质量格式。预测减水剂掺量时强烈建议传 slump 参数（目标坍落度 mm），未传时按训练集均值 200 兜底。',
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

// ---- Skill 注册表状态访问器（DeepSeekService 静态方法与 ApiClient 共享） ----

function getToolDefinitions() {
  if (_skillRegistry) {
    return _skillRegistry.getToolSchemas()
  }
  return TOOLS
}

function setSkillRegistry(registry) {
  _skillRegistry = registry
}

function setSkillExecutor(executor) {
  _skillExecutor = executor
}

function getSkillExecutor() {
  return _skillExecutor
}

module.exports = { TOOLS, getToolDefinitions, setSkillRegistry, setSkillExecutor, getSkillExecutor }

// 工具共享 Schema 定义 - 消除 DeepSeekService.js TOOLS 数组中的重复
const SharedSchemas = {
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
      targetFinenessModulusBase: { type: 'number', description: '目标组合细度模数' }
    }
  },
  materialIds: {
    type: 'object',
    description: '原材料ID映射',
    properties: {
      cementId: { type: 'integer' },
      sandIds: { type: 'array', items: { type: 'integer' } },
      stoneIds: { type: 'array', items: { type: 'integer' } },
      flyAshId: { type: 'integer' },
      slagId: { type: 'integer' },
      lithiumSlagId: { type: 'integer' },
      compositePowderId: { type: 'integer' },
      superplasticizerId: { type: 'integer' }
    }
  },
  materialQuery: {
    type: { type: 'string', description: '材料类型：水泥/细骨料/粗骨料/粉煤灰/矿渣粉/锂渣/复合粉/减水剂。不填返回全部', enum: ['水泥', '细骨料', '粗骨料', '粉煤灰', '矿渣粉', '锂渣', '复合粉', '减水剂'] }
  },
  admixtureParams: {
    type: 'object',
    properties: {
      flyAshDosage: { type: 'number', description: '粉煤灰掺量(%)' },
      slagDosage: { type: 'number', description: '矿渣粉掺量(%)' },
      lithiumSlagDosage: { type: 'number', description: '锂渣掺量(%)' },
      compositePowderDosage: { type: 'number', description: '复合粉掺量(%)' },
      sandRatio: { type: 'number', description: '砂率(%)' },
      calculationMethod: { type: 'string', enum: ['absolute', 'mass'], description: '计算方法' },
      targetDensity: { type: 'number', description: '目标容重(kg/m³)' },
      airContent: { type: 'number', description: '含气量(%)，默认1.0' }
    }
  }
}

module.exports = SharedSchemas

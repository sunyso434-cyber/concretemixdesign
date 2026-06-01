/**
 * 配合比计算 Skill
 * 根据给定参数计算混凝土配合比
 */

const ErrorCodes = require('../agent/ErrorCodes')

module.exports = {
  name: 'calculate_mix_design',
  description: '根据给定参数计算混凝土配合比。返回各材料用量、水胶比、砂率、容重、成本等结果。当用户要设计新配合比时调用此工具。',
  version: '1.0.0',
  category: 'core',

  parameters: {
    strength: {
      type: 'string',
      description: '强度等级，如 C30、C40',
      required: true,
      examples: ['C20', 'C25', 'C30', 'C35', 'C40', 'C50']
    },
    slump: {
      type: 'number',
      description: '坍落度(mm)',
      required: true,
      min: 10,
      max: 300
    },
    cementId: {
      type: 'integer',
      description: '水泥材料ID',
      required: true
    },
    sandIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '细骨料ID列表，支持1-2种',
      required: true,
      minItems: 1,
      maxItems: 3
    },
    stoneIds: {
      type: 'array',
      items: { type: 'integer' },
      description: '粗骨料ID列表，支持1-2种',
      required: true,
      minItems: 1,
      maxItems: 3
    },
    flyAshId: {
      type: 'integer',
      description: '粉煤灰材料ID（可选）',
      required: false
    },
    slagId: {
      type: 'integer',
      description: '矿渣粉材料ID（可选）',
      required: false
    },
    lithiumSlagId: {
      type: 'integer',
      description: '锂渣材料ID（可选）',
      required: false
    },
    compositePowderId: {
      type: 'integer',
      description: '复合粉材料ID（可选）',
      required: false
    },
    superplasticizerId: {
      type: 'integer',
      description: '减水剂材料ID（可选）',
      required: false
    },
    flyAshDosage: {
      type: 'number',
      description: '粉煤灰掺量(%)，如 15',
      required: false,
      min: 0,
      max: 50
    },
    slagDosage: {
      type: 'number',
      description: '矿渣粉掺量(%)，如 20',
      required: false,
      min: 0,
      max: 50
    },
    lithiumSlagDosage: {
      type: 'number',
      description: '锂渣掺量(%)',
      required: false,
      min: 0,
      max: 30
    },
    compositePowderDosage: {
      type: 'number',
      description: '复合粉掺量(%)',
      required: false,
      min: 0,
      max: 30
    },
    sandRatio: {
      type: 'number',
      description: '砂率(%)，不填则根据规范自动计算',
      required: false,
      min: 25,
      max: 55
    },
    calculationMethod: {
      type: 'string',
      description: '计算方法：absolute=绝对体积法(默认), mass=质量法',
      required: false,
      enum: ['absolute', 'mass']
    },
    targetDensity: {
      type: 'number',
      description: '目标容重(kg/m³)，仅质量法时使用',
      required: false,
      min: 2000,
      max: 2600
    },
    airContent: {
      type: 'number',
      description: '含气量(%)，默认1.0',
      required: false,
      min: 0,
      max: 10
    }
  },

  errors: {
    CEMENT_NOT_FOUND: {
      code: 'MATERIAL_NOT_FOUND',
      message: '水泥材料不存在',
      hint: '请检查水泥ID是否正确，或调用 list_available_materials 查看可用材料',
      recovery: 'list_materials'
    },
    SAND_NOT_FOUND: {
      code: 'MATERIAL_NOT_FOUND',
      message: '细骨料材料不存在',
      hint: '请检查细骨料ID是否正确，或调用 list_available_materials 查看可用材料',
      recovery: 'list_materials'
    },
    STONE_NOT_FOUND: {
      code: 'MATERIAL_NOT_FOUND',
      message: '粗骨料材料不存在',
      hint: '请检查粗骨料ID是否正确，或调用 list_available_materials 查看可用材料',
      recovery: 'list_materials'
    },
    CALCULATION_FAILED: {
      code: 'CALCULATION_FAILED',
      message: '配合比计算失败',
      hint: '请检查输入参数是否合理，或尝试不同的材料组合',
      recovery: 'adjust_params'
    }
  },

  async execute(args, context) {
    const { materialService, mixDesignService, logger } = context
    const {
      strength, slump, cementId, sandIds, stoneIds,
      flyAshId, slagId, lithiumSlagId, compositePowderId, superplasticizerId,
      flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage,
      sandRatio, calculationMethod, targetDensity, airContent
    } = args

    logger.info(`开始计算配合比: ${strength}, 坍落度=${slump}mm`)

    // 查找材料
    const allMaterials = await materialService.getAllMaterials()
    const findById = (id) => allMaterials.find(m => m.id === id)

    const cement = findById(cementId)
    if (!cement) {
      return { success: false, error: this.errors.CEMENT_NOT_FOUND, details: { cementId } }
    }

    const sands = sandIds.map(id => findById(id))
    if (sands.some(s => !s)) {
      return { success: false, error: this.errors.SAND_NOT_FOUND, details: { sandIds } }
    }

    const stones = stoneIds.map(id => findById(id))
    if (stones.some(s => !s)) {
      return { success: false, error: this.errors.STONE_NOT_FOUND, details: { stoneIds } }
    }

    // 构建材料对象
    const materials = {
      cement,
      sand: sands.length === 1 ? sands[0] : sands,
      stone: stones.length === 1 ? stones[0] : stones
    }

    if (flyAshId) materials.flyAsh = findById(flyAshId)
    if (slagId) materials.slag = findById(slagId)
    if (lithiumSlagId) materials.lithiumSlag = findById(lithiumSlagId)
    if (compositePowderId) materials.compositePowder = findById(compositePowderId)
    if (superplasticizerId) materials.superplasticizer = findById(superplasticizerId)

    // 调用计算服务
    try {
      const result = await mixDesignService.calculateMixDesign({
        strength,
        slump,
        materials,
        flyAshDosage: flyAshDosage || 0,
        slagDosage: slagDosage || 0,
        lithiumSlagDosage: lithiumSlagDosage || 0,
        compositePowderDosage: compositePowderDosage || 0,
        sandRatio,
        calculationMethod: calculationMethod || 'absolute',
        targetDensity,
        airContent
      })

      logger.info(`配合比计算完成: 水胶比=${result.waterRatio}, 砂率=${result.sandRatio}`)

      return {
        success: true,
        type: 'mix_design',
        data: result,
        suggestions: ['是否需要成本优化？', '是否需要规范审查？']
      }
    } catch (error) {
      logger.error('配合比计算失败:', error)
      return {
        success: false,
        error: this.errors.CALCULATION_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}

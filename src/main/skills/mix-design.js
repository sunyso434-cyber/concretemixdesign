/**
 * 配合比计算 Skill
 * 根据给定参数计算混凝土配合比
 */

const ErrorCodes = require('../agent/ErrorCodes')

/**
 * 用批次检测值覆盖材料对象对应字段（仅覆盖批次中非空的检测值字段）
 * @returns {Promise<{material?: object, error?: string}>}
 */
async function applyBatchToMaterial(material, batchId, materialBatchService, detectionFields) {
  if (!batchId || !material) return { material }
  const batch = await materialBatchService.getBatchById(batchId)
  if (!batch) return { error: `批次(ID:${batchId})不存在` }
  const merged = { ...material }
  for (const field of detectionFields) {
    if (batch[field] !== null && batch[field] !== undefined) {
      merged[field] = batch[field]
    }
  }
  merged._batchId = batchId
  merged._batchNumber = batch.batchNumber
  return { material: merged }
}

/**
 * 骨料多选：批次ID数组与材料数组一一对应
 * @returns {Promise<{materials?: object[], error?: string}>}
 */
async function applyBatchToArray(materials, batchIds, materialBatchService, detectionFields) {
  if (!batchIds || !Array.isArray(batchIds) || batchIds.length === 0) return { materials }
  const result = []
  for (let i = 0; i < materials.length; i++) {
    const bid = batchIds[i]
    if (!bid) { result.push(materials[i]); continue }
    const r = await applyBatchToMaterial(materials[i], bid, materialBatchService, detectionFields)
    if (r.error) return { error: r.error }
    result.push(r.material)
  }
  return { materials: result }
}

module.exports = {
  name: 'calculate_mix_design',
  description: '根据参数计算混凝土配合比，返回各材料用量/水胶比/砂率/容重/成本。**计算成功自动保存为草稿**，返回 draftId（后续用 save_mix_design 转正式）。**与 cost_optimization 的区别**：mix_design 算 1 个方案；cost_optimization 网格搜索找最优。',
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
    cementBatchId: {
      type: 'integer',
      description: '水泥批次ID（可选）。指定后用该批次的检测值计算；不填则用材料主表值(=当前批次同步值)。可通过 manage_material_batches 的 list 查询获取',
      required: false
    },
    sandBatchId: {
      type: 'array',
      items: { type: 'integer' },
      description: '细骨料批次ID列表（可选），与 sandIds 一一对应；指定后用对应批次检测值',
      required: false
    },
    stoneBatchId: {
      type: 'array',
      items: { type: 'integer' },
      description: '粗骨料批次ID列表（可选），与 stoneIds 一一对应；指定后用对应批次检测值',
      required: false
    },
    flyAshBatchId: {
      type: 'integer',
      description: '粉煤灰批次ID（可选），指定后用该批次检测值',
      required: false
    },
    slagBatchId: {
      type: 'integer',
      description: '矿渣粉批次ID（可选），指定后用该批次检测值',
      required: false
    },
    lithiumSlagBatchId: {
      type: 'integer',
      description: '锂渣批次ID（可选），指定后用该批次检测值',
      required: false
    },
    compositePowderBatchId: {
      type: 'integer',
      description: '复合粉批次ID（可选），指定后用该批次检测值',
      required: false
    },
    superplasticizerBatchId: {
      type: 'integer',
      description: '减水剂批次ID（可选），指定后用该批次检测值',
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
    const { materialService, materialBatchService, mixDesignService, logger } = context
    const {
      strength, slump, cementId, sandIds, stoneIds,
      flyAshId, slagId, lithiumSlagId, compositePowderId, superplasticizerId,
      cementBatchId, sandBatchId, stoneBatchId,
      flyAshBatchId, slagBatchId, lithiumSlagBatchId, compositePowderBatchId, superplasticizerBatchId,
      flyAshDosage, slagDosage, lithiumSlagDosage, compositePowderDosage,
      sandRatio, calculationMethod, targetDensity, airContent
    } = args

    logger.info(`开始计算配合比: ${strength}, 坍落度=${slump}mm`)

    // 查找材料
    const allMaterials = await materialService.getAllMaterials()
    const findById = (id) => allMaterials.find(m => m.id === id)

    const cement = findById(cementId)
    if (!cement) {
      return { success: false, error: '水泥材料不存在，请检查水泥ID是否正确' }
    }

    const sands = sandIds.map(id => findById(id))
    if (sands.some(s => !s)) {
      return { success: false, error: '细骨料材料不存在，请检查细骨料ID是否正确' }
    }

    const stones = stoneIds.map(id => findById(id))
    if (stones.some(s => !s)) {
      return { success: false, error: '粗骨料材料不存在，请检查粗骨料ID是否正确' }
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

    // 若指定了批次ID，用批次检测值覆盖材料主表值（仅覆盖批次中非空的检测值字段）
    const DETECTION_FIELDS = materialBatchService?.DETECTION_FIELDS || []
    if (materialBatchService && DETECTION_FIELDS.length > 0) {
      if (cementBatchId) {
        const r = await applyBatchToMaterial(cement, cementBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.cement = r.material
      }
      if (sandBatchId) {
        const r = await applyBatchToArray(sands, sandBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.sand = r.materials.length === 1 ? r.materials[0] : r.materials
      }
      if (stoneBatchId) {
        const r = await applyBatchToArray(stones, stoneBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.stone = r.materials.length === 1 ? r.materials[0] : r.materials
      }
      if (flyAshBatchId && materials.flyAsh) {
        const r = await applyBatchToMaterial(materials.flyAsh, flyAshBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.flyAsh = r.material
      }
      if (slagBatchId && materials.slag) {
        const r = await applyBatchToMaterial(materials.slag, slagBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.slag = r.material
      }
      if (lithiumSlagBatchId && materials.lithiumSlag) {
        const r = await applyBatchToMaterial(materials.lithiumSlag, lithiumSlagBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.lithiumSlag = r.material
      }
      if (compositePowderBatchId && materials.compositePowder) {
        const r = await applyBatchToMaterial(materials.compositePowder, compositePowderBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.compositePowder = r.material
      }
      if (superplasticizerBatchId && materials.superplasticizer) {
        const r = await applyBatchToMaterial(materials.superplasticizer, superplasticizerBatchId, materialBatchService, DETECTION_FIELDS)
        if (r.error) return { success: false, error: r.error }
        materials.superplasticizer = r.material
      }
    }

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

      // 构建 materialDetails，保存材料的ID、名称、价格等详细信息
      const materialDetails = {
        cement: cement ? { id: cement.id, name: cement.name, price: cement.price } : null,
        flyAsh: materials.flyAsh ? { id: materials.flyAsh.id, name: materials.flyAsh.name, price: materials.flyAsh.price } : null,
        slag: materials.slag ? { id: materials.slag.id, name: materials.slag.name, price: materials.slag.price } : null,
        lithiumSlag: materials.lithiumSlag ? { id: materials.lithiumSlag.id, name: materials.lithiumSlag.name, price: materials.lithiumSlag.price } : null,
        compositePowder: materials.compositePowder ? { id: materials.compositePowder.id, name: materials.compositePowder.name, price: materials.compositePowder.price } : null,
        superplasticizer: materials.superplasticizer ? { id: materials.superplasticizer.id, name: materials.superplasticizer.name, price: materials.superplasticizer.price } : null,
        sand: Array.isArray(materials.sand)
          ? materials.sand.map(s => ({ id: s.id, name: s.name, price: s.price }))
          : (materials.sand ? { id: materials.sand.id, name: materials.sand.name, price: materials.sand.price } : null),
        stone: Array.isArray(materials.stone)
          ? materials.stone.map(s => ({ id: s.id, name: s.name, price: s.price }))
          : (materials.stone ? { id: materials.stone.id, name: materials.stone.name, price: materials.stone.price } : null)
      }

      // 自动保存草稿
      let draftId = null
      try {
        const now = new Date()
        const timestamp = now.toLocaleString('zh-CN', { hour12: false })
        const draft = await mixDesignService.createMixDesign({
          name: `${strength}智能设计方案 - ${timestamp}`,
          projectName: 'AI智能设计',
          strength,
          slump,
          waterRatio: result.waterRatio,
          sandRatio: result.sandRatio,
          density: result.density,
          materials: result.materials,
          materialDetails,
          materialCosts: result.materialCosts,
          totalCost: result.totalCost,
          fineAggregateBreakdown: result.fineAggregateBreakdown,
          coarseAggregateBreakdown: result.coarseAggregateBreakdown,
          status: '草稿'
        })
        draftId = draft.id
        logger.info(`草稿已保存, ID=${draftId}`)
      } catch (saveErr) {
        logger.warn('自动保存草稿失败（不影响计算结果）:', saveErr.message)
      }

      return {
        success: true,
        type: 'mix_design',
        data: { ...result, materialDetails },
        draftId,
        suggestions: ['是否需要成本优化？']
      }
    } catch (error) {
      logger.error('配合比计算失败:', error)
      return {
        success: false,
        error: `配合比计算失败: ${error.message}`
      }
    }
  },

  services: ['materialService', 'materialBatchService', 'mixDesignService']
}

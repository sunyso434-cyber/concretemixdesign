/**
 * 材料管理 Skill
 * 让 Agent 能够新增、修改、删除材料库中的原材料信息
 *
 * 操作类型：
 * - create：新增材料，data 必须包含 name 和 type
 * - update：修改已有材料，必须传 id，data 只传需要改的字段
 * - delete：删除材料，必须传 id（允许删除任何材料，包括系统预设）
 *
 * 字段校验：
 * 按材料类型校验字段，不属于该类型的字段会被过滤掉。
 * 字段配置参考 src/renderer/utils/materialFieldsConfig.js，
 * 如前端字段配置变更，需同步更新此处映射。
 * 注意：finenessModulus(细度模数)、grading(级配)、cementitiousFactor_xx(胶凝系数)
 * 为系统自动计算字段，不接受 AI 写入。
 */

// 合法的材料类型
const VALID_TYPES = ['水泥', '细骨料', '粗骨料', '粉煤灰', '矿渣粉', '锂渣', '复合粉', '减水剂']

// 通用字段（所有材料类型都支持）
const COMMON_FIELDS = new Set([
  'name', 'type', 'specification', 'manufacturer', 'density',
  'price', 'status', 'notes', 'chemicalComposition', 'testData',
  'waterContent', 'fineness'
])

// 各材料类型专用字段（不含通用字段，不含系统自动计算的 disabled 字段）
const TYPE_SPECIFIC_FIELDS = {
  '水泥': new Set([
    'specificSurfaceArea', 'standardConsistency', 'stability',
    'initialSettingTime', 'finalSettingTime',
    'flexuralStrength3d', 'flexuralStrength28d',
    'compressiveStrength3d', 'compressiveStrength28d',
    'cementHeat3d', 'cementHeat7d'
  ]),
  '粉煤灰': new Set([
    'lossOnIgnition', 'waterDemandRatio',
    'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50'
  ]),
  '矿渣粉': new Set([
    'specificSurfaceArea', 'lossOnIgnition', 'fluidityRatio',
    'activityIndex7d', 'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50'
  ]),
  '锂渣': new Set([
    'specificSurfaceArea', 'lossOnIgnition', 'waterDemandRatio',
    'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50'
  ]),
  '复合粉': new Set([
    'specificSurfaceArea', 'lossOnIgnition', 'fluidityRatio',
    'activityIndex7d', 'activityIndex28d',
    'influenceFactor_10', 'influenceFactor_20', 'influenceFactor_30',
    'influenceFactor_40', 'influenceFactor_50'
  ]),
  '细骨料': new Set([
    'mudContent', 'mbValue',
    'sieve_4_75', 'sieve_2_36', 'sieve_1_18', 'sieve_0_60', 'sieve_0_30', 'sieve_0_15'
    // finenessModulus 为系统自动计算，不接受
  ]),
  '粗骨料': new Set([
    'mudContent', 'crushingValue', 'needleFlakeContent',
    'sieve_37_5', 'sieve_31_5', 'sieve_26_5', 'sieve_19_0', 'sieve_16_0',
    'sieve_9_50', 'sieve_4_75', 'sieve_2_36'
    // grading 为系统自动计算，不接受
  ]),
  '减水剂': new Set([
    'recommendedDosage', 'waterReducingRate', 'solidContent', 'airContent'
  ])
}

// 各类型字段中文说明（用于工具描述，让 AI 知道每种材料该填什么）
const TYPE_FIELDS_GUIDE = {
  '水泥': '密度density, 细度fineness, 比表面积specificSurfaceArea, 标准稠度standardConsistency, 安定性stability(合格/不合格), 初凝时间initialSettingTime, 终凝时间finalSettingTime, 3天抗折flexuralStrength3d, 28天抗折flexuralStrength28d, 3天抗压compressiveStrength3d, 28天抗压compressiveStrength28d, 3天水化热cementHeat3d, 7天水化热cementHeat7d, 含水量waterContent',
  '粉煤灰': '密度density, 细度fineness, 烧失量lossOnIgnition, 需水量比waterDemandRatio, 28天活性指数activityIndex28d, 影响系数influenceFactor_10~50',
  '矿渣粉': '密度density, 比表面积specificSurfaceArea, 烧失量lossOnIgnition, 流动度比fluidityRatio, 7天活性指数activityIndex7d, 28天活性指数activityIndex28d, 影响系数influenceFactor_10~50',
  '锂渣': '密度density, 比表面积specificSurfaceArea, 烧失量lossOnIgnition, 需水量比waterDemandRatio, 28天活性指数activityIndex28d, 影响系数influenceFactor_10~50',
  '复合粉': '密度density, 比表面积specificSurfaceArea, 烧失量lossOnIgnition, 流动度比fluidityRatio, 7天活性指数activityIndex7d, 28天活性指数activityIndex28d, 影响系数influenceFactor_10~50',
  '细骨料': '密度density, 含泥量mudContent, MB值mbValue, 4.75mm筛余sieve_4_75, 2.36mm筛余sieve_2_36, 1.18mm筛余sieve_1_18, 0.60mm筛余sieve_0_60, 0.30mm筛余sieve_0_30, 0.15mm筛余sieve_0_15, 含水量waterContent',
  '粗骨料': '密度density, 含泥量mudContent, 压碎值crushingValue, 针片状含量needleFlakeContent, 37.5~2.36mm各筛余sieve_37_5/31_5/26_5/19_0/16_0/9_50/4_75/2_36, 含水量waterContent',
  '减水剂': '密度density, 推荐掺量recommendedDosage, 减水率waterReducingRate, 固含量solidContent, 含气量airContent'
}

/**
 * 按材料类型过滤字段
 * @param {object} data - 原始数据
 * @param {string} type - 材料类型
 * @returns {{cleaned: object, ignored: string[]}} 过滤后的数据 + 被忽略的字段名列表
 */
function sanitizeData(data, type) {
  const allowed = new Set([...COMMON_FIELDS, ...(TYPE_SPECIFIC_FIELDS[type] || [])])
  const cleaned = {}
  const ignored = []

  for (const [key, value] of Object.entries(data)) {
    if (allowed.has(key) && value !== undefined && value !== null) {
      cleaned[key] = value
    } else {
      ignored.push(key)
    }
  }
  // id 由数据库自增，不接受外部传入
  if ('id' in cleaned) {
    delete cleaned.id
  }
  return { cleaned, ignored }
}

module.exports = {
  name: 'manage_materials',
  description: '管理材料库中的原材料信息，支持新增(create)、修改(update)、删除(delete)三种操作。当用户要求添加、修改或删除原材料时使用此工具。查询材料请使用 list_available_materials。' +
    '\n\n通用字段(所有类型)：name(名称), type(类型), specification(规格), manufacturer(厂家), price(单价元/吨), density(密度), status(状态), notes(备注)。' +
    '\n各类型专用字段：' +
    '\n- 水泥: ' + TYPE_FIELDS_GUIDE['水泥'] +
    '\n- 粉煤灰: ' + TYPE_FIELDS_GUIDE['粉煤灰'] +
    '\n- 矿渣粉: ' + TYPE_FIELDS_GUIDE['矿渣粉'] +
    '\n- 锂渣: ' + TYPE_FIELDS_GUIDE['锂渣'] +
    '\n- 复合粉: ' + TYPE_FIELDS_GUIDE['复合粉'] +
    '\n- 细骨料: ' + TYPE_FIELDS_GUIDE['细骨料'] +
    '\n- 粗骨料: ' + TYPE_FIELDS_GUIDE['粗骨料'] +
    '\n- 减水剂: ' + TYPE_FIELDS_GUIDE['减水剂'] +
    '\n\n注意：细度模数finenessModulus、级配grading、胶凝系数cementitiousFactor_xx为系统自动计算，不要传入。系统会**自动忽略不属于该类型字段**（如水泥不应有 mudContent），并在返回结果 warnings 里列出被忽略字段名。',
  version: '1.0.0',
  category: 'manage',
  isWrite: true,

  parameters: {
    action: {
      type: 'string',
      description: '操作类型：create=新增材料，update=修改已有材料，delete=删除材料',
      required: true,
      enum: ['create', 'update', 'delete']
    },
    id: {
      type: 'number',
      description: '材料ID。update 和 delete 操作必填；create 不需要。可通过 list_available_materials 查询获取材料ID。',
      required: false
    },
    data: {
      type: 'object',
      description: '材料数据对象。create 时必填，且必须包含 name(名称)和 type(类型)；update 时只传需要修改的字段。字段必须与材料类型匹配，不匹配的字段会被忽略。',
      required: false
    }
  },

  errors: {
    INVALID_PARAMS: {
      code: 'INVALID_PARAMS',
      message: '参数不合法',
      hint: '请检查参数：create 需要 data.name 和 data.type；update/delete 需要 id；update 的 data 不能为空',
      recovery: 'retry'
    },
    INVALID_TYPE: {
      code: 'INVALID_TYPE',
      message: '材料类型不合法',
      hint: 'type 必须是：水泥/细骨料/粗骨料/粉煤灰/矿渣粉/锂渣/复合粉/减水剂 之一',
      recovery: 'retry'
    },
    MATERIAL_NOT_FOUND: {
      code: 'MATERIAL_NOT_FOUND',
      message: '材料不存在',
      hint: '请通过 list_available_materials 查询正确的材料ID',
      recovery: 'retry'
    },
    OPERATION_FAILED: {
      code: 'OPERATION_FAILED',
      message: '材料操作失败',
      hint: '请稍后重试，或检查数据格式是否正确',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { materialService, logger } = context
    const { action, id, data } = args

    logger.info(`材料管理操作: action=${action}, id=${id || '无'}`)

    // 1. 基础参数校验
    if (action === 'update' || action === 'delete') {
      if (!id) {
        return {
          success: false,
          error: this.errors.INVALID_PARAMS,
          details: { reason: `${action} 操作必须提供材料 id` }
        }
      }
    }

    if (action === 'create') {
      if (!data || !data.name || !data.type) {
        return {
          success: false,
          error: this.errors.INVALID_PARAMS,
          details: { reason: 'create 操作必须提供 data.name 和 data.type' }
        }
      }
      if (!VALID_TYPES.includes(data.type)) {
        return {
          success: false,
          error: this.errors.INVALID_TYPE,
          details: { invalidType: data.type, validTypes: VALID_TYPES }
        }
      }
    }

    if (action === 'update') {
      if (!data || Object.keys(data).length === 0) {
        return {
          success: false,
          error: this.errors.INVALID_PARAMS,
          details: { reason: 'update 操作的 data 不能为空' }
        }
      }
      // update 时若改 type，需校验合法性
      if (data.type && !VALID_TYPES.includes(data.type)) {
        return {
          success: false,
          error: this.errors.INVALID_TYPE,
          details: { invalidType: data.type, validTypes: VALID_TYPES }
        }
      }
    }

    // 2. 执行操作
    try {
      // create
      if (action === 'create') {
        const { cleaned, ignored } = sanitizeData(data, data.type)
        const material = await materialService.createMaterial(cleaned)
        logger.info(`新增材料成功: id=${material.id}, name=${material.name}, 忽略字段=${ignored.join(',') || '无'}`)
        const result = {
          success: true,
          action: 'create',
          material,
          message: `已新增材料：${material.name}（ID: ${material.id}）`
        }
        if (ignored.length > 0) {
          result.warnings = [`以下字段不属于${data.type}的检测参数，已忽略：${ignored.join(', ')}`]
        }
        return result
      }

      // update
      if (action === 'update') {
        // 先确认材料存在，便于给出明确的 not_found 错误
        const existing = await materialService.getMaterialById(id)
        if (!existing) {
          return {
            success: false,
            error: this.errors.MATERIAL_NOT_FOUND,
            details: { id }
          }
        }
        // 按材料实际类型校验字段：若 data 里有新 type 用新 type，否则用现有 type
        const effectiveType = data.type || existing.type
        const { cleaned, ignored } = sanitizeData(data, effectiveType)
        const material = await materialService.updateMaterial(id, cleaned)
        logger.info(`修改材料成功: id=${id}, 忽略字段=${ignored.join(',') || '无'}`)
        const result = {
          success: true,
          action: 'update',
          material,
          message: `已修改材料：${material.name}（ID: ${id}）`
        }
        if (ignored.length > 0) {
          result.warnings = [`以下字段不属于${effectiveType}的检测参数，已忽略：${ignored.join(', ')}`]
        }
        return result
      }

      // delete
      if (action === 'delete') {
        const existing = await materialService.getMaterialById(id)
        if (!existing) {
          return {
            success: false,
            error: this.errors.MATERIAL_NOT_FOUND,
            details: { id }
          }
        }
        const wasSystem = existing.isSystem === true
        const materialName = existing.name
        await materialService.deleteMaterial(id)
        logger.info(`删除材料成功: id=${id}, name=${materialName}, wasSystem=${wasSystem}`)
        return {
          success: true,
          action: 'delete',
          deletedId: id,
          deletedName: materialName,
          wasSystem,
          message: wasSystem
            ? `已删除系统预设材料：${materialName}（ID: ${id}）`
            : `已删除材料：${materialName}（ID: ${id}）`
        }
      }

      // 未知的 action（理论上 enum 已限制，兜底）
      return {
        success: false,
        error: this.errors.INVALID_PARAMS,
        details: { reason: `未知操作类型: ${action}` }
      }
    } catch (error) {
      logger.error(`材料管理失败 (action=${action}):`, error)
      return {
        success: false,
        error: this.errors.OPERATION_FAILED,
        details: { originalError: error.message }
      }
    }
  },

  services: ['materialService']
}

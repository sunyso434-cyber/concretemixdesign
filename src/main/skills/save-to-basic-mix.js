/**
 * 保存到基准配合比库 Skill
 * 把已确认的配合比方案保存到基准配合比库供后续报价/复用
 *
 * v10.x 流程（SPEC 3.3）：
 * 1. 查方案，提取材料数据
 * 2. 调 ask_user form 模式弹窗确认/修改（fields: name/strengthGrade/concreteType/slump）
 * 3. 用户确认 → createBasicMixDesign + 写 audit_logs(CREATE)
 * 4. 用户取消 → 不保存
 *
 * 不再用 requiresConfirmation 框架（v10.x 彻底删除），改用 ask_user form 模式。
 */

const askUser = require('./ask-user')

module.exports = {
  name: 'save_to_basic_mix_library',
  description: '把已确认的配合比方案保存到基准库供后续报价复用。**schemeId 可选**——不传则取最近一条已确认方案。弹窗（form）让用户改名称/强度/类型/坍落度。**只新增不修改**——已存在的基准用 save_basic_mix_design。写 audit_logs(CREATE)。**必须先确认过方案**（草稿状态不算"已确认"）。',
  version: '2.0.0',
  category: 'save',

  parameters: {
    schemeId: {
      type: 'integer',
      description: '要保存的方案 ID（可选，不传则取最近一条已确认方案）',
      required: false
    },
    name: {
      type: 'string',
      description: '基准方案名称（可选，弹窗可改）',
      required: false
    },
    strengthGrade: {
      type: 'string',
      description: '强度等级，如 C30（弹窗可改）',
      required: false
    },
    concreteType: {
      type: 'string',
      description: '混凝土类型（弹窗可改）',
      required: false
    },
    slump: {
      type: 'number',
      description: '坍落度 mm（弹窗可改）',
      required: false
    },
    isDefault: {
      type: 'boolean',
      description: '是否设为该强度等级下的默认基准',
      required: false
    },
    remarks: {
      type: 'string',
      description: '备注',
      required: false
    }
  },

  errors: {
    NO_SCHEME: {
      code: 'NO_SCHEME',
      message: '没有可推广的配合比方案',
      hint: '请先执行配合比计算并确认保存',
      recovery: 'none'
    },
    SAVE_FAILED: {
      code: 'SAVE_FAILED',
      message: '保存到基准配合比库失败',
      hint: '请检查配合比数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { mixDesignService, basicMixDesignService, materialService, auditLogService, logger } = context
    const { schemeId, name, strengthGrade, concreteType, slump, isDefault, remarks } = args

    try {
      // 1. 获取要保存的方案
      let scheme = null
      if (schemeId) {
        scheme = await mixDesignService.getMixDesignById(schemeId)
      } else {
        const recent = await mixDesignService.getAllMixDesigns({ excludeDrafts: true })
        if (recent && recent.length > 0) scheme = recent[0]
      }

      if (!scheme) {
        return { success: false, error: this.errors.NO_SCHEME }
      }

      const d = scheme.toJSON ? scheme.toJSON() : scheme
      const materials = d.materials || {}
      const selected = d.materialDetails || {}
      const fineBreakdown = d.fineAggregateBreakdown || []
      const coarseBreakdown = d.coarseAggregateBreakdown || []

      // 2. 构造 materials 数组（提取自方案的 materials 对象 + materialDetails）
      const buildMaterialsArray = async (mats, sel, fineBd, coarseBd) => {
        const arr = []
        const getMaterialInfo = (key, fallbackName) => {
          const info = sel[key]
          if (info && typeof info === 'object' && !Array.isArray(info)) {
            return {
              id: info.id || null,
              name: info.name || fallbackName,
              price: info.price != null ? Number(info.price) : null
            }
          }
          return { id: null, name: fallbackName, price: null }
        }
        const pushIf = (cond, type, key, fallbackName, usage) => {
          if (cond) {
            const info = getMaterialInfo(key, fallbackName)
            arr.push({ materialId: info.id, materialType: type, materialName: info.name, usage, price: info.price })
          }
        }

        pushIf(mats.cement != null, '水泥', 'cement', '水泥', mats.cement)
        pushIf(mats.flyAsh != null && mats.flyAsh > 0, '粉煤灰', 'flyAsh', '粉煤灰', mats.flyAsh)
        pushIf(mats.slag != null && mats.slag > 0, '矿渣粉', 'slag', '矿渣粉', mats.slag)
        pushIf(mats.lithiumSlag != null && mats.lithiumSlag > 0, '锂渣', 'lithiumSlag', '锂渣', mats.lithiumSlag)
        pushIf(mats.compositePowder != null && mats.compositePowder > 0, '复合粉', 'compositePowder', '复合粉', mats.compositePowder)
        pushIf(mats.superplasticizer != null && mats.superplasticizer > 0, '减水剂', 'superplasticizer', '减水剂', mats.superplasticizer)

        if (fineBd && fineBd.length > 0) {
          fineBd.forEach((f, i) => {
            arr.push({ materialId: f.id || null, materialType: '细骨料', materialName: f.name || `细骨料${i + 1}`, usage: f.amount, price: f.price || null })
          })
        } else if (mats.sand != null && mats.sand > 0) {
          const info = getMaterialInfo('sand', '细骨料')
          if (Array.isArray(sel.sand) && sel.sand.length > 0) {
            sel.sand.forEach((s, i) => {
              arr.push({ materialId: s.id || null, materialType: '细骨料', materialName: s.name || `细骨料${i + 1}`, usage: mats.sand / sel.sand.length, price: s.price || null })
            })
          } else {
            arr.push({ materialId: info.id, materialType: '细骨料', materialName: info.name, usage: mats.sand, price: info.price })
          }
        }

        if (coarseBd && coarseBd.length > 0) {
          coarseBd.forEach((c, i) => {
            arr.push({ materialId: c.id || null, materialType: '粗骨料', materialName: c.name || `粗骨料${i + 1}`, usage: c.amount, price: c.price || null })
          })
        } else if (mats.stone != null && mats.stone > 0) {
          const info = getMaterialInfo('stone', '粗骨料')
          if (Array.isArray(sel.stone) && sel.stone.length > 0) {
            sel.stone.forEach((s, i) => {
              arr.push({ materialId: s.id || null, materialType: '粗骨料', materialName: s.name || `粗骨料${i + 1}`, usage: mats.stone / sel.stone.length, price: s.price || null })
            })
          } else {
            arr.push({ materialId: info.id, materialType: '粗骨料', materialName: info.name, usage: mats.stone, price: info.price })
          }
        }

        if (mats.water != null && mats.water > 0) {
          const allMats = await materialService.getAllMaterials()
          const waterMat = allMats.find(m => m.type === '水' || m.name === '水')
          arr.push({ materialId: waterMat?.id || null, materialType: '水', materialName: '水', usage: mats.water, price: null })
        }
        return arr
      }

      const strength = d.strength || 'C30'
      const defaultSlump = d.slump || 180
      const materialsArray = await buildMaterialsArray(materials, selected, fineBreakdown, coarseBreakdown)

      // 3. 弹窗确认（ask_user form 模式）
      const confirm = await askUser.execute({
        inputType: 'form',
        question: `确认保存到基准配合比库吗？可调整名称、强度、类型、坍落度。`,
        fields: [
          { key: 'name', label: '基准方案名称', type: 'string', value: name || `${strength}智能设计基准 - ${new Date().toLocaleString('zh-CN', { hour12: false })}` },
          { key: 'strengthGrade', label: '强度等级', type: 'string', value: strengthGrade || strength },
          { key: 'concreteType', label: '混凝土类型', type: 'string', value: concreteType || '普通' },
          { key: 'slump', label: '坍落度(mm)', type: 'number', value: slump != null ? slump : defaultSlump }
        ]
      }, context)
      if (!confirm.success) {
        return { success: false, error: '用户未确认保存' }
      }

      // 4. 用 values 调 createBasicMixDesign
      const payload = {
        name: confirm.values.name,
        strengthGrade: confirm.values.strengthGrade,
        concreteType: confirm.values.concreteType,
        slump: Number(confirm.values.slump),
        materials: materialsArray,
        isDefault: !!isDefault,
        remarks: remarks || '',
        source: '智能设计保存'
      }

      logger.info(`[save_to_basic_mix_library] 新增基准方案: ${payload.name}`)
      const created = await basicMixDesignService.createBasicMixDesign(payload)

      // 5. 写审计日志
      await auditLogService.write({
        action: 'CREATE',
        targetType: 'basic_mix',
        targetId: created.id,
        targetName: payload.name,
        before: null,
        after: {
          name: payload.name,
          strengthGrade: payload.strengthGrade,
          concreteType: payload.concreteType,
          slump: payload.slump,
          materialsCount: payload.materials.length
        }
      })

      return {
        success: true,
        type: 'save_result',
        message: `基准方案「${payload.name}」已保存`,
        id: created.id
      }
    } catch (error) {
      logger.error('保存到基准配合比库失败:', error)
      return { success: false, error: this.errors.SAVE_FAILED, details: { originalError: error.message } }
    }
  },

  services: ['mixDesignService', 'basicMixDesignService', 'materialService', 'auditLogService']
}

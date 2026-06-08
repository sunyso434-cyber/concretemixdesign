/**
 * 保存到基准配合比库 Skill
 * 保存配合比到基准配合比库供后续使用
 */

module.exports = {
  name: 'save_to_basic_mix_library',
  description: '保存配合比到基准配合比库。当用户要求保存到基准库或后续需要用于报价时调用。',
  version: '1.0.0',
  category: 'save',
  requiresConfirmation: true,

  parameters: {
    name: {
      type: 'string',
      description: '配合比名称',
      required: false
    },
    strengthGrade: {
      type: 'string',
      description: '强度等级，如 C30',
      required: false
    }
  },

  errors: {
    SAVE_FAILED: {
      code: 'SAVE_FAILED',
      message: '保存到基准配合比库失败',
      hint: '请检查配合比数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { mixDesignService, basicMixDesignService, materialService, logger } = context
    const { schemeId, name, strengthGrade, concreteType, slump, isDefault, remarks } = args

    logger.info('保存到基准配合比库')

    try {
      // 1. 获取要保存的方案
      let scheme = null
      if (schemeId) {
        scheme = await mixDesignService.getMixDesignById(schemeId)
      } else {
        // 取最近一条已确认的方案
        const recent = await mixDesignService.getAllMixDesigns({ excludeDrafts: true })
        if (recent && recent.length > 0) scheme = recent[0]
      }

      if (!scheme) {
        return {
          success: false,
          error: '没有可推广的配合比方案。请先执行配合比计算并确认。'
        }
      }

      const d = scheme.toJSON ? scheme.toJSON() : scheme
      const materials = d.materials || {}
      const selected = d.materialDetails || {}
      const fineBreakdown = d.fineAggregateBreakdown || []
      const coarseBreakdown = d.coarseAggregateBreakdown || []

      // 2. 将材料对象转换为 BasicMixDesign 所需的数组格式
      const buildMaterialsArray = async (mats, sel, fineBd, coarseBd) => {
        const arr = []
        const findName = (key, fallback) => {
          if (sel && sel[key] && typeof sel[key] === 'object') return sel[key].name || sel[key]
          if (sel && sel[key] && typeof sel[key] === 'string') return sel[key]
          return fallback || key
        }
        const findId = (key) => {
          if (sel && sel[key] && typeof sel[key] === 'object') return sel[key].id
          return null
        }
        const pushIf = (cond, type, name, usage, id = null) => {
          if (cond) arr.push({ materialId: id, materialType: type, materialName: name, usage })
        }
        pushIf(mats.cement != null, '水泥', findName('cement', '水泥'), mats.cement, findId('cement'))
        pushIf(mats.flyAsh != null && mats.flyAsh > 0, '粉煤灰', findName('flyAsh', '粉煤灰'), mats.flyAsh, findId('flyAsh'))
        pushIf(mats.slag != null && mats.slag > 0, '矿渣粉', findName('slag', '矿渣粉'), mats.slag, findId('slag'))
        pushIf(mats.lithiumSlag != null && mats.lithiumSlag > 0, '锂渣', findName('lithiumSlag', '锂渣'), mats.lithiumSlag, findId('lithiumSlag'))
        pushIf(mats.compositePowder != null && mats.compositePowder > 0, '复合粉', findName('compositePowder', '复合粉'), mats.compositePowder, findId('compositePowder'))
        pushIf(mats.superplasticizer != null && mats.superplasticizer > 0, '减水剂', findName('superplasticizer', '减水剂'), mats.superplasticizer, findId('superplasticizer'))

        // 细骨料：优先用 breakdown，否则用 sand
        if (fineBd && fineBd.length > 0) {
          fineBd.forEach((f, i) => arr.push({ materialId: f.id || null, materialType: '细骨料', materialName: f.name || `细骨料${i + 1}`, usage: f.amount }))
        } else if (mats.sand != null && mats.sand > 0) {
          arr.push({ materialId: findId('sand'), materialType: '细骨料', materialName: findName('sand', '细骨料'), usage: mats.sand })
        }

        // 粗骨料：优先用 breakdown，否则用 stone
        if (coarseBd && coarseBd.length > 0) {
          coarseBd.forEach((c, i) => arr.push({ materialId: c.id || null, materialType: '粗骨料', materialName: c.name || `粗骨料${i + 1}`, usage: c.amount }))
        } else if (mats.stone != null && mats.stone > 0) {
          arr.push({ materialId: findId('stone'), materialType: '粗骨料', materialName: findName('stone', '粗骨料'), usage: mats.stone })
        }

        // 水
        if (mats.water != null && mats.water > 0) {
          const allMats = await materialService.getAllMaterials()
          const waterMat = allMats.find(m => m.type === '水' || m.name === '水')
          arr.push({ materialId: waterMat?.id || null, materialType: '水', materialName: '水', usage: mats.water })
        }
        return arr
      }

      const strength = d.strength || 'C30'
      const defaultSlump = d.slump || 180

      // 3. 保存到基准配合比库
      const created = await basicMixDesignService.createBasicMixDesign({
        name: name || `${strength}智能设计基准 - ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        strengthGrade: strengthGrade || strength,
        concreteType: concreteType || '普通',
        slump: slump != null ? slump : defaultSlump,
        materials: await buildMaterialsArray(materials, selected, fineBreakdown, coarseBreakdown),
        isDefault: isDefault || false,
        remarks: remarks || '',
        source: '智能设计保存'
      })

      logger.info(`已保存到基准配合比库, ID=${created.id}`)

      return {
        success: true,
        type: 'save_result',
        message: `方案「${name || strength}」已保存到基础配合比库`,
        id: created.id
      }
    } catch (error) {
      logger.error('保存到基准配合比库失败:', error)
      return {
        success: false,
        error: `保存到基准配合比库失败: ${error.message}`
      }
    }
  },

  services: ['mixDesignService', 'basicMixDesignService', 'materialService']
}

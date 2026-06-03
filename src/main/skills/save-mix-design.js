/**
 * 确认配合比方案 Skill
 * 将草稿状态的配合比方案确认为正式方案
 */

module.exports = {
  name: 'save_mix_design',
  description: '确认保存配合比方案。将草稿状态的方案确认为正式方案。当用户要求保存某个设计方案时调用。',
  version: '2.0.0',
  category: 'save',
  requiresConfirmation: true,

  parameters: {
    schemeId: {
      type: 'integer',
      description: '要确认的草稿方案ID（从计算结果的draftId获取）',
      required: true
    },
    name: {
      type: 'string',
      description: '方案新名称（可选，不填则保留原名）',
      required: false
    }
  },

  errors: {
    MISSING_ID: {
      code: 'MISSING_ID',
      message: '请指定要确认的方案ID',
      hint: '计算完成后会返回draftId，确认保存时需要传入该ID',
      recovery: 'retry'
    },
    NOT_FOUND: {
      code: 'NOT_FOUND',
      message: '方案不存在',
      hint: '请检查方案ID是否正确，该方案可能已被删除',
      recovery: 'retry'
    },
    NOT_DRAFT: {
      code: 'NOT_DRAFT',
      message: '该方案不是草稿状态',
      hint: '只有草稿状态的方案需要确认，已确认的方案无需重复操作',
      recovery: 'none'
    },
    CONFIRM_FAILED: {
      code: 'CONFIRM_FAILED',
      message: '确认方案失败',
      hint: '请检查方案数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { mixDesignService, logger } = context
    const { schemeId, name } = args

    if (!schemeId) {
      return { success: false, error: '请指定要确认的方案ID' }
    }

    logger.info(`确认配合比方案: ID=${schemeId}`)

    try {
      const existing = await mixDesignService.getMixDesignById(schemeId)
      if (!existing) {
        return { success: false, error: `方案ID ${schemeId} 不存在` }
      }

      if (existing.status !== '草稿') {
        return { success: false, error: `该方案不是草稿状态（当前状态：${existing.status}）` }
      }

      const updateData = { status: '已确认' }
      if (name) updateData.name = name

      await mixDesignService.updateMixDesign(schemeId, updateData)
      logger.info(`方案已确认: ${name || existing.name}`)

      return {
        success: true,
        type: 'confirm_result',
        message: `方案「${name || existing.name}」已确认保存`,
        id: schemeId
      }
    } catch (error) {
      logger.error('确认方案失败:', error)
      return {
        success: false,
        error: `确认失败: ${error.message}`
      }
    }
  },

  services: ['mixDesignService']
}

/**
 * 更新配合比方案元信息 Skill
 * 白名单（SPEC 4.1）：name / description / projectName / customerInfo / remarks
 * 不允许改 status / materials / 计算结果（白名单外字段静默忽略）
 */

const UPDATE_WHITELIST = ['name', 'description', 'projectName', 'customerInfo', 'remarks']

module.exports = {
  name: 'update_mix_design',
  description: '更新配合比方案的元信息（名称/描述/项目名/客户信息/备注）。不能改 status/materials/计算结果。白名单外字段静默忽略。',
  version: '1.0.0',
  category: 'update',

  parameters: {
    id: { type: 'integer', required: true },
    name: { type: 'string', required: false },
    description: { type: 'string', required: false },
    projectName: { type: 'string', required: false },
    customerInfo: { type: 'string', required: false, description: '客户信息（JSON 字符串或文本）' },
    remarks: { type: 'string', required: false }
  },

  errors: {
    MISSING_ID: { code: 'MISSING_ID', message: '请指定方案ID', recovery: 'none' },
    NOT_FOUND: { code: 'NOT_FOUND', message: '方案不存在', recovery: 'retry' },
    NO_FIELDS: { code: 'NO_FIELDS', message: '没有可更新的字段', recovery: 'none' },
    UPDATE_FAILED: { code: 'UPDATE_FAILED', message: '更新方案失败', recovery: 'retry' }
  },

  async execute(args, context) {
    const { mixDesignService, auditLogService, logger } = context
    const { id } = args

    if (!id) return { success: false, error: this.errors.MISSING_ID }

    // 白名单过滤
    const patch = {}
    for (const k of UPDATE_WHITELIST) {
      if (args[k] !== undefined) patch[k] = args[k]
    }
    if (Object.keys(patch).length === 0) {
      return { success: false, error: this.errors.NO_FIELDS }
    }

    try {
      const existing = await mixDesignService.getMixDesignById(id)
      if (!existing) return { success: false, error: this.errors.NOT_FOUND, details: { id } }
      const d = existing.toJSON ? existing.toJSON() : existing

      // 快照 before
      const before = {}
      for (const k of Object.keys(patch)) before[k] = d[k]

      await mixDesignService.updateMixDesign(id, patch)

      // 写审计日志
      await auditLogService.write({
        action: 'UPDATE',
        targetType: 'mix_design',
        targetId: id,
        targetName: patch.name || d.name,
        before,
        after: patch
      })

      return {
        success: true,
        message: `方案「${patch.name || d.name}」已更新`,
        id,
        updatedFields: Object.keys(patch)
      }
    } catch (e) {
      logger.error('update_mix_design 失败:', e)
      return { success: false, error: this.errors.UPDATE_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['mixDesignService', 'auditLogService']
}

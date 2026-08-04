/**
 * 确认配合比方案 Skill
 * 把草稿方案转为正式（CONFIRM），或对已确认方案改名（UPDATE）
 *
 * v10.x 状态机（SPEC 3.2）：
 * - 草稿 → 弹窗问"是否转正式" → 确认后 status='已确认' + 更新 name + 写 audit_logs(CONFIRM)
 * - 已确认 → 弹窗问"是否改名" → 改名/不改 → 只更新 name/updatedAt，不重置 status + 写 audit_logs(UPDATE)
 * - 其他状态 → 返回 INVALID_STATUS 错误
 *
 * 不再用 requiresConfirmation 框架（v10.x 彻底删除），改用 ask_user form 模式弹窗。
 */

const askUser = require('./ask-user')

const skill = {
  name: 'save_mix_design',
  description: '把配合比方案从"草稿"转为"已确认"（CONFIRM 状态），或对"已确认"方案改名（UPDATE）。**必传 schemeId**（从 calculate_mix_design/cost_optimization 返回的 draftId 获取）。**仅接受 草稿/已确认 状态**——其他状态（如"已使用""已验证"）返回 INVALID_STATUS。会自动弹窗（ask_user form）让用户确认/改名称 + 写 audit_logs 审计。**不重算用量**——只改 status 和 name。',
  version: '3.0.0',
  category: 'save',

  parameters: {
    schemeId: {
      type: 'integer',
      description: '要确认的方案ID（从计算结果的 draftId 获取）',
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
      hint: '计算完成后会返回 draftId，确认保存时需要传入该 ID',
      recovery: 'retry'
    },
    NOT_FOUND: {
      code: 'NOT_FOUND',
      message: '方案不存在',
      hint: '请检查方案ID是否正确，该方案可能已被删除',
      recovery: 'retry'
    },
    INVALID_STATUS: {
      code: 'INVALID_STATUS',
      message: '该方案状态不允许保存操作',
      hint: '只有 草稿 / 已确认 状态可调用此技能',
      recovery: 'none'
    },
    SAVE_FAILED: {
      code: 'SAVE_FAILED',
      message: '保存方案失败',
      hint: '请检查方案数据是否完整',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { mixDesignService, auditLogService, logger, toolCallId } = context
    const { schemeId, name } = args

    if (!schemeId) {
      return { success: false, error: this.errors.MISSING_ID }
    }

    // 1. 查方案
    const existing = await mixDesignService.getMixDesignById(schemeId)
    if (!existing) {
      return { success: false, error: this.errors.NOT_FOUND, details: { id: schemeId } }
    }

    // 2. 状态机校验
    const allowedStatuses = ['草稿', '已确认']
    if (!allowedStatuses.includes(existing.status)) {
      return {
        success: false,
        error: this.errors.INVALID_STATUS,
        details: { currentStatus: existing.status, allowedStatuses }
      }
    }
    const isDraft = existing.status === '草稿'

    // 3. 弹窗确认（ask_user form 模式）
    const initialName = name || existing.name
    const confirm = await askUser.execute({
      inputType: 'form',
      question: isDraft
        ? `确认方案「${existing.name}」从草稿转为正式吗？`
        : `编辑方案「${existing.name}」名称`,
      fields: [
        { key: 'name', label: '方案名称', type: 'string', value: initialName }
      ]
    }, context)
    if (!confirm.success) {
      return { success: false, error: '用户未确认保存' }
    }
    const newName = confirm.values.name

    // 4. 准备 patch + 审计 before/after
    const patch = isDraft
      ? { status: '已确认', name: newName }
      : { name: newName }  // 已确认状态不重置 status

    const before = { name: existing.name, status: existing.status }
    const after = { name: newName, status: isDraft ? '已确认' : existing.status }

    try {
      logger.info(`[save_mix_design] ${isDraft ? 'CONFIRM' : 'UPDATE'} 方案 ${schemeId}: ${existing.name} → ${newName} requestId=${toolCallId || 'none'}`)
      await mixDesignService.updateMixDesign(schemeId, patch)

      // 5. 写审计日志（v0.6.0 Task 1.12：传 requestId 幂等，重跑同 tool_call 不重复写）
      await auditLogService.write({
        action: isDraft ? 'CONFIRM' : 'UPDATE',
        targetType: 'mix_design',
        targetId: schemeId,
        targetName: newName,
        before,
        after,
        requestId: toolCallId || null
      })

      return {
        success: true,
        type: isDraft ? 'confirm_result' : 'update_result',
        message: isDraft
          ? `方案「${newName}」已确认保存`
          : `方案「${newName}」名称已更新`,
        id: schemeId,
        action: isDraft ? 'CONFIRM' : 'UPDATE'
      }
    } catch (e) {
      logger.error('save_mix_design 失败:', e)
      return { success: false, error: this.errors.SAVE_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['mixDesignService', 'auditLogService']
}

module.exports = skill

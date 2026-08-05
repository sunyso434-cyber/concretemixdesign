/**
 * 删除配合比方案 Skill
 *
 * 流程（SPEC 2.2 + SPEC 4.1）：
 * - 草稿状态：直接删除 + 写 audit_logs(DELETE)
 * - 非草稿：弹窗确认（choice 模式带"其他"输入框）
 *   - 用户选"确认删除" → 删 + 写审计
 *   - 用户选"取消" → 不删
 *   - 用户填"其他" → 返回 userIntent 让 AI 决定（不擅自执行）
 */

const askUser = require('./ask-user')

module.exports = {
  name: 'delete_mix_design',
  description: '删除配合比方案。草稿可直接删；正式方案会弹窗确认（choice 模式带"其他"输入框）。用户说"删掉XX方案"时调用。',
  version: '1.0.0',
  category: 'delete',
  isWrite: true,

  parameters: {
    id: { type: 'integer', required: true, description: '方案 ID' }
  },

  errors: {
    MISSING_ID: { code: 'MISSING_ID', message: '请指定方案ID', recovery: 'none' },
    NOT_FOUND: { code: 'NOT_FOUND', message: '方案不存在', recovery: 'none' },
    DELETE_FAILED: { code: 'DELETE_FAILED', message: '删除方案失败', recovery: 'retry' }
  },

  async execute(args, context) {
    const { mixDesignService, auditLogService, logger } = context
    const { id } = args
    if (!id) return { success: false, error: this.errors.MISSING_ID }

    try {
      const existing = await mixDesignService.getMixDesignById(id)
      if (!existing) return { success: false, error: this.errors.NOT_FOUND, details: { id } }
      const d = existing.toJSON ? existing.toJSON() : existing
      const isDraft = d.status === '草稿'

      // 非草稿状态需弹窗确认
      if (!isDraft) {
        const confirm = await askUser.execute({
          inputType: 'choice',
          question: `方案「${d.name}」是${d.status}状态，确认删除吗？`,
          options: ['确认删除', '取消']
        }, context)
        // SPEC 2.2 userIntent 协议
        if (!confirm.success) {
          return { success: false, error: '用户未确认删除' }
        }
        if (confirm.answer === '取消') {
          return { success: false, error: '用户取消删除' }
        }
        if (confirm.answer !== '确认删除') {
          return { success: false, error: '用户回答待处理', userIntent: confirm.answer }
        }
      }

      // 实际删除
      const before = { name: d.name, status: d.status }
      await mixDesignService.deleteMixDesign(id)

      // 写审计日志
      await auditLogService.write({
        action: 'DELETE',
        targetType: 'mix_design',
        targetId: id,
        targetName: d.name,
        before,
        after: null
      })

      return {
        success: true,
        message: `方案「${d.name}」已删除`,
        id,
        wasDraft: isDraft
      }
    } catch (e) {
      logger.error('delete_mix_design 失败:', e)
      return { success: false, error: this.errors.DELETE_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['mixDesignService', 'auditLogService']
}

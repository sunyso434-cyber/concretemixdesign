/**
 * 删除基准配合比方案 Skill
 *
 * 流程（SPEC 4.1+4.2+2.2）：
 * 1. 查现有
 * 2. 引用检查（mixDesignService.findByBasicMixId(id)）—— 被引用则返回 IN_USE 错误 + 引用方案名清单，不删
 * 3. 弹窗确认（choice 模式带"其他"输入框）
 *   - 用户选"确认删除" → 删 + 写 audit_logs(DELETE)
 *   - 用户选"取消" → 不删
 *   - 用户填"其他" → 返回 userIntent 让 AI 决定（不擅自执行）
 * 4. 实际删除 + 写审计日志
 */

const askUser = require('./ask-user')

module.exports = {
  name: 'delete_basic_mix_design',
  description: '删除基准配合比方案。**被正式方案引用时拒绝删除**，返回 IN_USE 错误 + 引用方案名清单（referencedCount/referencedNames）。删除前弹窗确认（choice 带"其他"输入框）。',
  version: '1.0.0',
  category: 'delete',

  parameters: {
    id: { type: 'integer', required: true, description: '基准方案 ID' }
  },

  errors: {
    MISSING_ID: { code: 'MISSING_ID', message: '请指定基准方案ID', recovery: 'none' },
    NOT_FOUND: { code: 'NOT_FOUND', message: '基准方案不存在', recovery: 'none' },
    IN_USE: { code: 'IN_USE', message: '基准方案被引用，无法删除' },
    DELETE_FAILED: { code: 'DELETE_FAILED', message: '删除基准方案失败', recovery: 'retry' }
  },

  async execute(args, context) {
    const { basicMixDesignService, mixDesignService, auditLogService, logger } = context
    const { id } = args
    if (!id) return { success: false, error: this.errors.MISSING_ID }

    try {
      // 1. 查现有
      const existing = await basicMixDesignService.findById(id)
      if (!existing) return { success: false, error: this.errors.NOT_FOUND, details: { id } }
      const d = existing.toJSON ? existing.toJSON() : existing

      // 2. 引用检查
      const referenced = await mixDesignService.findByBasicMixId(id)
      if (Array.isArray(referenced) && referenced.length > 0) {
        const referencedNames = referenced
          .map(r => r && r.name)
          .filter(Boolean)
        return {
          success: false,
          error: this.errors.IN_USE,
          details: {
            referencedCount: referenced.length,
            referencedNames
          }
        }
      }

      // 3. 弹窗确认
      const confirm = await askUser.execute({
        inputType: 'choice',
        question: `确认删除基准方案「${d.name}」吗？`,
        options: ['确认删除', '取消']
      }, context)
      if (!confirm.success) return { success: false, error: '用户未确认删除' }
      if (confirm.answer === '取消') return { success: false, error: '用户取消删除' }
      if (confirm.answer !== '确认删除') {
        return { success: false, error: '用户回答待处理', userIntent: confirm.answer }
      }

      // 4. 实际删除 + 审计
      const before = { name: d.name, strengthGrade: d.strengthGrade }
      await basicMixDesignService.deleteBasicMixDesign(id)
      await auditLogService.write({
        action: 'DELETE',
        targetType: 'basic_mix',
        targetId: id,
        targetName: d.name,
        before,
        after: null
      })

      return { success: true, message: `基准方案「${d.name}」已删除`, id }
    } catch (e) {
      logger.error('delete_basic_mix_design 失败:', e)
      return { success: false, error: this.errors.DELETE_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['basicMixDesignService', 'mixDesignService', 'auditLogService']
}

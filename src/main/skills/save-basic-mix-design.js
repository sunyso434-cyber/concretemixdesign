/**
 * 新增/更新基准配合比方案 Skill（SPEC 4.1.1）
 * - 传 id = 更新；不传 id = 新增
 * - 保存前弹窗确认（ask_user form）
 * - 写审计日志
 */

const askUser = require('./ask-user')

module.exports = {
  name: 'save_basic_mix_design',
  description: '新增或更新基准配合比方案。传 id=更新，不传=新增。保存前弹窗确认（form 模式）。',
  version: '1.0.0',
  category: 'save',

  parameters: {
    id: { type: 'integer', required: false, description: '不传=新增；传=更新' },
    name: { type: 'string', required: true },
    strengthGrade: { type: 'string', required: true },
    concreteType: { type: 'string', required: true },
    slump: { type: 'number', required: false },
    materials: { type: 'array', required: true },
    isDefault: { type: 'boolean', required: false },
    remarks: { type: 'string', required: false }
  },

  errors: {
    MISSING_FIELDS: { code: 'MISSING_FIELDS', message: 'name/strengthGrade/concreteType 必填', recovery: 'none' },
    INVALID_MATERIALS: { code: 'INVALID_MATERIALS', message: '材料列表无效', recovery: 'none' },
    NOT_FOUND: { code: 'NOT_FOUND', message: '基准方案不存在（更新时）', recovery: 'retry' },
    SAVE_FAILED: { code: 'SAVE_FAILED', message: '保存基准方案失败', recovery: 'retry' }
  },

  async execute(args, context) {
    const { basicMixDesignService, auditLogService, logger } = context
    const { id, name, strengthGrade, concreteType, slump, materials, isDefault, remarks } = args

    // 必填校验
    if (!name || !strengthGrade || !concreteType) {
      return { success: false, error: this.errors.MISSING_FIELDS }
    }
    if (!Array.isArray(materials) || materials.length === 0) {
      return { success: false, error: this.errors.INVALID_MATERIALS }
    }

    const isUpdate = id != null
    let existing = null
    if (isUpdate) {
      try {
        existing = await basicMixDesignService.findById(id)
      } catch (_) { /* fallthrough */ }
      if (!existing) return { success: false, error: this.errors.NOT_FOUND, details: { id } }
    }

    // 弹窗确认（form 模式）
    const initial = existing || {}
    const confirm = await askUser.execute({
      inputType: 'form',
      question: isUpdate
        ? `确认更新基准方案「${initial.name}」吗？`
        : `确认新增基准方案「${name}」吗？`,
      fields: [
        { key: 'name', label: '名称', type: 'string', value: initial.name || name },
        { key: 'strengthGrade', label: '强度等级', type: 'string', value: initial.strengthGrade || strengthGrade },
        { key: 'concreteType', label: '混凝土类型', type: 'string', value: initial.concreteType || concreteType },
        { key: 'slump', label: '坍落度', type: 'number', value: initial.slump != null ? initial.slump : (slump || 0) },
        { key: 'isDefault', label: '设为默认', type: 'boolean', value: !!(initial.isDefault ?? isDefault) }
      ]
    }, context)
    if (!confirm.success) {
      return { success: false, error: '用户未确认保存' }
    }

    const payload = {
      name: confirm.values.name,
      strengthGrade: confirm.values.strengthGrade,
      concreteType: confirm.values.concreteType,
      slump: Number(confirm.values.slump),
      materials,
      isDefault: !!confirm.values.isDefault,
      remarks: remarks || ''
    }

    try {
      const before = existing
        ? { name: existing.name, strengthGrade: existing.strengthGrade, concreteType: existing.concreteType, slump: existing.slump, isDefault: existing.isDefault }
        : null

      if (isUpdate) {
        await basicMixDesignService.updateBasicMixDesign(id, payload)
        await auditLogService.write({
          action: 'UPDATE',
          targetType: 'basic_mix',
          targetId: id,
          targetName: payload.name,
          before,
          after: payload
        })
        return { success: true, message: `基准方案「${payload.name}」已更新`, id }
      } else {
        const row = await basicMixDesignService.createBasicMixDesign(payload)
        const newId = row.id || (row.toJSON && row.toJSON().id)
        await auditLogService.write({
          action: 'CREATE',
          targetType: 'basic_mix',
          targetId: newId,
          targetName: payload.name,
          before: null,
          after: payload
        })
        return { success: true, message: `基准方案「${payload.name}」已创建`, id: newId }
      }
    } catch (e) {
      logger.error('save_basic_mix_design 失败:', e)
      return { success: false, error: this.errors.SAVE_FAILED, details: { originalError: e.message } }
    }
  },

  services: ['basicMixDesignService', 'auditLogService']
}

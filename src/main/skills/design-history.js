/**
 * 历史查询 Skill
 * 查询历史配合比设计记录
 */

module.exports = {
  name: 'query_design_history',
  description: '查询历史配合比设计记录。当用户询问之前的方案、想找类似设计、或需要参考历史数据时调用。',
  version: '1.0.0',
  category: 'query',

  parameters: {
    strength: {
      type: 'string',
      description: '强度等级筛选，如 C30',
      required: false
    },
    keyword: {
      type: 'string',
      description: '关键词搜索（项目名、材料名等）',
      required: false
    },
    limit: {
      type: 'integer',
      description: '返回条数，默认 5',
      required: false,
      min: 1,
      max: 50
    }
  },

  errors: {
    QUERY_FAILED: {
      code: 'QUERY_FAILED',
      message: '历史查询失败',
      hint: '请稍后重试',
      recovery: 'retry'
    }
  },

  async execute(args, context) {
    const { logger } = context
    const { strength, keyword, limit = 5 } = args

    logger.info(`查询历史记录: strength=${strength}, keyword=${keyword}, limit=${limit}`)

    try {
      const { Op } = require('sequelize')
      const { MixDesign, BasicMixDesign } = require('../db/database')

      const actualLimit = Math.min(Math.max(parseInt(limit) || 5, 1), 50)

      // Build query conditions
      const mixDesignWhere = {}
      const basicMixWhere = {}

      if (strength) {
        mixDesignWhere.strength = { [Op.like]: `%${strength}%` }
        basicMixWhere.strengthGrade = { [Op.like]: `%${strength}%` }
      }
      if (keyword) {
        mixDesignWhere[Op.or] = [
          { name: { [Op.like]: `%${keyword}%` } },
          { projectName: { [Op.like]: `%${keyword}%` } },
          { description: { [Op.like]: `%${keyword}%` } }
        ]
        basicMixWhere[Op.or] = [
          { name: { [Op.like]: `%${keyword}%` } },
          { remarks: { [Op.like]: `%${keyword}%` } }
        ]
      }

      // Query both tables in parallel
      const [mixDesigns, basicMixDesigns] = await Promise.all([
        MixDesign.findAll({
          where: mixDesignWhere,
          order: [['createdAt', 'DESC']],
          limit: actualLimit,
          attributes: ['id', 'name', 'projectName', 'strength', 'slump', 'waterRatio', 'sandRatio', 'density', 'materials', 'totalCost', 'createdAt']
        }).catch(() => []),
        BasicMixDesign.findAll({
          where: basicMixWhere,
          order: [['createdAt', 'DESC']],
          limit: actualLimit,
          attributes: ['id', 'name', 'strengthGrade', 'concreteType', 'slump', 'materials', 'isDefault', 'source', 'remarks', 'createdAt']
        }).catch(() => [])
      ])

      // Normalize results
      const records = [
        ...mixDesigns.map(r => ({
          source: '方案库',
          id: r.id,
          name: r.name,
          projectName: r.projectName,
          strength: r.strength,
          slump: r.slump,
          waterRatio: r.waterRatio,
          sandRatio: r.sandRatio,
          density: r.density,
          materials: r.materials,
          totalCost: r.totalCost,
          createdAt: r.createdAt
        })),
        ...basicMixDesigns.map(r => ({
          source: '基准配合比库',
          id: r.id,
          name: r.name,
          strength: r.strengthGrade,
          concreteType: r.concreteType,
          slump: r.slump,
          materials: r.materials,
          isDefault: r.isDefault,
          source2: r.source,
          remarks: r.remarks,
          createdAt: r.createdAt
        }))
      ]

      // Sort and limit
      records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      const limitedRecords = records.slice(0, actualLimit)

      if (limitedRecords.length === 0) {
        return { success: true, data: { records: [], message: '未找到匹配的历史设计记录' } }
      }

      logger.info(`找到 ${limitedRecords.length} 条历史记录`)
      return { success: true, data: { records: limitedRecords } }
    } catch (error) {
      logger.error('历史查询失败:', error)
      return {
        success: false,
        error: this.errors.QUERY_FAILED,
        details: { originalError: error.message }
      }
    }
  }
}

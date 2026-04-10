const { sequelize } = require('../db/database')
const MassConcreteScheme = require('../db/models/MassConcreteScheme')
const MassConcreteMixDesign = require('../db/models/MassConcreteMixDesign')
const MassConcreteAdiabaticTemp = require('../db/models/MassConcreteAdiabaticTemp')
const MassConcreteStress = require('../db/models/MassConcreteStress')
const MassConcreteInsulation = require('../db/models/MassConcreteInsulation')

class MassConcreteSchemeService {
  // 获取所有方案，按创建时间倒序排列
  async getAllSchemes() {
    try {
      const schemes = await MassConcreteScheme.findAll({
        order: [['createdAt', 'DESC']]
      })
      return schemes.map(scheme => scheme.toJSON())
    } catch (error) {
      console.error('获取方案列表失败:', error)
      throw error
    }
  }

  // 根据ID获取完整方案，包括所有关联数据
  async getSchemeById(id) {
    try {
      const scheme = await MassConcreteScheme.findByPk(id)
      if (!scheme) {
        return null
      }

      // 并行查询所有关联数据
      const [mixDesign, adiabaticTemp, stress, insulation] = await Promise.all([
        MassConcreteMixDesign.findOne({ where: { schemeId: id } }),
        MassConcreteAdiabaticTemp.findOne({ where: { schemeId: id } }),
        MassConcreteStress.findOne({ where: { schemeId: id } }),
        MassConcreteInsulation.findOne({ where: { schemeId: id } })
      ])

      return {
        ...scheme.toJSON(),
        mixDesign: mixDesign ? mixDesign.toJSON() : null,
        adiabaticTemp: adiabaticTemp ? adiabaticTemp.toJSON() : null,
        stress: stress ? stress.toJSON() : null,
        insulation: insulation ? insulation.toJSON() : null
      }
    } catch (error) {
      console.error('获取方案详情失败:', error)
      throw error
    }
  }

  // 创建新方案
  async createScheme(data) {
    try {
      const scheme = await MassConcreteScheme.create(data)
      return scheme.toJSON()
    } catch (error) {
      console.error('创建方案失败:', error)
      throw error
    }
  }

  // 更新方案
  async updateScheme(id, data) {
    try {
      const scheme = await MassConcreteScheme.findByPk(id)
      if (!scheme) {
        throw new Error('方案不存在')
      }
      const updatedScheme = await scheme.update(data)
      return updatedScheme.toJSON()
    } catch (error) {
      console.error('更新方案失败:', error)
      throw error
    }
  }

  // 删除方案，级联删除所有关联数据
  async deleteScheme(id) {
    try {
      const scheme = await MassConcreteScheme.findByPk(id)
      if (!scheme) {
        throw new Error('方案不存在')
      }

      // 使用事务确保原子性
      await sequelize.transaction(async (t) => {
        // 级联删除关联数据
        await MassConcreteMixDesign.destroy({ where: { schemeId: id }, transaction: t })
        await MassConcreteAdiabaticTemp.destroy({ where: { schemeId: id }, transaction: t })
        await MassConcreteStress.destroy({ where: { schemeId: id }, transaction: t })
        await MassConcreteInsulation.destroy({ where: { schemeId: id }, transaction: t })

        // 删除方案本身
        await scheme.destroy({ transaction: t })
      })

      return { success: true }
    } catch (error) {
      console.error('删除方案失败:', error)
      throw error
    }
  }
}

module.exports = new MassConcreteSchemeService()
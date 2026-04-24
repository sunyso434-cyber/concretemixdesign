const InsulationMaterial = require('../db/models/InsulationMaterial')

class InsulationMaterialService {
  // 获取所有保温材料，按 isDefault desc, name asc 排序
  async getAllMaterials() {
    try {
      const materials = await InsulationMaterial.findAll({
        order: [
          ['isDefault', 'DESC'],
          ['name', 'ASC']
        ]
      })
      return materials.map(m => m.toJSON())
    } catch (error) {
      console.error('获取保温材料列表失败:', error)
      throw error
    }
  }

  // 获取默认保温材料
  async getDefaultMaterials() {
    try {
      const materials = await InsulationMaterial.findAll({
        where: { isDefault: true },
        order: [['name', 'ASC']]
      })
      return materials.map(m => m.toJSON())
    } catch (error) {
      console.error('获取默认保温材料失败:', error)
      throw error
    }
  }

  // 根据ID获取保温材料
  async getMaterialById(id) {
    try {
      const material = await InsulationMaterial.findByPk(id)
      return material ? material.toJSON() : null
    } catch (error) {
      console.error('获取保温材料详情失败:', error)
      throw error
    }
  }

  // 创建保温材料
  async createMaterial(data) {
    try {
      const material = await InsulationMaterial.create(data)
      return material.toJSON()
    } catch (error) {
      console.error('创建保温材料失败:', error)
      throw error
    }
  }

  // 更新保温材料
  async updateMaterial(id, data) {
    try {
      const material = await InsulationMaterial.findByPk(id)
      if (!material) {
        throw new Error('保温材料不存在')
      }
      const updatedMaterial = await material.update(data)
      return updatedMaterial.toJSON()
    } catch (error) {
      console.error('更新保温材料失败:', error)
      throw error
    }
  }

  // 删除保温材料
  async deleteMaterial(id) {
    try {
      const material = await InsulationMaterial.findByPk(id)
      if (!material) {
        throw new Error('保温材料不存在')
      }
      if (material.isDefault) {
        throw new Error('默认保温材料不能删除')
      }
      await material.destroy()
      return true
    } catch (error) {
      console.error('删除保温材料失败:', error)
      throw error
    }
  }

  /**
   * 获取所有保温材料（按类别分组）
   * @returns {Promise<Object>} { organic: [], inorganic: [], composite: [] }
   */
  async getAllMaterialsGrouped() {
    try {
      const materials = await InsulationMaterial.findAll({
        order: [
          ['category', 'ASC'],
          ['name', 'ASC']
        ]
      })

      const grouped = {
        organic: [],
        inorganic: [],
        composite: []
      }

      materials.forEach(m => {
        const cat = m.category || 'organic'
        if (grouped[cat]) {
          grouped[cat].push(m.toJSON())
        }
      })

      return grouped
    } catch (error) {
      console.error('获取保温材料列表失败:', error)
      throw error
    }
  }
}

module.exports = new InsulationMaterialService()
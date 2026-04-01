// 原材料数据访问层
const { Material, Op } = require('../models');

class MaterialRepository {
  // 创建原材料
  async create(data) {
    return await Material.create(data);
  }

  // 根据ID获取原材料
  async getById(id) {
    return await Material.findByPk(id);
  }

  // 获取所有原材料
  async getAll() {
    return await Material.findAll();
  }

  // 根据类型获取原材料
  async getByType(type) {
    return await Material.findAll({ where: { type } });
  }

  // 更新原材料
  async update(id, data) {
    const material = await Material.findByPk(id);
    if (material) {
      return await material.update(data);
    }
    return null;
  }

  // 删除原材料
  async delete(id) {
    const material = await Material.findByPk(id);
    if (material) {
      return await material.destroy();
    }
    return null;
  }

  // 搜索原材料
  async search(keyword) {
    return await Material.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.like]: `%${keyword}%` } },
          { specification: { [Op.like]: `%${keyword}%` } },
          { manufacturer: { [Op.like]: `%${keyword}%` } }
        ]
      }
    });
  }
}

module.exports = new MaterialRepository();
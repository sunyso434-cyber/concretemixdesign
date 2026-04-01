// 配合比方案数据访问层
const { MixDesign, Op } = require('../models');

class MixDesignRepository {
  // 创建配合比方案
  async create(data) {
    return await MixDesign.create(data);
  }

  // 根据ID获取配合比方案
  async getById(id) {
    return await MixDesign.findByPk(id);
  }

  // 获取所有配合比方案
  async getAll() {
    return await MixDesign.findAll();
  }

  // 根据强度等级获取配合比方案
  async getByStrengthGrade(strengthGrade) {
    return await MixDesign.findAll({ where: { strength: strengthGrade } });
  }

  // 更新配合比方案
  async update(id, data) {
    const mixDesign = await MixDesign.findByPk(id);
    if (mixDesign) {
      return await mixDesign.update(data);
    }
    return null;
  }

  // 删除配合比方案
  async delete(id) {
    const mixDesign = await MixDesign.findByPk(id);
    if (mixDesign) {
      return await mixDesign.destroy();
    }
    return null;
  }

  // 搜索配合比方案
  async search(keyword) {
    return await MixDesign.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.like]: `%${keyword}%` } },
          { projectName: { [Op.like]: `%${keyword}%` } },
          { strength: { [Op.like]: `%${keyword}%` } }
        ]
      }
    });
  }
}

module.exports = new MixDesignRepository();
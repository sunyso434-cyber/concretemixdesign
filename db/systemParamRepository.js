// 系统参数数据访问层
const { SystemParam, Op } = require('../models');

class SystemParamRepository {
  // 创建系统参数
  async create(data) {
    return await SystemParam.create(data);
  }

  // 根据ID获取系统参数
  async getById(id) {
    return await SystemParam.findByPk(id);
  }

  // 根据参数名称获取系统参数
  async getByParamName(paramName) {
    return await SystemParam.findOne({ where: { paramName } });
  }

  // 获取所有系统参数
  async getAll() {
    return await SystemParam.findAll();
  }

  // 根据参数类型获取系统参数
  async getByParamType(paramType) {
    return await SystemParam.findAll({ where: { paramType } });
  }

  // 更新系统参数
  async update(id, data) {
    const systemParam = await SystemParam.findByPk(id);
    if (systemParam) {
      return await systemParam.update(data);
    }
    return null;
  }

  // 根据参数名称更新系统参数
  async updateByParamName(paramName, data) {
    const systemParam = await SystemParam.findOne({ where: { paramName } });
    if (systemParam) {
      return await systemParam.update(data);
    }
    return null;
  }

  // 删除系统参数
  async delete(id) {
    const systemParam = await SystemParam.findByPk(id);
    if (systemParam) {
      return await systemParam.destroy();
    }
    return null;
  }

  // 搜索系统参数
  async search(keyword) {
    return await SystemParam.findAll({
      where: {
        [Op.or]: [
          { paramName: { [Op.like]: `%${keyword}%` } },
          { paramValue: { [Op.like]: `%${keyword}%` } },
          { description: { [Op.like]: `%${keyword}%` } }
        ]
      }
    });
  }
}

module.exports = new SystemParamRepository();
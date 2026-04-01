// 用户数据访问层
const { User, Op } = require('../models');

class UserRepository {
  // 创建用户
  async create(data) {
    return await User.create(data);
  }

  // 根据ID获取用户
  async getById(id) {
    return await User.findByPk(id);
  }

  // 根据用户名获取用户
  async getByUsername(username) {
    return await User.findOne({ where: { username } });
  }

  // 获取所有用户
  async getAll() {
    return await User.findAll();
  }

  // 更新用户
  async update(id, data) {
    const user = await User.findByPk(id);
    if (user) {
      return await user.update(data);
    }
    return null;
  }

  // 删除用户
  async delete(id) {
    const user = await User.findByPk(id);
    if (user) {
      return await user.destroy();
    }
    return null;
  }

  // 搜索用户
  async search(keyword) {
    return await User.findAll({
      where: {
        [Op.or]: [
          { username: { [Op.like]: `%${keyword}%` } },
          { name: { [Op.like]: `%${keyword}%` } },
          { email: { [Op.like]: `%${keyword}%` } }
        ]
      }
    });
  }

  // 更新用户最后登录时间
  async updateLastLogin(id) {
    const user = await User.findByPk(id);
    if (user) {
      return await user.update({ lastLoginAt: new Date() });
    }
    return null;
  }
}

module.exports = new UserRepository();
// 使用与Electron应用相同的数据库连接
const { sequelize } = require('../../src/main/db/database');
const MixDesign = require('../../src/main/db/models/MixDesign');
const Material = require('../../src/main/db/models/Material');
const SystemParam = require('../../src/main/db/models/SystemParam');


async function testDatabase() {
  try {
    console.log('连接数据库...');
    await sequelize.authenticate();
    console.log('数据库连接成功');
    
    console.log('同步数据库表结构...');
    await sequelize.sync({ alter: true });
    console.log('数据库表结构同步完成');
    
    console.log('查询所有配合比方案...');
    const mixDesigns = await MixDesign.findAll();
    console.log('找到', mixDesigns.length, '个配合比方案');
    
    if (mixDesigns.length > 0) {
      console.log('第一个方案:', JSON.stringify(mixDesigns[0], null, 2));
    } else {
      console.log('没有找到配合比方案');
    }
    
    console.log('测试完成');
  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await sequelize.close();
  }
}

testDatabase();
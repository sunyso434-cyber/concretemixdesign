// 数据库初始化脚本
const db = require('../models');
const { userRepository, systemParamRepository } = require('./');

async function initDatabase() {
  try {
    // 初始化默认用户
    const adminUser = await userRepository.getByUsername('admin');
    if (!adminUser) {
      await userRepository.create({
        username: 'admin',
        password: 'admin123', // 实际项目中应该加密存储
        name: '管理员',
        role: 'admin',
        permissions: ['all'],
        status: '正常'
      });
      console.log('默认管理员用户创建成功');
    }

    // 初始化常用系统参数
    const defaultParams = [
      {
        paramName: 'commonStrengthGrades',
        paramValue: JSON.stringify(['C15', 'C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50']),
        paramType: 'concrete',
        description: '常用混凝土强度等级'
      },
      {
        paramName: 'defaultSlump',
        paramValue: '100',
        paramType: 'concrete',
        description: '默认坍落度 (mm)'
      },
      {
        paramName: 'defaultEnvironmentClass',
        paramValue: '一类',
        paramType: 'concrete',
        description: '默认环境类别'
      },
      {
        paramName: 'concreteUnitWeight',
        paramValue: '2400',
        paramType: 'concrete',
        description: '混凝土容重 (kg/m³)'
      }
    ];

    for (const param of defaultParams) {
      const existingParam = await systemParamRepository.getByParamName(param.paramName);
      if (!existingParam) {
        await systemParamRepository.create(param);
        console.log(`系统参数 ${param.paramName} 创建成功`);
      }
    }

    console.log('数据库初始化完成');
  } catch (error) {
    console.error('数据库初始化失败:', error);
  } finally {
    // 关闭数据库连接
    await db.sequelize.close();
  }
}

// 执行初始化
initDatabase();
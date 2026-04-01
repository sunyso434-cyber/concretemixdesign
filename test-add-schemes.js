const { sequelize } = require('./src/main/db/database')
const MixDesign = require('./src/main/db/models/MixDesign')

async function addTestSchemes() {
  try {
    console.log('开始添加测试方案...')
    
    // 连接数据库
    await sequelize.authenticate()
    console.log('数据库连接成功')
    
    // 同步表结构
    await sequelize.sync({ alter: true })
    console.log('表结构同步完成')
    
    // 测试方案数据
    const testSchemes = [
      {
        name: '测试方案1',
        projectName: '测试项目1',
        description: '这是一个测试方案',
        strength: 'C30',
        slump: 80,
        environment: '1',
        waterRatio: 0.45,
        sandRatio: 0.35,
        density: 2400,
        materials: {
          cement: 300,
          flyAsh: 60,
          slag: 30,
          sand: 750,
          stone: 1100,
          water: 160,
          superplasticizer: 4.5
        },
        materialDetails: {
          cement: {
            name: 'P·O 42.5R水泥',
            specification: '42.5R',
            manufacturer: '都江堰拉法基水泥有限公司'
          },
          flyAsh: {
            name: 'I级粉煤灰',
            specification: 'I级',
            manufacturer: '内江聚达创环保新材料有限公司'
          },
          slag: {
            name: 'S95矿渣粉',
            specification: 'S95',
            manufacturer: '四川攀钢集团'
          },
          sand: {
            name: '机制砂',
            specification: '中砂',
            manufacturer: '汶川'
          },
          stone: {
            name: '碎石',
            specification: '5-25mm',
            manufacturer: '汶川'
          },
          superplasticizer: {
            name: '聚羧酸减水剂（标准型）',
            specification: 'SSS-标准型',
            manufacturer: '四川同升化工科技有限公司'
          }
        },
        materialCosts: {
          cement: 144.00,
          flyAsh: 10.80,
          slag: 6.60,
          sand: 112.50,
          stone: 132.00,
          superplasticizer: 15.75
        },
        totalCost: 421.65,
        status: '未验证'
      },
      {
        name: '测试方案2',
        projectName: '测试项目2',
        description: '这是另一个测试方案',
        strength: 'C40',
        slump: 100,
        environment: '2a',
        waterRatio: 0.40,
        sandRatio: 0.32,
        density: 2420,
        materials: {
          cement: 360,
          flyAsh: 40,
          slag: 40,
          sand: 720,
          stone: 1140,
          water: 160,
          superplasticizer: 5.4
        },
        materialDetails: {
          cement: {
            name: 'P·II 52.5R水泥',
            specification: '52.5R',
            manufacturer: '四川峨胜水泥集团股份有限公司'
          },
          flyAsh: {
            name: 'II级粉煤灰',
            specification: 'II级',
            manufacturer: '成都华西绿舍环保科技有限公司'
          },
          slag: {
            name: 'S105矿渣粉',
            specification: 'S105',
            manufacturer: '昆明钢铁集团'
          },
          sand: {
            name: '河砂',
            specification: '细砂',
            manufacturer: '乐山'
          },
          stone: {
            name: '卵石',
            specification: '5-20mm',
            manufacturer: '绵阳'
          },
          superplasticizer: {
            name: '聚羧酸减水剂（缓凝型）',
            specification: 'SSS-缓凝型',
            manufacturer: '四川同升化工科技有限公司'
          }
        },
        materialCosts: {
          cement: 208.80,
          flyAsh: 4.80,
          slag: 10.40,
          sand: 129.60,
          stone: 114.00,
          superplasticizer: 20.52
        },
        totalCost: 488.12,
        status: '已验证'
      }
    ]
    
    // 添加测试方案
    for (const scheme of testSchemes) {
      await MixDesign.create(scheme)
      console.log(`添加测试方案: ${scheme.name}`)
    }
    
    // 确认添加结果
    const allSchemes = await MixDesign.findAll()
    console.log(`添加完成，共 ${allSchemes.length} 个方案记录`)
    
    // 关闭数据库连接
    await sequelize.close()
    console.log('数据库连接已关闭')
    
  } catch (error) {
    console.error('添加测试方案失败:', error)
    process.exit(1)
  }
}

// 执行添加
addTestSchemes()

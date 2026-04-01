const { sequelize } = require('./src/main/db/database')
const MixDesign = require('./src/main/db/models/MixDesign')

async function checkDatabase() {
  try {
    console.log('开始检查数据库...')
    
    // 连接数据库
    await sequelize.authenticate()
    console.log('数据库连接成功')
    
    // 同步表结构
    await sequelize.sync({ alter: true })
    console.log('表结构同步完成')
    
    // 查找所有方案
    const allSchemes = await MixDesign.findAll()
    console.log(`找到 ${allSchemes.length} 个方案记录`)
    
    // 检查每个方案的详细信息
    for (const scheme of allSchemes) {
      console.log(`\n方案 ${scheme.id}: ${scheme.name}`)
      console.log(`- 原材料信息: ${scheme.materialDetails ? '存在' : '不存在'}`)
      console.log(`- 成本信息: ${scheme.materialCosts ? '存在' : '不存在'}`)
      console.log(`- 总成本: ${scheme.totalCost ? scheme.totalCost : '不存在'}`)
      
      if (scheme.materialDetails) {
        console.log(`  原材料详情: ${Object.keys(scheme.materialDetails).join(', ')}`)
      }
      
      if (scheme.materialCosts) {
        console.log(`  成本详情: ${Object.keys(scheme.materialCosts).join(', ')}`)
      }
    }
    
    // 关闭数据库连接
    await sequelize.close()
    console.log('\n数据库连接已关闭')
    
  } catch (error) {
    console.error('检查数据库失败:', error)
    process.exit(1)
  }
}

// 执行检查
checkDatabase()

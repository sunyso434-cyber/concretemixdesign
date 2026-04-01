const { sequelize } = require('./src/main/db/database')
const MixDesign = require('./src/main/db/models/MixDesign')

async function cleanupDatabase() {
  try {
    console.log('开始清理数据库...')
    
    // 连接数据库
    await sequelize.authenticate()
    console.log('数据库连接成功')
    
    // 同步表结构
    await sequelize.sync({ alter: true })
    console.log('表结构同步完成')
    
    // 查找所有方案
    const allSchemes = await MixDesign.findAll()
    console.log(`找到 ${allSchemes.length} 个方案记录`)
    
    // 检查每个方案是否有效
    let invalidCount = 0
    for (const scheme of allSchemes) {
      const isValid = scheme.name && scheme.strength && scheme.slump && scheme.environment
      if (!isValid) {
        console.log(`发现无效方案记录，ID: ${scheme.id}`)
        await scheme.destroy()
        invalidCount++
      }
    }
    
    console.log(`清理完成，删除了 ${invalidCount} 个无效方案记录`)
    
    // 再次查询，确认清理结果
    const remainingSchemes = await MixDesign.findAll()
    console.log(`清理后剩余 ${remainingSchemes.length} 个方案记录`)
    
    // 关闭数据库连接
    await sequelize.close()
    console.log('数据库连接已关闭')
    
  } catch (error) {
    console.error('清理数据库失败:', error)
    process.exit(1)
  }
}

// 执行清理
cleanupDatabase()

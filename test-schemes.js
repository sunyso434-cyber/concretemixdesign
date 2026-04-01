const MixDesign = require('./src/main/db/models/MixDesign')
const { sequelize } = require('./src/main/db/database')

async function testSchemes() {
  try {
    console.log('开始测试数据库连接...')
    
    // 测试数据库连接
    await sequelize.authenticate()
    console.log('数据库连接成功')
    
    // 测试获取所有方案
    console.log('\n测试获取所有方案...')
    const schemes = await MixDesign.findAll()
    console.log(`获取到 ${schemes.length} 个方案`)
    
    if (schemes.length > 0) {
      console.log('\n方案详情:')
      schemes.forEach((scheme, index) => {
        console.log(`方案 ${index + 1}:`)
        console.log(`  ID: ${scheme.id}`)
        console.log(`  名称: ${scheme.name}`)
        console.log(`  强度等级: ${scheme.strength}`)
        console.log(`  坍落度: ${scheme.slump}`)
        console.log(`  创建时间: ${scheme.createdAt}`)
        console.log('---')
      })
    } else {
      console.log('没有找到任何方案')
    }
    
    // 测试创建一个测试方案
    console.log('\n测试创建测试方案...')
    const testScheme = await MixDesign.create({
      name: '测试方案',
      projectName: '测试项目',
      strength: 'C30',
      slump: 80,
      environment: '一般环境',
      waterRatio: 0.45,
      sandRatio: 0.4,
      density: 2400,
      materials: {
        cement: 300,
        flyAsh: 50,
        sand: 750,
        stone: 1050,
        water: 160,
        superplasticizer: 6
      },
      status: '未验证'
    })
    console.log(`创建测试方案成功，ID: ${testScheme.id}`)
    
    // 再次获取所有方案，验证新方案是否创建成功
    console.log('\n再次获取所有方案...')
    const updatedSchemes = await MixDesign.findAll()
    console.log(`现在有 ${updatedSchemes.length} 个方案`)
    
    console.log('\n测试完成')
    
  } catch (error) {
    console.error('测试过程中出错:', error)
  } finally {
    await sequelize.close()
  }
}

testSchemes()

const MixDesign = require('../../src/main/db/models/MixDesign')
const { sequelize } = require('../../src/main/db/database')

async function testSchemeDetails() {
  try {
    console.log('开始测试方案详情...')
    
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
        console.log(`  水胶比: ${scheme.waterRatio}`)
        console.log(`  砂率: ${scheme.sandRatio}`)
        console.log(`  容重: ${scheme.density}`)
        console.log(`  总成本: ${scheme.totalCost}`)
        console.log(`  有原材料信息: ${!!scheme.materialDetails}`)
        console.log(`  有成本信息: ${!!scheme.materialCosts}`)
        
        if (scheme.materialDetails) {
          console.log(`  原材料信息: ${Object.keys(scheme.materialDetails).join(', ')}`)
        }
        
        if (scheme.materialCosts) {
          console.log(`  成本信息: ${Object.keys(scheme.materialCosts).join(', ')}`)
        }
        
        console.log('---')
      })
    } else {
      console.log('没有找到任何方案')
    }
    
    console.log('\n测试完成')
    
  } catch (error) {
    console.error('测试过程中出错:', error)
  } finally {
    await sequelize.close()
  }
}

testSchemeDetails()

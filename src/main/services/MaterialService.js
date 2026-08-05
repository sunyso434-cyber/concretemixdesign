const Material = require('../db/models/Material')

// 惰性 require blueprint-loader 的 invalidateMaterialsCache，避免模块加载阶段引入 require 环
function _invalidateMaterialsCache() {
  try {
    require('../skills/blueprint-loader').invalidateMaterialsCache()
  } catch (error) {
    // 缓存失效失败不阻塞材料写操作
    console.error('[MaterialService] 失效材料缓存失败:', error.message)
  }
}

class MaterialService {
  /**
   * 清理材料输出：移除 null/undefined/NaN 字段。
   */
  _cleanMaterial(obj) {
    const cleaned = {}
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue
      if (typeof value === 'number' && !Number.isFinite(value)) continue
      cleaned[key] = value
    }
    if (!('id' in cleaned)) cleaned.id = obj.id
    if (!('name' in cleaned)) cleaned.name = obj.name
    if (!('type' in cleaned)) cleaned.type = obj.type
    return cleaned
  }

  // 获取所有原材料
  async getAllMaterials() {
    try {
      const materials = await Material.findAll()
      console.log('从数据库获取到的材料数量:', materials.length)
      return materials.map(m => this._cleanMaterial(m.toJSON()))
    } catch (error) {
      console.error('获取原材料列表失败:', error)
      throw error
    }
  }

  // 根据ID获取原材料
  async getMaterialById(id) {
    try {
      const material = await Material.findByPk(id)
      return material ? this._cleanMaterial(material.toJSON()) : null
    } catch (error) {
      console.error('获取原材料详情失败:', error)
      throw error
    }
  }

  // 创建原材料
  async createMaterial(data) {
    try {
      const material = await Material.create(data)
      _invalidateMaterialsCache()
      return this._cleanMaterial(material.toJSON())
    } catch (error) {
      console.error('创建原材料失败:', error)
      throw error
    }
  }

  // 更新原材料
  async updateMaterial(id, data) {
    try {
      const material = await Material.findByPk(id)
      if (!material) {
        throw new Error('原材料不存在')
      }
      const updatedMaterial = await material.update(data)
      _invalidateMaterialsCache()
      return this._cleanMaterial(updatedMaterial.toJSON())
    } catch (error) {
      console.error('更新原材料失败:', error)
      throw error
    }
  }

  // 删除原材料
  async deleteMaterial(id) {
    try {
      const material = await Material.findByPk(id)
      if (!material) {
        throw new Error('原材料不存在')
      }
      const result = await material.destroy()
      _invalidateMaterialsCache()
      return result
    } catch (error) {
      console.error('删除原材料失败:', error)
      throw error
    }
  }

  // 根据类型获取原材料
  async getMaterialsByType(type) {
    try {
      const materials = await Material.findAll({ where: { type } })
      return materials.map(m => this._cleanMaterial(m.toJSON()))
    } catch (error) {
      console.error('根据类型获取原材料失败:', error)
      throw error
    }
  }

  // 根据名称匹配原材料
  // type: 材料类型 (如 '水泥', '粉煤灰', '细骨料' 等)
  // name: 材料名称 (可能是不完整的名称)
  async matchMaterialByName(type, name) {
    if (!name || !type) {
      return null
    }

    try {
      // 先尝试精确匹配
      let material = await Material.findOne({ where: { type, name } })
      if (material) {
        return this._cleanMaterial(material.toJSON())
      }

      // 尝试模糊匹配 (名称包含)
      const materials = await Material.findAll({
        where: {
          type,
          name: {
            [require('sequelize').Op.like]: `%${name}%`
          }
        }
      })

      if (materials.length > 0) {
        // 返回第一个匹配的结果
        return this._cleanMaterial(materials[0].toJSON())
      }

      // 尝试反向模糊匹配 (传入的名称包含数据库中的名称)
      const allMaterials = await Material.findAll({ where: { type } })
      const matched = allMaterials.find(m => name.includes(m.name))
      if (matched) {
        return this._cleanMaterial(matched.toJSON())
      }

      return null
    } catch (error) {
      console.error('根据名称匹配原材料失败:', error)
      throw error
    }
  }

  // 初始化预设材料
  async initDefaultMaterials() {
    try {
      // 检查是否已完成初始化（避免每次启动都重复添加）
      const SystemParam = require('../db/models/SystemParam')
      const initialized = await SystemParam.findOne({ where: { paramName: 'materialsInitialized' } })
      if (initialized) {
        console.log('预设材料已初始化，跳过')
        return
      }

      console.log('开始初始化预设材料...')

      const defaultMaterials = [
        // 水泥 - 2条
        {
          name: 'P·O 42.5R水泥',
          type: '水泥',
          specification: '42.5R',
          manufacturer: '都江堰拉法基水泥有限公司',
          price: 480,
          density: 3.10,
          fineness: 350,
          specificSurfaceArea: 360,
          standardConsistency: 26.5,
          initialSettingTime: 165,
          finalSettingTime: 220,
          flexuralStrength3d: 5.5,
          flexuralStrength28d: 8.5,
          compressiveStrength3d: 28.0,
          compressiveStrength28d: 48.0,
          status: '正常',
          isSystem: true
        },
        {
          name: 'P·II 52.5R水泥',
          type: '水泥',
          specification: '52.5R',
          manufacturer: '四川峨胜水泥集团股份有限公司',
          price: 580,
          density: 3.15,
          fineness: 380,
          specificSurfaceArea: 380,
          standardConsistency: 27.0,
          initialSettingTime: 150,
          finalSettingTime: 200,
          flexuralStrength3d: 6.0,
          flexuralStrength28d: 9.0,
          compressiveStrength3d: 32.0,
          compressiveStrength28d: 55.0,
          status: '正常',
          isSystem: true
        },
        // 粉煤灰 - 2条
        {
          name: 'I级粉煤灰',
          type: '粉煤灰',
          specification: 'I级',
          manufacturer: '内江聚达创环保新材料有限公司',
          price: 180,
          density: 2.20,
          fineness: 400,
          waterDemandRatio: 92,
          lossOnIgnition: 2.5,
          activityIndex28d: 88,
          status: '正常',
          isSystem: true
        },
        {
          name: 'II级粉煤灰',
          type: '粉煤灰',
          specification: 'II级',
          manufacturer: '成都华西绿舍环保科技有限公司',
          price: 120,
          density: 2.30,
          fineness: 320,
          waterDemandRatio: 98,
          lossOnIgnition: 4.5,
          activityIndex28d: 78,
          status: '正常',
          isSystem: true
        },
        // 矿渣粉 - 2条
        {
          name: 'S95矿渣粉',
          type: '矿渣粉',
          specification: 'S95',
          manufacturer: '四川攀钢集团',
          price: 220,
          density: 2.90,
          specificSurfaceArea: 420,
          fluidityRatio: 98,
          lossOnIgnition: 0.8,
          activityIndex7d: 75,
          activityIndex28d: 98,
          status: '正常',
          isSystem: true
        },
        {
          name: 'S105矿渣粉',
          type: '矿渣粉',
          specification: 'S105',
          manufacturer: '昆明钢铁集团',
          price: 260,
          density: 2.88,
          specificSurfaceArea: 480,
          fluidityRatio: 102,
          lossOnIgnition: 0.5,
          activityIndex7d: 82,
          activityIndex28d: 105,
          status: '正常',
          isSystem: true
        },
        // 细骨料 - 2条
        {
          name: '机制砂',
          type: '细骨料',
          specification: '中砂',
          manufacturer: '汶川',
          price: 150,
          density: 2.65,
          waterContent: 3.0,
          mudContent: 1.2,
          clayLumpContent: 0.3,
          sieve_4_75: 0,
          sieve_2_36: 18,
          sieve_1_18: 38,
          sieve_0_60: 62,
          sieve_0_30: 82,
          sieve_0_15: 97,
          mbValue: 0.6,
          finenessModulus: 2.8,
          status: '正常',
          isSystem: true
        },
        {
          name: '河砂',
          type: '细骨料',
          specification: '细砂',
          manufacturer: '乐山',
          price: 180,
          density: 2.62,
          waterContent: 4.5,
          mudContent: 0.8,
          clayLumpContent: 0.2,
          sieve_4_75: 0,
          sieve_2_36: 5,
          sieve_1_18: 20,
          sieve_0_60: 45,
          sieve_0_30: 70,
          sieve_0_15: 88,
          mbValue: 0.4,
          finenessModulus: 2.3,
          status: '正常',
          isSystem: true
        },
        // 粗骨料 - 2条
        {
          name: '碎石',
          type: '粗骨料',
          specification: '5-25mm',
          manufacturer: '汶川',
          price: 120,
          density: 2.70,
          waterContent: 0.5,
          mudContent: 0.8,
          clayLumpContent: 0.2,
          needleFlakeContent: 4.5,
          crushingValue: 12.0,
          sieve_37_5: 0,
          sieve_31_5: 0,
          sieve_26_5: 5,
          sieve_19_0: 35,
          sieve_16_0: 50,
          sieve_9_50: 78,
          sieve_4_75: 98,
          sieve_2_36: 98,
          grading: '5-25',
          status: '正常',
          isSystem: true
        },
        {
          name: '卵石',
          type: '粗骨料',
          specification: '5-20mm',
          manufacturer: '绵阳',
          price: 100,
          density: 2.68,
          waterContent: 0.8,
          mudContent: 0.5,
          clayLumpContent: 0.1,
          needleFlakeContent: 2.0,
          crushingValue: 8.5,
          sieve_37_5: 0,
          sieve_31_5: 0,
          sieve_26_5: 0,
          sieve_19_0: 5,
          sieve_16_0: 25,
          sieve_9_50: 60,
          sieve_4_75: 95,
          sieve_2_36: 98,
          grading: '5-20',
          status: '正常',
          isSystem: true
        },
        // 外加剂 - 2条
        {
          name: '聚羧酸减水剂（标准型）',
          type: '外加剂',
          specification: 'SSS-标准型',
          manufacturer: '四川同升化工科技有限公司',
          price: 3500,
          density: 1.05,
          solidContent: 20.0,
          waterReducingRate: 25.0,
          airContent: 3.5,
          recommendedDosage: 1.5,
          status: '正常',
          isSystem: true
        },
        {
          name: '聚羧酸减水剂（缓凝型）',
          type: '外加剂',
          specification: 'SSS-缓凝型',
          manufacturer: '四川同升化工科技有限公司',
          price: 3800,
          density: 1.08,
          solidContent: 22.0,
          waterReducingRate: 28.0,
          airContent: 2.8,
          recommendedDosage: 1.8,
          status: '正常',
          isSystem: true
        }
      ]

      console.log('预设材料列表数量:', defaultMaterials.length)

      // 遍历所有预设材料
      for (const material of defaultMaterials) {
        console.log(`正在处理材料: ${material.name} (类型: ${material.type})`)
        // 查找已存在的同名材料
        const existing = await Material.findOne({ where: { name: material.name } })
        if (!existing) {
          // 如果材料不存在，创建它
          await Material.create(material)
          console.log(`创建预设材料: ${material.name}`)
        } else {
          // 如果材料已存在，跳过更新，保留用户的修改
          console.log(`材料 ${material.name} 已存在，跳过更新`)
        }
      }
      _invalidateMaterialsCache()

      // 验证所有材料是否创建成功
      const allMaterials = await Material.findAll()
      console.log('数据库中材料总数:', allMaterials.length)
      console.log('材料列表:', allMaterials.map(m => ({ id: m.id, name: m.name, type: m.type })))

      // 标记初始化完成（避免每次启动重复添加）
      await SystemParam.findOrCreate({
        where: { paramName: 'materialsInitialized' },
        defaults: { paramName: 'materialsInitialized', paramValue: 'true', description: '原材料预设数据初始化标记' }
      })

      console.log('预设材料初始化完成')
    } catch (error) {
      console.error('初始化预设材料失败:', error)
      throw error
    }
  }
}

module.exports = new MaterialService()

// 浏览器开发环境的模拟数据（Electron 环境不加载本文件）
// 容器对象导出：IPC mock 层需要修改这些状态，export let 会有值拷贝陷阱
export const mockDB = {
  schemes: [

    {
      id: 1,
      name: '测试方案1',
      projectName: '测试项目1',
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
      status: '未验证',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 2,
      name: '测试方案2',
      projectName: '测试项目2',
      strength: 'C40',
      slump: 100,
      environment: '一般环境',
      waterRatio: 0.4,
      sandRatio: 0.38,
      density: 2420,
      materials: {
        cement: 350,
        flyAsh: 40,
        sand: 720,
        stone: 1080,
        water: 150,
        superplasticizer: 7
      },
      status: '已验证',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  nextSchemeId: 3,
  materials: [

    {
      id: 1,
      name: 'P·O 42.5R水泥',
      type: '水泥',
      specification: '42.5R',
      manufacturer: '都江堰拉法基水泥有限公司',
      density: 3.10,
      fineness: 350,
      compressiveStrength28d: 48.0,
      price: 450,
      status: '正常'
    },
    {
      id: 2,
      name: 'P·II 52.5R水泥',
      type: '水泥',
      specification: '52.5R',
      manufacturer: '四川峨胜水泥集团股份有限公司',
      density: 3.15,
      fineness: 380,
      compressiveStrength28d: 58.0,
      price: 520,
      status: '正常'
    },
    {
      id: 3,
      name: 'I级粉煤灰',
      type: '粉煤灰',
      specification: 'I级',
      manufacturer: '内江聚达创环保新材料有限公司',
      density: 2.20,
      fineness: 400,
      influenceFactor_10: 1.0,
      influenceFactor_20: 1.0,
      influenceFactor_30: 1.05,
      influenceFactor_40: 1.1,
      influenceFactor_50: 1.15,
      price: 180,
      status: '正常'
    },
    {
      id: 4,
      name: 'II级粉煤灰',
      type: '粉煤灰',
      specification: 'II级',
      manufacturer: '成都华西绿舍环保科技有限公司',
      density: 2.30,
      fineness: 320,
      influenceFactor_10: 1.0,
      influenceFactor_20: 1.0,
      influenceFactor_30: 1.08,
      influenceFactor_40: 1.12,
      influenceFactor_50: 1.18,
      price: 150,
      status: '正常'
    },
    {
      id: 5,
      name: 'S95矿渣粉',
      type: '矿渣粉',
      specification: 'S95',
      manufacturer: '四川攀钢集团',
      density: 2.90,
      fineness: 420,
      price: 220,
      status: '正常'
    },
    {
      id: 6,
      name: 'S105矿渣粉',
      type: '矿渣粉',
      specification: 'S105',
      manufacturer: '昆明钢铁集团',
      density: 2.88,
      fineness: 480,
      price: 250,
      status: '正常'
    },
    {
      id: 7,
      name: '机制砂',
      type: '细骨料',
      specification: '中砂',
      manufacturer: '汶川',
      density: 2.65,
      mbValue: 0.5,
      finenessModulus: 2.7,
      price: 120,
      status: '正常'
    },
    {
      id: 8,
      name: '河砂',
      type: '细骨料',
      specification: '细砂',
      manufacturer: '乐山',
      density: 2.62,
      mbValue: 0.3,
      finenessModulus: 2.4,
      price: 150,
      status: '正常'
    },
    {
      id: 9,
      name: '碎石',
      type: '粗骨料',
      specification: '5-25mm',
      manufacturer: '汶川',
      density: 2.70,
      fineness: null,
      price: 100,
      status: '正常'
    },
    {
      id: 10,
      name: '卵石',
      type: '粗骨料',
      specification: '5-20mm',
      manufacturer: '绵阳',
      density: 2.68,
      fineness: null,
      price: 90,
      status: '正常'
    },
    {
      id: 11,
      name: '聚羧酸减水剂（标准型）',
      type: '外加剂',
      specification: 'SSS-标准型',
      manufacturer: '四川同升化工科技有限公司',
      density: 1.05,
      solidContent: 20.0,
      waterReducingRate: 25.0,
      recommendedDosage: 1.5,
      waterReducingRatePer01Dosage: 2.0,
      price: 2500,
      status: '正常'
    },
    {
      id: 12,
      name: '聚羧酸减水剂（缓凝型）',
      type: '外加剂',
      specification: 'SSS-缓凝型',
      manufacturer: '四川同升化工科技有限公司',
      density: 1.08,
      solidContent: 22.0,
      waterReducingRate: 28.0,
      recommendedDosage: 1.8,
      waterReducingRatePer01Dosage: 2.0,
      price: 2800,
      status: '正常'
    }
  ],
  nextId: 13
}

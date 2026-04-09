/**
 * TemplateService - Template configuration definition service
 * Manages field definitions for materials and mix design templates
 */

const COMMON_FIELDS = [
  { name: '名称', english: 'name', type: 'string', required: true, desc: '材料名称' },
  { name: '类型', english: 'type', type: 'string', required: true, desc: '自动填充', autoFill: true },
  { name: '规格', english: 'specification', type: 'string', desc: '如：P.O 42.5' },
  { name: '厂家', english: 'manufacturer', type: 'string', desc: '生产厂家' },
  { name: '单价', english: 'price', type: 'number', desc: '元/吨' },
  { name: '密度', english: 'density', type: 'number', desc: 'kg/m³' },
  { name: '含水率', english: 'waterContent', type: 'number', desc: '%' },
  { name: '状态', english: 'status', type: 'string', desc: '启用/禁用' },
  { name: '备注', english: 'notes', type: 'string', desc: '' },
]

const MATERIAL_CATEGORIES = {
  '01_水泥': {
    type: '水泥',
    english: 'cement',
    fields: [
      { name: '比表面积', english: 'specificSurfaceArea', type: 'number', desc: 'm²/kg' },
      { name: '标准稠度', english: 'standardConsistency', type: 'number', desc: '%' },
      { name: '安定性', english: 'stability', type: 'string', desc: '沸煮法' },
      { name: '初凝时间', english: 'initialSettingTime', type: 'number', desc: 'min' },
      { name: '终凝时间', english: 'finalSettingTime', type: 'number', desc: 'min' },
      { name: '3d抗折强度', english: 'flexuralStrength3d', type: 'number', desc: 'MPa' },
      { name: '28d抗折强度', english: 'flexuralStrength28d', type: 'number', desc: 'MPa' },
      { name: '3d抗压强度', english: 'compressiveStrength3d', type: 'number', desc: 'MPa' },
      { name: '28d抗压强度', english: 'compressiveStrength28d', type: 'number', desc: 'MPa' },
      { name: '细度', english: 'fineness', type: 'number', desc: '%' },
    ],
  },
  '02_粉煤灰': {
    type: '粉煤灰',
    english: 'flyAsh',
    fields: [
      { name: '需水量比', english: 'waterDemandRatio', type: 'number', desc: '%' },
      { name: '烧失量', english: 'lossOnIgnition', type: 'number', desc: '%' },
      { name: '7d活性指数', english: 'activityIndex7d', type: 'number', desc: '%' },
      { name: '28d活性指数', english: 'activityIndex28d', type: 'number', desc: '%' },
      { name: '细度', english: 'fineness', type: 'number', desc: '%' },
    ],
  },
  '03_矿渣粉': {
    type: '矿渣粉',
    english: 'slag',
    fields: [
      { name: '流动度比', english: 'fluidityRatio', type: 'number', desc: '%' },
      { name: '比表面积', english: 'specificSurfaceArea', type: 'number', desc: 'm²/kg' },
      { name: '7d活性指数', english: 'activityIndex7d', type: 'number', desc: '%' },
      { name: '28d活性指数', english: 'activityIndex28d', type: 'number', desc: '%' },
      { name: '细度', english: 'fineness', type: 'number', desc: '%' },
    ],
  },
  '04_细骨料': {
    type: '细骨料',
    english: 'fineAggregate',
    fields: [
      { name: '含泥量', english: 'mudContent', type: 'number', desc: '%' },
      { name: '泥块含量', english: 'clayLumpContent', type: 'number', desc: '%' },
      { name: 'MB值', english: 'mbValue', type: 'number', desc: '' },
      { name: '细度模数', english: 'finenessModulus', type: 'number', desc: '' },
      { name: '筛孔4.75', english: 'sieve_4_75', type: 'number', desc: '%' },
      { name: '筛孔2.36', english: 'sieve_2_36', type: 'number', desc: '%' },
      { name: '筛孔1.18', english: 'sieve_1_18', type: 'number', desc: '%' },
      { name: '筛孔0.6', english: 'sieve_0_6', type: 'number', desc: '%' },
      { name: '筛孔0.3', english: 'sieve_0_3', type: 'number', desc: '%' },
      { name: '筛孔0.15', english: 'sieve_0_15', type: 'number', desc: '%' },
    ],
  },
  '05_粗骨料': {
    type: '粗骨料',
    english: 'coarseAggregate',
    fields: [
      { name: '针片状含量', english: 'needleFlakeContent', type: 'number', desc: '%' },
      { name: '压碎值', english: 'crushingValue', type: 'number', desc: '%' },
      { name: '级配', english: 'grading', type: 'string', desc: '' },
      { name: '筛孔37.5', english: 'sieve_37_5', type: 'number', desc: '%' },
      { name: '筛孔31.5', english: 'sieve_31_5', type: 'number', desc: '%' },
      { name: '筛孔26.5', english: 'sieve_26_5', type: 'number', desc: '%' },
      { name: '筛孔19.0', english: 'sieve_19_0', type: 'number', desc: '%' },
      { name: '筛孔16.0', english: 'sieve_16_0', type: 'number', desc: '%' },
      { name: '筛孔9.50', english: 'sieve_9_50', type: 'number', desc: '%' },
    ],
  },
  '06_外加剂': {
    type: '外加剂',
    english: 'admixture',
    fields: [
      { name: '固体含量', english: 'solidContent', type: 'number', desc: '%' },
      { name: '减水率', english: 'waterReducingRate', type: 'number', desc: '%' },
      { name: '含气量', english: 'airContent', type: 'number', desc: '%' },
      { name: '推荐掺量', english: 'recommendedDosage', type: 'number', desc: '%' },
      { name: '每0.5%减水率', english: 'waterReducingRatePer01Dosage', type: 'number', desc: '%' },
      { name: '影响系数10', english: 'influenceFactor_10', type: 'number', desc: '' },
      { name: '影响系数20', english: 'influenceFactor_20', type: 'number', desc: '' },
      { name: '影响系数30', english: 'influenceFactor_30', type: 'number', desc: '' },
      { name: '影响系数40', english: 'influenceFactor_40', type: 'number', desc: '' },
      { name: '影响系数50', english: 'influenceFactor_50', type: 'number', desc: '' },
    ],
  },
  '07_水': {
    type: '水',
    english: 'water',
    fields: [
      { name: 'pH值', english: 'phValue', type: 'number', desc: '' },
      { name: '不溶物', english: 'insolubleMatter', type: 'number', desc: 'mg/L' },
      { name: '可溶物', english: 'solubleMatter', type: 'number', desc: 'mg/L' },
    ],
  },
}

const MIXDESIGN_SHEETS = {
  '配合比方案': {
    fields: [
      { name: '名称', english: 'name', type: 'string', required: true },
      { name: '工程名称', english: 'projectName', type: 'string' },
      { name: '说明', english: 'description', type: 'string' },
      { name: '强度等级', english: 'strength', type: 'string' },
      { name: '坍落度', english: 'slump', type: 'string' },
      { name: '环境', english: 'environment', type: 'string' },
      { name: '工程类型', english: 'projectType', type: 'string' },
      { name: '粉煤灰掺量', english: 'flyAshDosage', type: 'number' },
      { name: '矿渣粉掺量', english: 'slagDosage', type: 'number' },
      { name: '砂率', english: 'sandRatio', type: 'number' },
      { name: '水胶比', english: 'waterRatio', type: 'number' },
      { name: '密度', english: 'density', type: 'number' },
      { name: '总成本', english: 'totalCost', type: 'number' },
      { name: '状态', english: 'status', type: 'string' },
    ],
  },
  '材料用量': {
    fields: [
      { name: '配合比名称', english: 'mixDesignName', type: 'string', required: true },
      { name: '材料类型', english: 'materialType', type: 'string' },
      { name: '材料名称', english: 'materialName', type: 'string' },
      { name: '规格', english: 'specification', type: 'string' },
      { name: '厂家', english: 'manufacturer', type: 'string' },
      { name: '用量', english: 'amount', type: 'number' },
      { name: '单价', english: 'price', type: 'number' },
      { name: '成本', english: 'cost', type: 'number' },
    ],
  },
  '骨料分配': {
    fields: [
      { name: '配合比名称', english: 'mixDesignName', type: 'string', required: true },
      { name: '骨料类型', english: 'aggregateType', type: 'string' },
      { name: '材料名称', english: 'materialName', type: 'string' },
      { name: '规格', english: 'specification', type: 'string' },
      { name: '用量', english: 'amount', type: 'number' },
      { name: '比例', english: 'ratio', type: 'number' },
    ],
  },
  '计算参数': {
    fields: [
      { name: '配合比名称', english: 'mixDesignName', type: 'string', required: true },
      { name: '回归系数αa', english: 'regressionAlphaA', type: 'number' },
      { name: '回归系数αb', english: 'regressionAlphaB', type: 'number' },
      { name: '强度标准差', english: 'strengthStdDev', type: 'number' },
      { name: 'MB值影响', english: 'mbInfluence', type: 'number' },
      { name: '细度影响', english: 'finenessInfluence', type: 'number' },
      { name: '强度影响', english: 'strengthInfluence', type: 'number' },
      { name: '目标细度模数基准', english: 'targetFinenessModulusBase', type: 'number' },
    ],
  },
}

/**
 * Get all fields (common + category-specific) for a material category
 * @param {string} categoryKey - Category key like '01_水泥'
 * @returns {Array} Combined array of common and category-specific fields
 */
function getFieldsForCategory(categoryKey) {
  const category = MATERIAL_CATEGORIES[categoryKey]
  if (!category) {
    return null
  }
  return [...COMMON_FIELDS, ...category.fields]
}

/**
 * Get headers (Chinese / English) for a material category
 * @param {string} categoryKey - Category key like '01_水泥'
 * @returns {Array} Array of "中文 / english" header strings
 */
function getHeadersForCategory(categoryKey) {
  const fields = getFieldsForCategory(categoryKey)
  if (!fields) {
    return null
  }
  return fields.map(f => `${f.name} / ${f.english}`)
}

/**
 * Get material type from sheet name
 * @param {string} sheetName - Sheet name like '01_水泥'
 * @returns {string|null} Material type string or null if not found
 */
function getMaterialTypeFromSheetName(sheetName) {
  const category = MATERIAL_CATEGORIES[sheetName]
  return category ? category.type : null
}

/**
 * Convert Chinese field name to English key
 * @param {string} fieldName - Chinese field name
 * @returns {string|null} English key or null if not found
 */
function cnToEnglish(fieldName) {
  for (const categoryKey of Object.keys(MATERIAL_CATEGORIES)) {
    const category = MATERIAL_CATEGORIES[categoryKey]
    for (const field of [...COMMON_FIELDS, ...category.fields]) {
      if (field.name === fieldName) {
        return field.english
      }
    }
  }
  for (const sheetKey of Object.keys(MIXDESIGN_SHEETS)) {
    const sheet = MIXDESIGN_SHEETS[sheetKey]
    for (const field of sheet.fields) {
      if (field.name === fieldName) {
        return field.english
      }
    }
  }
  return null
}

/**
 * Convert English key to Chinese field name
 * @param {string} englishName - English field key
 * @returns {string|null} Chinese field name or null if not found
 */
function englishToCn(englishName) {
  for (const categoryKey of Object.keys(MATERIAL_CATEGORIES)) {
    const category = MATERIAL_CATEGORIES[categoryKey]
    for (const field of [...COMMON_FIELDS, ...category.fields]) {
      if (field.english === englishName) {
        return field.name
      }
    }
  }
  for (const sheetKey of Object.keys(MIXDESIGN_SHEETS)) {
    const sheet = MIXDESIGN_SHEETS[sheetKey]
    for (const field of sheet.fields) {
      if (field.english === englishName) {
        return field.name
      }
    }
  }
  return null
}

// generateMaterialTemplate - 生成原材料导入模板Excel
async function generateMaterialTemplate(filePath) {
  const XLSX = require('xlsx')
  const { getFieldsForCategory } = require('./TemplateService')

  const wb = XLSX.utils.book_new()

  // Sheet 1: 说明
  const descRows = [
    ['原材料导入模板 - 使用说明'],
    [''],
    ['1. 本模板用于批量导入原材料数据'],
    ['2. 每个Sheet对应一种材料类别，请按类别填写数据'],
    ['3. 表头格式：中文名称 / 英文名称，请勿修改'],
    ['4. 必填字段必须填写，非必填字段可留空'],
    ['5. 数值字段只填写数字，不要带单位'],
    ['6. 灰色背景行为示例数据，请删除后再填写'],
    [''],
    ['材料类别对照表：'],
    ['序号_Sheet名称', '材料类型', '说明'],
    ['01_水泥', '水泥', '硅酸盐水泥，普通硅酸盐水泥等'],
    ['02_粉煤灰', '粉煤灰', '粉煤灰材料'],
    ['03_矿渣粉', '矿渣粉', '粒化高炉矿渣粉'],
    ['04_细骨料', '细骨料', '砂材料'],
    ['05_粗骨料', '粗骨料', '碎石或卵石'],
    ['06_外加剂', '外加剂', '减水剂等'],
    ['07_水', '水', '混凝土拌合用水'],
  ]

  const wsDesc = XLSX.utils.aoa_to_sheet(descRows)
  wsDesc['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, wsDesc, '说明')

  // Sheets 2-8: 各材料类别
  const categoryOrder = ['01_水泥', '02_粉煤灰', '03_矿渣粉', '04_细骨料', '05_粗骨料', '06_外加剂', '07_水']

  for (const sheetName of categoryOrder) {
    const fields = getFieldsForCategory(sheetName)
    const headers = fields.map(f => `${f.name} / ${f.english}`)

    const exampleData = fields.map(f => {
      if (f.name === '名称') return '示例：PO42.5普通水泥'
      if (f.name === '类型') return '' // 自动填充
      if (f.name === '规格') return 'P.O 42.5'
      if (f.name === '单价') return '450'
      if (f.name === '密度') return '3100'
      return ''
    })

    const wsData = XLSX.utils.aoa_to_sheet([[...headers], exampleData])
    wsData['!cols'] = headers.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, wsData, sheetName)
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  await require('fs').promises.writeFile(filePath, buf)
  return filePath
}

// exportMaterialsToExcel - 导出原材料为多Sheet Excel
async function exportMaterialsToExcel(materials, filePath, onProgress) {
  const XLSX = require('xlsx')
  const { getFieldsForCategory, MATERIAL_CATEGORIES } = require('./TemplateService')

  // 按材料类型分组
  const grouped = {}
  for (const mat of materials) {
    const type = mat.type
    if (!grouped[type]) grouped[type] = []
    grouped[type].push(mat)
  }

  const wb = XLSX.utils.book_new()

  // Sheet 1: 汇总说明
  const summaryData = [
    ['原材料导出数据'],
    [`导出时间：${new Date().toLocaleString()}`],
    [`共 ${materials.length} 条记录`],
    [''],
    ['材料类型', '数量'],
  ]
  for (const [type, items] of Object.entries(grouped)) {
    summaryData.push([type, items.length.toString()])
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, '汇总')

  // 各材料类别Sheet
  const categoryOrder = ['01_水泥', '02_粉煤灰', '03_矿渣粉', '04_细骨料', '05_粗骨料', '06_外加剂', '07_水']

  for (const sheetName of categoryOrder) {
    const category = MATERIAL_CATEGORIES[sheetName]
    if (!category) continue

    const type = category.type
    const items = grouped[type]
    if (!items || items.length === 0) continue

    const fields = getFieldsForCategory(sheetName)
    const headers = fields.map(f => `${f.name} / ${f.english}`)

    // 构建数据行
    const dataRows = items.map(item => {
      return fields.map(f => {
        const value = item[f.english]
        if (value === undefined || value === null) return ''
        return value
      })
    })

    const wsData = XLSX.utils.aoa_to_sheet([[...headers], ...dataRows])
    wsData['!cols'] = headers.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, wsData, sheetName)

    onProgress && onProgress(50 + categoryOrder.indexOf(sheetName) * 7)
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  await require('fs').promises.writeFile(filePath, buf)
  return filePath
}

// generateMixDesignTemplate - 生成配合比导入模板Excel
async function generateMixDesignTemplate(filePath) {
  const XLSX = require('xlsx')
  const { MIXDESIGN_SHEETS } = require('./TemplateService')

  const wb = XLSX.utils.book_new()

  // Sheet 1: 说明
  const descRows = [
    ['配合比导入模板 - 使用说明'],
    [''],
    ['1. 本模板用于批量导入配合比数据'],
    ['2. Sheet2为配合比方案主数据，Sheet3-5为关联明细'],
    ['3. 表头格式：中文名称 / 英文名称，请勿修改'],
    ['4. 必填字段必须填写'],
    [''],
    ['Sheet说明：'],
    ['Sheet名称', '说明'],
    ['配合比方案', '配合比主数据，包含基本信息和计算结果'],
    ['材料用量', '各材料用量、单价、金额'],
    ['骨料分配', '细骨料/粗骨料详细分配'],
    ['计算参数', '高级计算参数设置'],
  ]

  const wsDesc = XLSX.utils.aoa_to_sheet(descRows)
  wsDesc['!cols'] = [{ wch: 20 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, wsDesc, '说明')

  // Sheets 2-5: 各配合比数据
  for (const [sheetName, config] of Object.entries(MIXDESIGN_SHEETS)) {
    const headers = config.fields.map(f => `${f.name} / ${f.english}`)
    const exampleRow = config.fields.map(f => {
      if (f.name === '名称') return '示例：C30普通混凝土'
      if (f.name === '强度等级') return 'C30'
      if (f.name === '坍落度') return '180'
      if (f.name === '环境') return '一般环境'
      return ''
    })

    const wsData = XLSX.utils.aoa_to_sheet([[...headers], exampleRow])
    wsData['!cols'] = headers.map(() => ({ wch: 22 }))
    XLSX.utils.book_append_sheet(wb, wsData, sheetName)
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  await require('fs').promises.writeFile(filePath, buf)
  return filePath
}

// exportMixDesignsToExcel - 导出配合比为多Sheet Excel
async function exportMixDesignsToExcel(mixDesigns, filePath, onProgress) {
  const XLSX = require('xlsx')
  const { MIXDESIGN_SHEETS } = require('./TemplateService')

  const wb = XLSX.utils.book_new()

  // Sheet 1: 汇总说明
  const summaryData = [
    ['配合比导出数据'],
    [`导出时间：${new Date().toLocaleString()}`],
    [`共 ${mixDesigns.length} 条记录`],
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 20 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, '汇总')

  // 准备各Sheet数据
  const sheet2Data = [] // 配合比方案
  const sheet3Data = [] // 材料用量
  const sheet4Data = [] // 骨料分配
  const sheet5Data = [] // 计算参数

  for (const md of mixDesigns) {
    // Sheet 2: 配合比方案
    const mainRow = {}
    const fields2 = MIXDESIGN_SHEETS['配合比方案'].fields
    for (const f of fields2) {
      mainRow[`${f.name} / ${f.english}`] = md[f.english] ?? ''
    }
    sheet2Data.push(mainRow)

    // Sheet 3: 材料用量 - 从 materialDetails 构建
    if (md.materialDetails) {
      const details = md.materialDetails
      for (const [matType, mat] of Object.entries(details)) {
        if (mat && typeof mat === 'object' && mat.name) {
          sheet3Data.push({
            '配合比名称 / mixDesignName': md.name,
            '材料类别 / materialType': matType,
            '材料名称 / materialName': mat.name || '',
            '规格 / specification': mat.specification || '',
            '厂家 / manufacturer': mat.manufacturer || '',
            '用量 / amount': mat.amount || '',
            '单价 / price': mat.price || '',
            '成本 / cost': '',
          })
        }
      }
    }

    // Sheet 4: 骨料分配
    if (md.fineAggregateBreakdown && Array.isArray(md.fineAggregateBreakdown)) {
      for (const agg of md.fineAggregateBreakdown) {
        sheet4Data.push({
          '配合比名称 / mixDesignName': md.name,
          '骨料类型 / aggregateType': '细骨料',
          '材料名称 / materialName': agg.name || '',
          '规格 / specification': agg.specification || '',
          '用量 / amount': agg.amount || '',
          '比例 / ratio': agg.ratio || '',
        })
      }
    }
    if (md.coarseAggregateBreakdown && Array.isArray(md.coarseAggregateBreakdown)) {
      for (const agg of md.coarseAggregateBreakdown) {
        sheet4Data.push({
          '配合比名称 / mixDesignName': md.name,
          '骨料类型 / aggregateType': '粗骨料',
          '材料名称 / materialName': agg.name || '',
          '规格 / specification': agg.specification || '',
          '用量 / amount': agg.amount || '',
          '比例 / ratio': agg.ratio || '',
        })
      }
    }

    // Sheet 5: 计算参数
    if (md.tempSettings) {
      const ts = md.tempSettings
      sheet5Data.push({
        '配合比名称 / mixDesignName': md.name,
        '回归系数α_a / regressionAlphaA': ts.regressionAlphaA || '',
        '回归系数α_b / regressionAlphaB': ts.regressionAlphaB || '',
        '强度标准差 / strengthStdDev': ts.strengthStdDev || '',
        'MB值影响 / mbInfluence': ts.mbInfluence || '',
        '细度影响 / finenessInfluence': ts.finenessInfluence || '',
        '强度影响 / strengthInfluence': ts.strengthInfluence || '',
        '目标细度模数基准 / targetFinenessModulusBase': ts.targetFinenessModulusBase || '',
      })
    }
  }

  // 生成各Sheet
  const ws2 = XLSX.utils.json_to_sheet(sheet2Data)
  XLSX.utils.book_append_sheet(wb, ws2, '配合比方案')

  const ws3 = XLSX.utils.json_to_sheet(sheet3Data)
  XLSX.utils.book_append_sheet(wb, ws3, '材料用量')

  const ws4 = XLSX.utils.json_to_sheet(sheet4Data)
  XLSX.utils.book_append_sheet(wb, ws4, '骨料分配')

  const ws5 = XLSX.utils.json_to_sheet(sheet5Data)
  XLSX.utils.book_append_sheet(wb, ws5, '计算参数')

  onProgress && onProgress(75)

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
  await require('fs').promises.writeFile(filePath, buf)
  return filePath
}

module.exports = {
  COMMON_FIELDS,
  MATERIAL_CATEGORIES,
  MIXDESIGN_SHEETS,
  getFieldsForCategory,
  getHeadersForCategory,
  getMaterialTypeFromSheetName,
  cnToEnglish,
  englishToCn,
  generateMaterialTemplate,
  exportMaterialsToExcel,
  generateMixDesignTemplate,
  exportMixDesignsToExcel,
}
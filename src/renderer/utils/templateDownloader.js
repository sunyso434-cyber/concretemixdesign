import * as XLSX from 'xlsx'

export const TEMPLATES = {
  analysis: {
    key: 'analysis',
    name: '配合比分析模板',
    description: '用于上传配合比数据进行分析，包含配合比数据和试验结果两个Sheet',
    sheets: ['配合比数据', '试验结果']
  },
  inverse: {
    key: 'inverse',
    name: '反算参数模板',
    description: '用于反算材料参数',
    sheets: ['参数数据']
  },
  import: {
    key: 'import',
    name: '数据导入模板',
    description: '用于批量导入材料数据',
    sheets: ['材料数据']
  }
}

export const downloadTemplate = (key) => {
  switch (key) {
    case 'analysis':
      downloadAnalysisTemplate()
      break
    case 'inverse':
      downloadInverseTemplate()
      break
    case 'import':
      downloadImportTemplate()
      break
    default:
      console.warn(`Unknown template key: ${key}`)
  }
}

export const downloadAnalysisTemplate = () => {
  const templateData = [
    {
      '编号': 'M001',
      '强度等级': 'C30',
      '用水量': 165,
      '水泥用量': 280,
      '粉煤灰用量': 60,
      '矿渣粉用量': 0,
      '复合粉用量': 0,
      '锂渣用量': 0,
      '砂1用量': 700,
      '砂2用量': 100,
      '碎石用量': 1050,
      '减水剂掺量': 1.8,
      '减水剂用量': 6.12,
      '水胶比': 0.49,
      '材料-水泥': 'P.O 42.5',
      '材料-粉煤灰': 'I级粉煤灰',
      '材料-矿渣粉': '',
      '材料-锂渣': '',
      '材料-复合粉': '',
      '材料-砂1': '河砂',
      '材料-砂2': '机制砂',
      '材料-碎石': '5-25mm',
      '材料-减水剂': '聚羧酸减水剂'
    }
  ]
  const testResultData = [
    {
      '编号': 'M001',
      '表观密度': 2380,
      '初始坍落度': 200,
      '初始扩展度': 500,
      '初始T500': 5,
      '1h坍落度': 190,
      '1h扩展度': 460,
      '1hT500': 6,
      '2h坍落度': 180,
      '2h扩展度': 420,
      '2hT500': 8,
      'R3强度': 25.5,
      'R7强度': 32.8,
      'R28强度': 42.5,
      'R60强度': 48.2
    }
  ]
  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.json_to_sheet(templateData)
  XLSX.utils.book_append_sheet(wb, ws1, '配合比数据')
  const ws2 = XLSX.utils.json_to_sheet(testResultData)
  XLSX.utils.book_append_sheet(wb, ws2, '试验结果')
  XLSX.writeFile(wb, '配合比分析模板.xlsx')
}

export const downloadInverseTemplate = () => {
  const templateData = [
    { '编号': '', '强度等级': '', '水胶比': '', '水泥用量': '', '粉煤灰用量': '', '矿渣粉用量': '', 'R28强度': '' }
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(templateData)
  XLSX.utils.book_append_sheet(wb, ws, '参数数据')
  XLSX.writeFile(wb, '反算参数模板.xlsx')
}

export const downloadImportTemplate = () => {
  const templateData = [
    { '材料类型': '', '材料名称': '', '规格': '', '厂商': '', '单价': '', '密度': '' }
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(templateData)
  XLSX.utils.book_append_sheet(wb, ws, '材料数据')
  XLSX.writeFile(wb, '数据导入模板.xlsx')
}

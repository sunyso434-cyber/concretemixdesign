/**
 * 生成配合比分析Excel模板
 * 使用: node scripts/generate-template.js
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// 配合比数据Sheet表头
const mixDesignHeaders = [
  '编号', '强度等级', '用水量', '水泥用量', '矿渣粉用量', '粉煤灰用量',
  '复合粉用量', '锂渣用量', '砂1用量', '砂2用量', '碎石用量',
  '减水剂掺量', '减水剂用量', '水胶比',
  '材料-水泥', '材料-粉煤灰', '材料-矿渣粉', '材料-砂1', '材料-砂2',
  '材料-碎石', '材料-减水剂'
];

// 试验结果Sheet表头
const testResultHeaders = [
  '编号', '表观密度', '初始坍落度', '初始扩展度', '初始T500',
  '1h坍落度', '1h扩展度', '1hT500', '2h坍落度', '2h扩展度', '2hT500',
  'R3强度', 'R7强度', 'R28强度', 'R60强度'
];

// 示例数据 - 配合比数据
const mixDesignSampleRow = [
  'C001', 'C30', '175', '180', '50', '60', '0', '0', '700', '100', '1050',
  '1.0', '4.85', '0.45',
  '0.45', '0.15', '0.13', '0.35', '0.05', '0.52', '0.012'
];

// 示例数据 - 试验结果
const testResultSampleRow = [
  'C001', '2380', '200', '550', '8.5',
  '185', '480', '10.2', '170', '420', '12.5',
  '25.5', '32.8', '45.2', '52.1'
];

// 创建工作簿
const workbook = XLSX.utils.book_new();

// 创建Sheet1: 配合比数据
const mixDesignData = [mixDesignHeaders, mixDesignSampleRow];
const sheet1 = XLSX.utils.aoa_to_sheet(mixDesignData);
XLSX.utils.book_append_sheet(workbook, sheet1, '配合比数据');

// 创建Sheet2: 试验结果
const testResultData = [testResultHeaders, testResultSampleRow];
const sheet2 = XLSX.utils.aoa_to_sheet(testResultData);
XLSX.utils.book_append_sheet(workbook, sheet2, '试验结果');

// 输出路径
const outputDir = path.join(__dirname, '..', 'public', 'templates');
const outputPath = path.join(outputDir, 'mix-design-analysis-template.xlsx');

// 确保目录存在
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 写入文件
try {
  XLSX.writeFile(workbook, outputPath);
  console.log(`Excel模板已生成: ${outputPath}`);
} catch (error) {
  console.error('生成模板失败:', error);
  process.exit(1);
}
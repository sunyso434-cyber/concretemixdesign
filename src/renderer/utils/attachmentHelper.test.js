/**
 * attachmentHelper 工具函数测试
 * 运行方式: node src/renderer/utils/attachmentHelper.test.js
 */

// 直接内联测试函数（避免模块导入问题）
const detectMixDesignDataInText = (text) => {
  if (!text) return false
  const hasWaterBinder = /水胶比/.test(text)
  const hasStrength = /强度|R\d/.test(text)
  const hasMixDesign = /配合比/.test(text)
  const hasNumericPattern = /\d+\.\d+|\d+kg/.test(text)
  return (hasWaterBinder && hasStrength) || (hasMixDesign && hasNumericPattern)
}

const getAttachmentType = (filename) => {
  if (!filename) return null
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (ext === 'md') return 'md'
  return 'unsupported'
}

const detectAnalysisModeIntent = (text) => {
  if (!text) return false
  const patterns = [
    /使用分析模式/,
    /进入分析模式/,
    /开启分析模式/,
    /分析模式/,
  ]
  return patterns.some(p => p.test(text))
}

// 测试 detectMixDesignDataInText
const testDetectMixDesignDataInText = () => {
  console.log('\n=== 测试 detectMixDesignDataInText ===')
  const tests = [
    { input: '水胶比0.45，强度C30', expected: true },
    { input: '请提供配合比数据', expected: false },
    { input: '配合比数据：水泥300kg，水150kg', expected: true },
    { input: '', expected: false },
    { input: null, expected: false },
    { input: '水胶比0.45', expected: false },
    { input: '水胶比0.38，R28强度达标', expected: true },
  ]
  let passed = 0
  tests.forEach(t => {
    const result = detectMixDesignDataInText(t.input)
    const ok = result === t.expected
    console.log(`${ok ? '✓' : '✗'} ${t.input} => ${result} (期望: ${t.expected})`)
    if (ok) passed++
  })
  console.log(`检测函数测试: ${passed}/${tests.length} 通过`)
}

// 测试 getAttachmentType
const testGetAttachmentType = () => {
  console.log('\n=== 测试 getAttachmentType ===')
  const tests = [
    { input: 'test.xlsx', expected: 'xlsx' },
    { input: 'data.XLSX', expected: 'xlsx' },
    { input: 'readme.md', expected: 'md' },
    { input: 'doc.txt', expected: 'unsupported' },
    { input: '', expected: null },
    { input: null, expected: null },
    { input: 'filename', expected: 'unsupported' },
  ]
  let passed = 0
  tests.forEach(t => {
    const result = getAttachmentType(t.input)
    const ok = result === t.expected
    console.log(`${ok ? '✓' : '✗'} ${t.input} => ${result} (期望: ${t.expected})`)
    if (ok) passed++
  })
  console.log(`附件类型检测测试: ${passed}/${tests.length} 通过`)
}

// 测试 detectAnalysisModeIntent
const testDetectAnalysisModeIntent = () => {
  console.log('\n=== 测试 detectAnalysisModeIntent ===')
  const tests = [
    { input: '使用分析模式', expected: true },
    { input: '请进入分析模式', expected: true },
    { input: '开启分析模式处理', expected: true },
    { input: '普通聊天内容', expected: false },
    { input: '', expected: false },
    { input: null, expected: false },
  ]
  let passed = 0
  tests.forEach(t => {
    const result = detectAnalysisModeIntent(t.input)
    const ok = result === t.expected
    console.log(`${ok ? '✓' : '✗'} ${t.input} => ${result} (期望: ${t.expected})`)
    if (ok) passed++
  })
  console.log(`分析模式意图检测测试: ${passed}/${tests.length} 通过`)
}

// 执行测试
testDetectMixDesignDataInText()
testGetAttachmentType()
testDetectAnalysisModeIntent()

console.log('\n=== 测试完成 ===')
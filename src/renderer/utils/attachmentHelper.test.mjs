/**
 * attachmentHelper 工具函数测试
 * 运行方式: node src/renderer/utils/attachmentHelper.test.mjs
 *
 * 注意：由于 attachmentHelper.js 使用 ES module import 语法（import/export），
 * 且项目 package.json 配置为 "type": "commonjs"，无法直接从 Node.js 导入。
 * 本测试文件通过 .mjs 扩展名以 ES module 方式运行，从 attachmentHelper.mjs 导入。
 */

import {
  detectMixDesignDataInText,
  getAttachmentType,
  detectAnalysisModeIntent
} from './attachmentHelper.mjs'

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
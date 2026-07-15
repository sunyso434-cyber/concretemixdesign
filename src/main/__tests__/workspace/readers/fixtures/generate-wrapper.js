// Jest globalSetup 入口：在所有 test 跑之前调用 generate() 生成 fixture
// Task 1.6 修正：generate() 现在是 async（docx 写入需要 await Packer.toBuffer），
// 这里必须 await，否则 jest 在 fixture 落盘前就开始跑测试，会间歇性失败。
const fs = require('fs')
const path = require('path')

module.exports = async () => {
  const testDataRoot = path.resolve(process.cwd(), '.tmp-test-user-data')
  if (path.basename(testDataRoot) !== '.tmp-test-user-data') {
    throw new Error(`Refusing to remove unexpected test data path: ${testDataRoot}`)
  }
  fs.rmSync(testDataRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })

  await require('./generate').generate()
}

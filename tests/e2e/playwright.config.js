module.exports = {
  testDir: './workspace',
  timeout: 30000,
  use: { headless: false }
  // 不设 webServer：Electron app 启动由测试自己控制
}

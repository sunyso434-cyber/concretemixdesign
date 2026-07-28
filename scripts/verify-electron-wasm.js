/**
 * verify-electron-wasm.js
 * 验证 @wlearn/xgboost 在 Electron 打包后能正常加载 WASM
 *
 * 运行方式: node scripts/verify-electron-wasm.js
 * 前置条件: @wlearn/xgboost 已安装 (npm install)
 *
 * 此脚本验证:
 *   1. @wlearn/xgboost 模块可被 require
 *   2. loadXGB() 能成功加载 WASM 二进制
 *
 * 配合 asarUnpack 配置确保 WASM 文件不被打包进 app.asar
 * 参见 package.json build.asarUnpack
 */
const { loadXGB } = require('@wlearn/xgboost')

async function verify() {
  console.log('验证 @wlearn/xgboost WASM 加载...')
  try {
    await loadXGB()
    console.log('✅ WASM 模块加载成功')
  } catch (e) {
    console.error('❌ WASM 加载失败:', e.message)
    process.exit(1)
  }
}

verify()

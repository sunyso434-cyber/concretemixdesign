// Jest globalSetup 入口：在所有 test 跑之前调用 generate() 生成 fixture
module.exports = async () => {
  require('./generate').generate()
}
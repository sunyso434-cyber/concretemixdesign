// D:/C-c/NEWConcrete-mixdesign/jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/main/agent/**/*.js',
    'src/main/utils/**/*.js',
    '!src/main/agent/**/__tests__/**',
    '!src/main/agent/**/__fixtures__/**'
  ],
  coverageThreshold: {
    'src/main/agent/mdInstructionBuilder.js': { lines: 90, branches: 90 },
    'src/main/agent/systemPromptBuilder.js': { lines: 90, branches: 90 },
    'src/main/agent/messageTrimmer.js': { lines: 90, branches: 90 },
    'src/main/utils/errorHandler.js': { lines: 90, branches: 90 }
  },
  // 单进程跑（避免 EventBus 单例跨文件污染）
  maxWorkers: 1,
  // 显式隔离每个 test 的环境
  resetModules: false,
  // 所有 reader 测试共享的 fixture 生成器（Task 1.3-1.7 共用）
  globalSetup: '<rootDir>/src/main/__tests__/workspace/readers/fixtures/generate-wrapper.js'
}

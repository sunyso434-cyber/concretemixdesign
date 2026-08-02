// D:/C-c/NEWConcrete-mixdesign/jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/__tests__/**/*.test.jsx',  // R10：渲染端组件测试（jsdom，如 RemotePanel.test.jsx）
    '<rootDir>/tests/**/*.test.js'  // Task 1：让 tests/ 顶层 *.test.js 也被 jest 默认发现
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/dist-.*',       // 打包产物目录（含 asar 解包副本），不跑测试
    '<rootDir>/.worktrees/',
    '<rootDir>/.claude/worktrees/',
    '<rootDir>/tests/e2e/',         // 端到端测试走 npm run test:e2e，不进 npm test
    '<rootDir>/tests/manual/',      // 手工脚本（npm run test:manual）
    '<rootDir>/tests/unit/'         // 老手动脚本驱动（独立 runner，不进 jest）
  ],
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
  setupFiles: ['<rootDir>/tests/jest.setup.js'],
  // 所有 reader 测试共享的 fixture 生成器（Task 1.3-1.7 共用）
  globalSetup: '<rootDir>/src/main/__tests__/workspace/readers/fixtures/generate-wrapper.js'
}

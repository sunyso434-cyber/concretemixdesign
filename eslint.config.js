// ESLint 最小配置（2026-08-23 第五批工程化引入）
// 原则：只开正确性相关规则，不搞风格争论；error 级保持零存量（正确性缺陷），
// 模式性存量问题（空 catch、冗余转义等）降为 warning 渐进清理。
// 配套：npm run lint（全量，CI 强制 error=0）/ lint:fix
const js = require('@eslint/js')
const globals = require('globals')
const reactHooks = require('eslint-plugin-react-hooks')

// 存量遗留问题降级规则（渐进清理，不阻塞 CI）
const legacyWarnings = {
  'no-empty': ['warn', { allowEmptyCatch: true }],   // 项目大量有意为之的 catch (_) {}
  'no-useless-escape': 'warn',
  'no-useless-assignment': 'warn',
  'no-case-declarations': 'warn',
  'no-irregular-whitespace': 'warn',
  'no-useless-catch': 'warn',
  'no-control-regex': 'warn',
  'preserve-caught-error': 'warn'
}

module.exports = [
  // 忽略：构建产物/外部子项目/归档
  {
    ignores: [
      'dist-*/**', 'coverage/**', 'node_modules/**', '.worktrees/**', '.claude/**',
      '_archive/**', 'Android-concreteagent/**', 'tongzhi-mobile-ui/**',
      'temp-agency-agents/**', 'trae-skills/**', 'scripts/**',
      '**/__fixtures__/**'
    ]
  },
  // 主进程 / 脚本 / 测试：CommonJS + Node 环境
  {
    files: ['src/main/**/*.js', 'src/main/**/*.jsx', 'main.js', 'tests/**/*.js', 'migrations/**/*.js', 'babel.config.js', 'jest.config.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...legacyWarnings,
      // 存量大量未用变量（如解构占位），warning 不阻塞；新代码应清理
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // 允许 class 中使用 this 赋值前声明（存量 singleton 模式依赖）
      'no-prototype-builtins': 'off'
    }
  },
  // 渲染进程：ESM + JSX
  {
    files: ['src/renderer/**/*.js', 'src/renderer/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...legacyWarnings,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // JSX 大写组件/浏览器全局按需放开
      'no-undef': 'error',
      // React hooks 规则渐进引入（存量 warn）
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn'
    },
    plugins: { 'react-hooks': reactHooks }
  },
  // 渲染进程测试：jsdom/jest 环境。CJS(require) 与 ESM(import) 两种写法并存——
  // 用 sourceType:module（import 需要），require 由 node globals 兜住不报 no-undef
  {
    files: ['src/renderer/**/__tests__/**/*.js', 'src/renderer/**/__tests__/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.jest, ...globals.node }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...legacyWarnings,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }]
    }
  },
  // 个别 ESM 写法的配置/测试文件（vite.config / systemErrorBubble）
  {
    files: ['vite.config.js', 'tests/systemErrorBubble.test.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.jest, ...globals.browser }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...legacyWarnings,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }]
    }
  }
]

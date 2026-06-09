// Babel config for Jest — handles ESM (export/import) in test files
// and ESM source files (e.g. src/renderer/components/agentStoreCore.js)
// by transforming them to CommonJS for Node's Jest runtime.

module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }]
  ]
}

'use strict'

// 2026-08-21 阶段 2：原第一段「迁移脚本 2026-06-17-add-workspace-path」测试随死迁移文件一并删除
// （该迁移从未接线，workspacePath 列实际由模型定义 + schema 基线机制落库）。
// 保留模型字段验证段：模型定义是 schema 的真源，字段缺失会静默破坏工作区隔离。

const path = require('path')
const fs = require('fs')

describe('模型字段验证', () => {
  test('ChatHistory 模型文件应包含 workspacePath 字段定义', () => {
    // 通过文件内容验证，避免 require 时触发 database.js 的循环依赖
    const content = fs.readFileSync(
      path.join(__dirname, '..', '..', 'db', 'models', 'ChatHistory.js'), 'utf8'
    )
    expect(content).toContain('workspacePath')
    expect(content).toContain('DataTypes.STRING(1000)')
  })

  test('ChatSession 模型文件应包含 workspacePath 字段定义', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', '..', 'db', 'models', 'ChatSession.js'), 'utf8'
    )
    expect(content).toContain('workspacePath')
    expect(content).toContain('DataTypes.STRING(1000)')
  })
})

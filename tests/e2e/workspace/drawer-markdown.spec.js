// E2E D: 抽屉内 markdown 渲染含 frontmatter + 表格 + 代码块
// 用 Playwright _electron launch 启动，验证 react-markdown 正确渲染 4 类元素
const { test, expect, _electron: electron } = require('@playwright/test')
const path = require('path')
const fs = require('fs').promises
const os = require('os')

let app, window
let testWs

test.beforeAll(async () => {
  // 创建临时工作区 + 含 frontmatter / 表格 / 代码块的 rich .md
  testWs = path.join(os.tmpdir(), `e2e-md-${Date.now()}`)
  await fs.mkdir(path.join(testWs, 'wiki', 'sources'), { recursive: true })
  await fs.writeFile(
    path.join(testWs, 'wiki', 'sources', 'sample-rich.md'),
    `---
title: "test-rich-doc"
source: "test.pdf"
ingested_at: "2026-06-18T10:00:00Z"
quality: "high"
---

# 标题

普通段落。

| 列1 | 列2 |
|-----|-----|
| a   | b   |
| c   | d   |

\`\`\`js
const x = 1
\`\`\`
`
  )
})

test.afterAll(async () => {
  if (app) await app.close().catch(() => {})
  if (testWs) await fs.rm(testWs, { recursive: true, force: true }).catch(() => {})
})

test('E2E D: 抽屉内 markdown 渲染含 frontmatter + 表格 + 代码块', async () => {
  app = await electron.launch({ args: ['.'] })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // 打开工作区
  await window.evaluate(
    (p) => window.electronAPI.workspace.open(p),
    testWs
  )

  // 打开抽屉
  await window.locator('button:has-text("工作区")').click()
  await expect(window.locator('.ant-drawer-title')).toBeVisible({ timeout: 5000 })

  // 等待文件列表加载
  await window.waitForSelector('text=sample-rich.md', { timeout: 5000 })

  // 点击"查看"按钮
  await window.locator('button:has-text("查看")').first().click()

  // 等待 markdown 渲染
  await window.waitForSelector('h1', { timeout: 5000 })

  // 验证 h1 标题
  await expect(window.locator('h1:has-text("标题")')).toBeVisible()

  // 验证表格
  await expect(window.locator('table')).toBeVisible()
  const rowCount = await window.locator('table tbody tr').count()
  expect(rowCount).toBe(2)

  // 验证代码块
  await expect(window.locator('pre code')).toBeVisible()
})

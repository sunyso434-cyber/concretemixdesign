// E2E C: 抽屉开关 + 文件列表
// 用 Playwright _electron launch 启动 Electron，验证抽屉打开/关闭 + 文件列表
const { test, expect, _electron: electron } = require('@playwright/test')
const path = require('path')
const fs = require('fs').promises
const os = require('os')

let app, window
let testWs

test.beforeAll(async () => {
  // 创建临时工作区 + 写一个 .md 供 listFiles 显示
  testWs = path.join(os.tmpdir(), `e2e-drawer-${Date.now()}`)
  await fs.mkdir(path.join(testWs, 'wiki', 'sources'), { recursive: true })
  await fs.writeFile(
    path.join(testWs, 'wiki', 'sources', 'sample.md'),
    '# Hello\n\nWorld'
  )
})

test.afterAll(async () => {
  if (app) await app.close().catch(() => {})
  if (testWs) await fs.rm(testWs, { recursive: true, force: true }).catch(() => {})
})

test('E2E C: 抽屉开关 + 文件列表', async () => {
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
  await expect(window.locator('.ant-drawer-title')).toContainText('wiki 预览')

  // 验证文件列表显示 sample.md
  await expect(window.locator('text=sample.md')).toBeVisible({ timeout: 5000 })

  // 关闭抽屉
  await window.locator('.ant-drawer-close').click()
  await expect(window.locator('.ant-drawer-title')).not.toBeVisible({ timeout: 5000 })
})

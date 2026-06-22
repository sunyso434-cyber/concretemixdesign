# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: drawer.spec.js >> E2E C: 抽屉开关 + 文件列表
- Location: workspace\drawer.spec.js:26:1

# Error details

```
Error: Process failed to launch!
```

```
Error: electron.launch: Process failed to launch!
Call log:
  - <launching> "D:\C-c\NEWConcrete-mixdesign\node_modules\electron\dist\electron.exe" "-r" "D:\C-c\NEWConcrete-mixdesign\node_modules\playwright-core\lib\server\electron\loader.js" "--inspect=0" "--remote-debugging-port=0" "."
  - <launched> pid=21868
  - [pid=21868][err] D:\C-c\NEWConcrete-mixdesign\node_modules\electron\dist\electron.exe: bad option: --remote-debugging-port=0
  - [pid=21868] <kill>
  - [pid=21868] <will force kill>
  - [pid=21868] taskkill stderr: ����: û���ҵ����� "21868"��
  - [pid=21868] <process did exit: exitCode=9, signal=null>
  - [pid=21868] starting temporary directories cleanup
  - [pid=21868] finished temporary directories cleanup

```

# Test source

```ts
  1  | // E2E C: 抽屉开关 + 文件列表
  2  | // 用 Playwright _electron launch 启动 Electron，验证抽屉打开/关闭 + 文件列表
  3  | const { test, expect, _electron: electron } = require('@playwright/test')
  4  | const path = require('path')
  5  | const fs = require('fs').promises
  6  | const os = require('os')
  7  | 
  8  | let app, window
  9  | let testWs
  10 | 
  11 | test.beforeAll(async () => {
  12 |   // 创建临时工作区 + 写一个 .md 供 listFiles 显示
  13 |   testWs = path.join(os.tmpdir(), `e2e-drawer-${Date.now()}`)
  14 |   await fs.mkdir(path.join(testWs, 'wiki', 'sources'), { recursive: true })
  15 |   await fs.writeFile(
  16 |     path.join(testWs, 'wiki', 'sources', 'sample.md'),
  17 |     '# Hello\n\nWorld'
  18 |   )
  19 | })
  20 | 
  21 | test.afterAll(async () => {
  22 |   if (app) await app.close().catch(() => {})
  23 |   if (testWs) await fs.rm(testWs, { recursive: true, force: true }).catch(() => {})
  24 | })
  25 | 
  26 | test('E2E C: 抽屉开关 + 文件列表', async () => {
> 27 |   app = await electron.launch({ args: ['.'] })
     |         ^ Error: electron.launch: Process failed to launch!
  28 |   window = await app.firstWindow()
  29 |   await window.waitForLoadState('domcontentloaded')
  30 | 
  31 |   // 打开工作区
  32 |   await window.evaluate(
  33 |     (p) => window.electronAPI.workspace.open(p),
  34 |     testWs
  35 |   )
  36 | 
  37 |   // 打开抽屉
  38 |   await window.locator('button:has-text("工作区")').click()
  39 |   await expect(window.locator('.ant-drawer-title')).toBeVisible({ timeout: 5000 })
  40 |   await expect(window.locator('.ant-drawer-title')).toContainText('wiki 预览')
  41 | 
  42 |   // 验证文件列表显示 sample.md
  43 |   await expect(window.locator('text=sample.md')).toBeVisible({ timeout: 5000 })
  44 | 
  45 |   // 关闭抽屉
  46 |   await window.locator('.ant-drawer-close').click()
  47 |   await expect(window.locator('.ant-drawer-title')).not.toBeVisible({ timeout: 5000 })
  48 | })
  49 | 
```
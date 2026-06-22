# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: drawer-markdown.spec.js >> E2E D: 抽屉内 markdown 渲染含 frontmatter + 表格 + 代码块
- Location: workspace\drawer-markdown.spec.js:45:1

# Error details

```
Error: Process failed to launch!
```

```
Error: electron.launch: Process failed to launch!
Call log:
  - <launching> "D:\C-c\NEWConcrete-mixdesign\node_modules\electron\dist\electron.exe" "-r" "D:\C-c\NEWConcrete-mixdesign\node_modules\playwright-core\lib\server\electron\loader.js" "--inspect=0" "--remote-debugging-port=0" "."
  - <launched> pid=2608
  - [pid=2608][err] D:\C-c\NEWConcrete-mixdesign\node_modules\electron\dist\electron.exe: bad option: --remote-debugging-port=0
  - [pid=2608] <kill>
  - [pid=2608] <will force kill>
  - [pid=2608] taskkill stderr: ����: û���ҵ����� "2608"��
  - [pid=2608] <process did exit: exitCode=9, signal=null>
  - [pid=2608] starting temporary directories cleanup
  - [pid=2608] finished temporary directories cleanup

```

# Test source

```ts
  1  | // E2E D: 抽屉内 markdown 渲染含 frontmatter + 表格 + 代码块
  2  | // 用 Playwright _electron launch 启动，验证 react-markdown 正确渲染 4 类元素
  3  | const { test, expect, _electron: electron } = require('@playwright/test')
  4  | const path = require('path')
  5  | const fs = require('fs').promises
  6  | const os = require('os')
  7  | 
  8  | let app, window
  9  | let testWs
  10 | 
  11 | test.beforeAll(async () => {
  12 |   // 创建临时工作区 + 含 frontmatter / 表格 / 代码块的 rich .md
  13 |   testWs = path.join(os.tmpdir(), `e2e-md-${Date.now()}`)
  14 |   await fs.mkdir(path.join(testWs, 'wiki', 'sources'), { recursive: true })
  15 |   await fs.writeFile(
  16 |     path.join(testWs, 'wiki', 'sources', 'sample-rich.md'),
  17 |     `---
  18 | title: "test-rich-doc"
  19 | source: "test.pdf"
  20 | ingested_at: "2026-06-18T10:00:00Z"
  21 | quality: "high"
  22 | ---
  23 | 
  24 | # 标题
  25 | 
  26 | 普通段落。
  27 | 
  28 | | 列1 | 列2 |
  29 | |-----|-----|
  30 | | a   | b   |
  31 | | c   | d   |
  32 | 
  33 | \`\`\`js
  34 | const x = 1
  35 | \`\`\`
  36 | `
  37 |   )
  38 | })
  39 | 
  40 | test.afterAll(async () => {
  41 |   if (app) await app.close().catch(() => {})
  42 |   if (testWs) await fs.rm(testWs, { recursive: true, force: true }).catch(() => {})
  43 | })
  44 | 
  45 | test('E2E D: 抽屉内 markdown 渲染含 frontmatter + 表格 + 代码块', async () => {
> 46 |   app = await electron.launch({ args: ['.'] })
     |         ^ Error: electron.launch: Process failed to launch!
  47 |   window = await app.firstWindow()
  48 |   await window.waitForLoadState('domcontentloaded')
  49 | 
  50 |   // 打开工作区
  51 |   await window.evaluate(
  52 |     (p) => window.electronAPI.workspace.open(p),
  53 |     testWs
  54 |   )
  55 | 
  56 |   // 打开抽屉
  57 |   await window.locator('button:has-text("工作区")').click()
  58 |   await expect(window.locator('.ant-drawer-title')).toBeVisible({ timeout: 5000 })
  59 | 
  60 |   // 等待文件列表加载
  61 |   await window.waitForSelector('text=sample-rich.md', { timeout: 5000 })
  62 | 
  63 |   // 点击"查看"按钮
  64 |   await window.locator('button:has-text("查看")').first().click()
  65 | 
  66 |   // 等待 markdown 渲染
  67 |   await window.waitForSelector('h1', { timeout: 5000 })
  68 | 
  69 |   // 验证 h1 标题
  70 |   await expect(window.locator('h1:has-text("标题")')).toBeVisible()
  71 | 
  72 |   // 验证表格
  73 |   await expect(window.locator('table')).toBeVisible()
  74 |   const rowCount = await window.locator('table tbody tr').count()
  75 |   expect(rowCount).toBe(2)
  76 | 
  77 |   // 验证代码块
  78 |   await expect(window.locator('pre code')).toBeVisible()
  79 | })
  80 | 
```
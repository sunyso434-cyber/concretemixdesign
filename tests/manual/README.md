# 手工与回归脚本（manual）

根目录下的 `test-*.js` 已集中到此目录，避免与业务源码混杂。

## 一键运行（仅 Node，不含 Electron 窗口）

在项目根目录执行：

```bash
npm test
```

等价于：

```bash
node tests/manual/run-node-suites.js
```

## 需要 Electron 主进程的脚本

以下脚本会启动 `BrowserWindow` / IPC，请用 **Electron** 作为运行时（在项目根目录）：

```bash
npx electron tests/manual/test-ipc.js
npx electron tests/manual/test-save-scheme.js
npx electron tests/manual/test-scheme-ipc.js
```

## 环境相关

- `test-msbuild.js`：依赖本机 MSBuild，按需手动执行：`node tests/manual/test-msbuild.js`

## 路径约定

脚本内使用 `require('../../src/main/...')` 引用主进程源码，请勿改为相对仓库根目录的 `./src/...`（文件已位于 `tests/manual/` 下）。

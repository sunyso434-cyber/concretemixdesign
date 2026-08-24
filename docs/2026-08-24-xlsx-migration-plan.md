# xlsx 库迁移方案 v2（最终决策与执行记录）

> 2026-08-25 定稿 · 状态：**安全换源已完成并回归通过** · 写侧 exceljs 迁移取消 · 工作区路线维持 OfficeCLI

## 一、最终决策（与老板对齐过程记录）

| 决策项 | 结论 | 理由 |
|---|---|---|
| 读侧（导入/AI 读表） | ✅ 已执行：xlsx 换官方 CDN 0.20.3 | CVE-2023-30533（原型污染）、CVE-2024-22363（ReDoS）均针对**解析恶意文件**的路径，必须修 |
| 写侧迁移 exceljs（TemplateService 等 ~5 处） | ❌ 取消（原 v1 方案 B/C） | 按钮导出实际使用率低，不值得 1~1.5 天 |
| 工作区 AI 生成 xlsx | 维持 OfficeCLI（实测二进制 1.0.144） | 实测单元格级样式能力完整（字体/底色/边框/合并/冻结/列宽/条件格式等），推翻了"officecli 样式弱"的旧判断 |
| exceljs「一键报表」技能 | 待定增强（约 1 天） | AI 以 JSON 说明式传数据即可自定义格式；样式固化代码可保每次产出一致、省 token。**等真实需求出现再启动** |
| 前端 templateDownloader（2 个小模板） | 不动 | 一行示例的小表，无样式诉求 |

### 关键认知修正（留档）
- v1 曾判断"officecli 做 Excel 整表样式不现实"——**该判断错误**，依据是仓库内旧手册（1.0.143）。实测 `officecli help xlsx` 后确认其 xlsx 能力远超手册记载。
- 教训：**比较工具能力前先对实际部署版本跑 help/实测，不依据二手文档下结论。**

## 二、安全换源执行记录（2026-08-25）

1. `vendor/xlsx-0.20.3.tgz` 入库（2,409,319 字节；tarball 内 package.json 校验 name=xlsx / version=0.20.3）
2. `package.json` 依赖改为 `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`（离线/CI 可重现）
3. `npm install --cache .npm-cache` 安装成功（沙箱禁写家目录，npm 缓存重定向到项目内；`.gitignore` 已加 `.npm-cache/`）
4. 运行时验证：`require('xlsx').version === '0.20.3'`，依赖树仅此一份（无重复安装）

## 三、验证结果

| 验证项 | 结果 |
|---|---|
| 全量 jest 回归 | ✅ 266 套件 / 2527 用例全部通过（146.8s），含 readers、TemplateService、导入导出相关用例 |
| 读写闭环冒烟（新库写→新库读回） | ✅ generateMaterialTemplate 生成 8 Sheet 模板，读回 Sheet 名与「中文 / english」表头逐字一致 |
| npm audit | ✅ xlsx 相关告警清零（file: 依赖按 0.20.3 计）；其余 26 条为 electron/axios/vite 等既有问题，与本次无关 |

### 待下次打包前补做
- GUI 手动抽测：设置页导出 xlsx/csv 各一次；导入旧模板+新模板各一次；工作区 ingest 一个 xlsx；AI 分析读一个 xlsx
- `npm run electron:build` + asar 内 node_modules/xlsx 版本核对
- version_log 随发版记录

## 四、回滚预案

`git revert` package.json + package-lock.json 变更后 `npm install` 即回到 0.18.5（vendor 文件删除可选）。

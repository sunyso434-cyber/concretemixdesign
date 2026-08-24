# xlsx 库迁移方案（0.18.5 → SheetJS 官方 0.20.x）

> 2026-08-24 · 状态：方案待批准 · 预估工作量：半天（含回归验证）

## 一、背景

当前依赖 `xlsx@0.18.5` 是 SheetJS 在 npm registry 的**最后一个版本**（2022 年起 npm 侧停更），存在两个已知未修复漏洞：

| CVE | 类型 | 影响 |
|---|---|---|
| CVE-2023-30533 | 原型污染 | 恶意构造的 xlsx 文件可污染对象原型——本项目**解析用户导入的 Excel**，攻击面真实存在 |
| CVE-2024-22363 | ReDoS | 特制文件导致解析挂死——导入功能同样暴露 |

官方修复只发布在 SheetJS 自有源（cdn.sheetjs.com），npm 侧永不更新。

## 二、使用现状（2026-08-24 实测）

全仓 19 处引用，主代码 10 处（其余为一次性脚本）：

| 文件 | 用途 |
|---|---|
| `src/main/services/dataImportExport.js` | 材料数据 Excel 导入/导出（原 SystemService，拆分后归属） |
| `src/main/services/TemplateService.js` | 导入模板生成（多 Sheet） |
| `src/main/workspace/readers/xlsx.js` | wiki ingest 的 xlsx 读取 |
| `src/main/workspace/analyze/dataLoader.js` | AI 分析数据源读取 |
| `src/main/skills/manage_vehicle_details.js` | 车辆管理技能 |
| `src/renderer/utils/templateDownloader.js` | 前端模板下载 |

## 三、方案对比

### 方案 A：切换 SheetJS 官方 CDN 版 0.20.x（推荐）

```bash
# 1. 下载官方 tgz 入库（保证离线/CI 可重现）
curl -o vendor/xlsx-0.20.3.tgz https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
# 2. package.json 改为本地 tarball 引用
#    "xlsx": "file:vendor/xlsx-0.20.3.tgz"
npm install
```

- ✅ **API 完全兼容**：同一家厂商同一包名，`XLSX.read/write/utils` 签名不变，19 处调用点**零代码改动**
- ✅ 两个 CVE 均已修复
- ✅ 纯 JS 无原生模块，electron-builder 打包不受影响
- ⚠️ npm audit 仍可能报旧版本号（registry 元数据不更新）——可在 audit 配置豁免并注明理由
- ⚠️ 依赖 vendor 目录入库（约 1MB tgz），换取离线可重现

### 方案 B：迁移到 exceljs（npm 活跃维护）

- ✅ npm 正常安装、社区活跃、样式能力更强
- ❌ **API 不兼容**：读（`workbook.xlsx.load(buffer)`）写（`writeBuffer()`）全变，19 处调用点逐个改写 + CSV 编码处理需另补——预估 2~3 天且回归面大
- ❌ 包体积显著增大

### 结论

**采用方案 A**，半天完成、漏洞闭环、零调用点改动。方案 B 作为远期备选（若 SheetJS 官方源也停止维护再启动）。

## 四、执行步骤（批准后）

1. 下载 tgz 入 `vendor/`，改 package.json 引用，`npm install`
2. 全量 jest 回归（现有 readers/TemplateService/导入导出测试覆盖读写两侧）
3. 手动回归清单：
   - 设置页「导出数据」xlsx / csv 各一次
   - 「导入数据」用旧模板 + 新模板各一次（含材料 60 字段映射）
   - 工作区 ingest 一个 xlsx（wiki 读取路径）
   - AI 分析（workspace_analyze）读一个 xlsx
4. `npm run electron:build` + asar 指纹抽查（node_modules/xlsx 版本核对）
5. version_log 记录

## 五、风险与回滚

- 0.18 → 0.20 官方声明 API 兼容；个别边缘（CSV 编码探测、日期单元格解析）有微调——步骤 3 的手动回归即为此设
- 回滚：`git revert` package.json 变更 + `npm install` 即回到 0.18.5（vendor 文件删除可选）

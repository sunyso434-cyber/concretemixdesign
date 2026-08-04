# OfficeCLI 1.0.143 能力对比与培训手册

> **文档版本**：v1.0  
> **更新日期**：2026-08-04  
> **适用版本**：officecli 1.0.143（2026-07-28 GitHub 发布）  
> **上次版本**：officecli 1.0.139  
> **文档用途**：团队培训 + 能力对比 + 使用参考

---

## 目录

1. [OfficeCLI 是什么（小白版）](#一-officecli-是什么小白版)
2. [本次版本更新说明](#二-本次版本更新说明)
3. [三大格式支持总览](#三-三大格式支持总览)
4. [完整命令清单（28 个）](#四-完整命令清单28-个)
5. [砼智技能对接对照表](#五-砼智技能对接对照表)
6. [本次新增对接能力详解](#六-本次新增对接能力详解)
7. [实用场景示例](#七-实用场景示例)
8. [未对接能力说明](#八-未对接能力说明)
9. [附录：完整命令参考](#附录完整命令参考)

---

## 一、OfficeCLI 是什么（小白版）

### 1.1 一句话解释

**OfficeCLI 是一个命令行工具，让 AI 能直接读、写、创建 Word/Excel/PowerPoint 文件，不需要装 Microsoft Office。**

### 1.2 为什么需要它

| 传统做法 | OfficeCLI 做法 |
|---------|---------------|
| AI 写 50 行 Python 代码（python-docx/openpyxl） | 一条命令搞定 |
| 需要装 Python + 各种库 | 单个 exe 文件，下载即用 |
| 需要装 Microsoft Office | 不需要 Office |
| AI 看不到文档长什么样 | 内置 HTML 渲染，AI 能"看见" |
| 修改后可能格式错乱 | 直接操作文档元素，格式精确 |

### 1.3 工作原理（通俗版）

```
您对 AI 说："帮我在报告.docx 里加一段总结"
        ↓
AI 调用 officecli 命令
        ↓
officecli 直接修改 docx 文件的 XML 结构
        ↓
文件保存，格式不乱
```

**关键点**：docx/xlsx/pptx 本质上是 ZIP 压缩的 XML 文件，officecli 直接操作这些 XML，不需要 Word/Excel 打开文件。

---

## 二、本次版本更新说明

### 2.1 版本号变化

| 项目 | 旧版本 | 新版本 |
|------|--------|--------|
| officecli 二进制 | 1.0.139 | **1.0.143** |
| 发布日期 | — | 2026-07-28 |
| 砼智版本 | 0.3.1 | 0.3.2 |

### 2.2 1.0.140 → 1.0.143 的更新内容

| 版本 | 更新内容 |
|------|---------|
| 1.0.140-1.0.142 | GitHub 未单独发布 release 说明（中间版本） |
| 1.0.143 | 修复 pptx notes slides 的关系包；修复管道 stdin UTF-8 解码；保留 Excel drawing hyperlinks 和 grouped shapes |

### 2.3 能力变化核对

**老板关心的问题：升级后能力有没有变？**

| 能力 | 1.0.139 | 1.0.143 | 变化 |
|------|---------|--------|------|
| batch 原子事务 | ✅ | ✅ | 无变化 |
| query CSS 选择器 | ✅ | ✅ | 无变化 |
| refresh 重算 | ✅ | ✅ | 无变化 |
| view stats/html | ✅ | ✅ | 无变化 |
| view 新增模式 | — | ✅ | **新增 issues/svg/screenshot/pdf/forms** |

**结论**：升级安全，原有能力都在，还新增了几个 view 模式。

---

## 三、三大格式支持总览

| 格式 | 后缀 | 读 | 写 | 创建 | 元素数量 |
|------|------|----|----|------|---------|
| Word | .docx | ✅ | ✅ | ✅ | ~50 类 |
| Excel | .xlsx | ✅ | ✅ | ✅ | ~38 类 |
| PowerPoint | .pptx | ✅ | ✅ | ✅ | ~25 类 |

### 3.1 Word（.docx）支持的元素

| 类别 | 元素 |
|------|------|
| **文档结构** | document、body、section、header、footer |
| **文本** | paragraph、run、tab、linebreak、pagebreak |
| **表格** | table、table-column、table-row、table-cell |
| **样式** | style、styles、numbering、abstractNum |
| **图表** | chart、chart-axis、chart-series |
| **多媒体** | picture、shape、textbox、diagram、ole |
| **引用** | hyperlink、bookmark、field、fieldchar、instrtext |
| **批注** | comment、footnote、endnote |
| **其他** | equation、formfield、revision、sdt、watermark、toc |

### 3.2 Excel（.xlsx）支持的元素

| 类别 | 元素 |
|------|------|
| **基础** | workbook、sheet、row、column、cell |
| **公式** | cell（含公式自动计算，150+ 内置函数） |
| **表格** | table、detectedtable、autofilter、slicer |
| **图表** | chart、chart-axis、chart-series、sparkline |
| **条件格式** | conditionalformatting（含 12 种子类型） |
| **数据** | range（排序）、namedrange、validation、pivottable |
| **其他** | picture、shape、ole、pagebreak、colbreak、rowbreak |

### 3.3 PowerPoint（.pptx）支持的元素

| 类别 | 元素 |
|------|------|
| **演示** | presentation、slide、slidemaster、slidelayout、theme |
| **内容** | shape、paragraph、run、linebreak、textbox、placeholder |
| **多媒体** | picture、media、model3d、chart、diagram、connector、group |
| **动画** | animation、transition、zoom |
| **其他** | comment、moderncomment、notes、equation、hyperlink、table |

---

## 四、完整命令清单（28 个）

### 4.1 读取类命令（6 个）

| 命令 | 作用 | 砼智是否对接 |
|------|------|-------------|
| `view` | 查看文档（9 种模式） | ✅ 已对接 5 种 |
| `get` | 按路径获取单个元素 | ✅ 通过 raw 对接 |
| `query` | CSS 选择器查询元素 | ✅ **本次新对接** |
| `raw` | 查看原始 XML | ✅ 已对接 |
| `dump` | 序列化子树为回放脚本 | ✅ 已对接 |
| `validate` | 校验 OpenXML 合法性 | ✅ 已对接 |

### 4.2 修改类命令（8 个）

| 命令 | 作用 | 砼智是否对接 |
|------|------|-------------|
| `set` | 修改元素属性 | ✅ 已对接 |
| `add` | 添加新元素 | ✅ 已对接 |
| `remove` | 删除元素 | ✅ 已对接 |
| `move` | 移动元素位置 | ✅ 已对接 |
| `swap` | 交换两个元素 | ✅ 已对接 |
| `batch` | **原子事务批量操作** | ✅ **本次新对接** |
| `refresh` | **重算目录页码/交叉引用** | ✅ **本次新对接** |
| `raw-set` | 修改原始 XML | ✅ 已对接 |

### 4.3 文件管理类命令（5 个）

| 命令 | 作用 | 砼智是否对接 |
|------|------|-------------|
| `create` | 创建空白文档 | ✅ 已对接 |
| `merge` | 模板合并（{{key}} 替换） | ✅ 已对接 |
| `import` | CSV/TSV 导入 Excel | ✅ 已对接 |
| `open` | 启动驻留进程（加速） | ❌ 未对接 |
| `close` | 关闭驻留进程 | ❌ 未对接 |

### 4.4 预览类命令（2 个）

| 命令 | 作用 | 砼智是否对接 |
|------|------|-------------|
| `watch` | 启动 HTTP 实时预览服务器 | ❌ 未对接 |
| `unwatch` | 停止预览服务器 | ❌ 未对接 |

### 4.5 元信息类命令（4 个）

| 命令 | 作用 | 砼智是否对接 |
|------|------|-------------|
| `help` | 查询 schema 帮助 | ✅ 已对接 |
| `plugins` | 管理插件 | ❌ 未对接 |
| `skills` | 安装 agent skill 定义 | ❌ 未对接 |
| `install` | 一键安装到 AI 工具 | ❌ 未对接 |

### 4.6 其他命令（3 个）

| 命令 | 作用 | 砼智是否对接 |
|------|------|-------------|
| `save` | 驻留模式落盘保存 | ❌ 未对接 |
| `add-part` | 创建新 XML part | ❌ 未对接 |
| `mcp` | 启动 MCP 服务器 | ❌ 未对接 |

---

## 五、砼智技能对接对照表

### 5.1 更新前（v0.3.1）— 9 个技能

| # | 技能名 | 对应命令 | 覆盖范围 |
|---|--------|---------|---------|
| 1 | read_office_file | view | outline/text/annotated 3 种模式 |
| 2 | edit_office_file | set/add/remove | 文本/格式/表格修改 |
| 3 | create_office_file | create | 创建空白文档 |
| 4 | merge_office_template | merge | 模板填充 |
| 5 | move_office_element | move/swap | 移动/交换元素 |
| 6 | validate_office_file | validate | schema 校验 |
| 7 | import_office_csv | import | CSV 导入 Excel |
| 8 | officecli_raw | raw/raw-set/dump | 原始 XML 操作 |
| 9 | officecli_help | help | schema 帮助查询 |

### 5.2 更新后（v0.3.2）— 13 个技能

| # | 技能名 | 对应命令 | 覆盖范围 | 本次变化 |
|---|--------|---------|---------|---------|
| 1 | read_office_file | view | **5 种模式**（outline/text/annotated/stats/html） | 🆕 加 stats + html |
| 2 | edit_office_file | set/add/remove | 文本/格式/表格修改 | 无变化 |
| 3 | **batch_office_edit** | batch | **原子事务批量操作** | 🆕 **新增** |
| 4 | **query_office_elements** | query | **CSS 选择器查询** | 🆕 **新增** |
| 5 | **refresh_office_doc** | refresh | **重算目录页码** | 🆕 **新增** |
| 6 | create_office_file | create | 创建空白文档 | 无变化 |
| 7 | merge_office_template | merge | 模板填充 | 无变化 |
| 8 | move_office_element | move/swap | 移动/交换元素 | 无变化 |
| 9 | validate_office_file | validate | schema 校验 | 无变化 |
| 10 | import_office_csv | import | CSV 导入 Excel | 无变化 |
| 11 | officecli_raw | raw/raw-set/dump | 原始 XML 操作 | 无变化 |
| 12 | officecli_help | help | schema 帮助查询 | 无变化 |

### 5.3 覆盖率变化

| 指标 | 更新前（v0.3.1） | 更新后（v0.3.2） |
|------|-----------------|-----------------|
| 技能数量 | 9 个 | **13 个** |
| 对接命令数 | 18 个 | **22 个** |
| 命令覆盖率 | ~64% | **~79%** |
| 关键缺口 | batch/query/refresh/stats/html | ✅ 全部补齐 |

---

## 六、本次新增对接能力详解

### 6.1 batch_office_edit — 原子事务批量编辑

#### 为什么需要

**之前的痛点**：`edit_office_file` 的 `operations[]` 是逐个顺序调用 officecli，**不是原子事务**。如果 5 个操作中第 3 个失败，前 2 个已落盘，文件变成半成品。

**现在解决**：`batch_office_edit` 走 officecli 原生 `batch` 命令，单次调用内部原子执行。

#### 三种原子性模式

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| **atomic**（默认） | 任一失败 → 整批回滚，什么都不应用 | 需要数据一致性（推荐） |
| **best-effort** | 成功的留下，失败的跳过 | 容错处理 |
| **stop-on-error** | 遇错立即中止 | 需要快速失败 |

#### 使用示例

```
技能：batch_office_edit
参数：
  filePath: "报告.docx"
  mode: "atomic"
  commands: [
    { command: "add", parent: "/body", type: "paragraph", props: { text: "总结" } },
    { command: "set", path: "/body/p[1]", props: { bold: "true" } },
    { command: "remove", path: "/body/p[2]" }
  ]
```

### 6.2 query_office_elements — CSS 选择器查询

#### 为什么需要

**之前的痛点**：`read_office_file annotated` 只能列出所有元素，不能按属性筛选。AI 想找"所有加粗的段落"或"所有 style=Normal 的 run"，只能全部读出来再人工过滤。

**现在解决**：`query_office_elements` 用类 CSS 选择器精准查询。

#### 选择器语法

| 语法 | 含义 | 示例 |
|------|------|------|
| `元素名` | 按元素类型 | `paragraph` |
| `[属性=值]` | 属性等于 | `paragraph[style=Normal]` |
| `[属性!=值]` | 属性不等于 | `run[font!=Arial]` |
| `空格` | 后代 | `body paragraph` |
| `>` | 子代 | `table > table-row` |
| `组合` | 多条件 | `paragraph[style=Normal] > run[bold=true]` |

#### 输出模式

| 模式 | 输出 | 适用场景 |
|------|------|---------|
| 默认（json） | 完整 JSON，含 matches 数组 | 程序处理 |
| compact | 每元素一行 `path<TAB>[label]<TAB>"text"` | 快速浏览 |

#### 使用示例

```
技能：query_office_elements
参数：
  filePath: "报告.docx"
  selector: "paragraph[style=Normal]"
  find: "混凝土"      ← 可选：按文本过滤
  compact: true       ← 可选：紧凑模式
```

**限制**：仅 docx/pptx 支持 query，xlsx 不支持（用 `read_office_file mode=text`）。

### 6.3 refresh_office_doc — 重算目录页码

#### 为什么需要

**痛点**：用 `edit_office_file` 修改文档后，目录页码可能不准，但 AI 没法让 Word 重算。

**解决**：`refresh_office_doc` 调用 Word 引擎重算 TOC 页码、PAGE/NUMPAGES 域、交叉引用。

#### 重算范围

| 字段类型 | 说明 |
|---------|------|
| TOC 页码 | 目录中各章节的页码 |
| PAGE 域 | 当前页码 |
| NUMPAGES 域 | 总页数 |
| 交叉引用 | 如"见图 3-1"的编号 |

**限制**：仅 .docx + Windows + Word 环境可用（需要 Word 引擎重算）。

### 6.4 read_office_file 新增 stats 模式

#### 输出示例

```json
{
  "success": true,
  "data": {
    "sheets": 1,
    "totalCells": 6734,
    "emptyCells": 0,
    "formulaCells": 0,
    "errorCells": 0,
    "dataTypes": { "Number": 6697, "SharedString": 37 }
  }
}
```

**用途**：快速了解文档规模，判断数据量大小。

### 6.5 read_office_file 新增 html 模式

#### 输出

完整的 HTML 字符串，前端可直接渲染预览。

**用途**：让 AI"看见"文档长什么样，实现"渲染 → 查看 → 修复"的视觉闭环。

---

## 七、实用场景示例

### 场景 1：批量修改报告（原子事务）

**需求**：给报告.docx 加 3 段总结，同时删除第 2 页的旧总结，要求全部成功或全部不改。

```
技能：batch_office_edit
filePath: "报告.docx"
mode: "atomic"          ← 任一失败全回滚
commands: [
  { command: "remove", path: "/body/p[5]" },
  { command: "add", parent: "/body", type: "paragraph", props: { text: "总结第一段" } },
  { command: "add", parent: "/body", type: "paragraph", props: { text: "总结第二段" } },
  { command: "add", parent: "/body", type: "paragraph", props: { text: "总结第三段" } }
]
```

### 场景 2：查找并修改特定段落

**需求**：找到所有"style=Normal"且包含"混凝土"的段落，改成加粗。

```
步骤1：查询
技能：query_office_elements
filePath: "报告.docx"
selector: "paragraph[style=Normal]"
find: "混凝土"

步骤2：根据返回的 path，批量加粗
技能：batch_office_edit
filePath: "报告.docx"
commands: [
  { command: "set", path: "/body/p[3]", props: { bold: "true" } },
  { command: "set", path: "/body/p[7]", props: { bold: "true" } }
]
```

### 场景 3：修改后刷新目录页码

**需求**：往报告里加了内容，目录页码不准了，需要重算。

```
步骤1：编辑文档
技能：edit_office_file
filePath: "报告.docx"
operations: [...]

步骤2：刷新目录页码
技能：refresh_office_doc
filePath: "报告.docx"
```

### 场景 4：生成报告前先检查数据

**需求**：读取 Excel 文件，先看数据量和公式情况，决定怎么处理。

```
技能：read_office_file
filePath: "数据表.xlsx"
mode: "stats"          ← 看统计信息

输出：总单元格 6734，公式 0，错误 0
判断：数据量大，无公式，可直接做统计
```

### 场景 5：预览文档效果

**需求**：修改完 PPT 后，想看看效果。

```
技能：read_office_file
filePath: "演示文稿.pptx"
mode: "html"           ← 渲染为 HTML

输出：HTML 字符串，前端可直接显示
```

---

## 八、未对接能力说明

### 8.1 未对接命令清单

| 命令 | 优先级 | 原因 |
|------|--------|------|
| `watch/unwatch` | 低 | 实时预览，需前端配合，工作量大 |
| `open/save/close` | 低 | 驻留进程加速，增加复杂度 |
| `add-part` | 低 | 高级 XML 操作，raw-set 基本能覆盖 |
| `plugins` | 低 | 插件管理，砼智暂不需要 |
| `skills/install` | 低 | 安装到其他 AI 工具，砼智不适用 |
| `mcp` | 低 | MCP 服务器模式，砼智用自己的技能体系 |

### 8.2 view 命令的 4 种未对接模式

| 模式 | 作用 | 未对接原因 |
|------|------|-----------|
| `issues` | 检查文档问题（格式/内容/结构） | 可后续补充 |
| `svg` | 渲染为 SVG | 可后续补充 |
| `screenshot` | 截图 | 需要浏览器环境 |
| `pdf` | 导出 PDF | 可后续补充 |

---

## 附录：完整命令参考

### A.1 命令速查表

```
读取：view / get / query / raw / dump / validate
修改：set / add / remove / move / swap / batch / refresh / raw-set
文件：create / merge / import / open / close / save
预览：watch / unwatch
元：  help / plugins / skills / install / mcp
```

### A.2 查看帮助的方式

```bash
# 查看所有元素
officecli help docx
officecli help xlsx
officecli help pptx

# 查看某动词支持的元素
officecli help docx add
officecli help xlsx set

# 查看某元素的完整详情
officecli help docx paragraph

# 导出完整 schema（NDJSON 格式，每行一个 JSON）
officecli help all --jsonl

# 查看版本
officecli --version
```

### A.3 常用路径语法

| 路径 | 含义 |
|------|------|
| `/body` | 文档主体 |
| `/body/p[1]` | 第 1 个段落 |
| `/body/table[1]` | 第 1 个表格 |
| `/slide[1]/shape[1]` | 第 1 张幻灯片的第 1 个形状 |
| `/sheet[1]/row[1]/cell[1]` | 第 1 个 sheet 的第 1 行第 1 个单元格 |

### A.4 砼智技能调用方式

在砼智对话中，AI 会自动选择合适的技能。您也可以直接说：

- "读一下报告.docx 的结构" → read_office_file mode=outline
- "把第 2 段加粗" → edit_office_file action=set
- "找所有加粗的段落" → query_office_elements
- "批量修改，要原子事务" → batch_office_edit mode=atomic
- "刷新目录页码" → refresh_office_doc
- "看看这个 Excel 有多少数据" → read_office_file mode=stats
- "预览这个 PPT" → read_office_file mode=html

---

## 文档维护

- **维护人**：开发团队
- **更新规则**：每次 officecli 版本更新后，核对能力变化并更新本文档
- **相关文件**：
  - 二进制位置：`resources/officecli/win/officecli.exe`
  - 桥接层：`src/main/officecli/officecli-bridge.js`
  - 技能注册：`src/main/agent/workspaceTools.js`
  - 测试文件：`tests/officecli-new-skills.test.js`

---

*本文档基于 officecli 1.0.143 版本编写，如需了解最新版本请查看 [GitHub Releases](https://github.com/iOfficeAI/OfficeCLI/releases)。*
